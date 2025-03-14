import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RedisService } from 'src/RedisModule/redis.service';
import { UsersService } from 'src/UserModule/users.service';
import { FlightStatus, SearchType } from '@prisma/client';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { TelegramService } from 'src/TelegramModule/telegram.service';

@Injectable()
export class FlightService {
  private readonly logger = new Logger(FlightService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly cacheTTL = 60 * 60; // 1 час
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
  ) {
    // Используем новый API
    this.apiUrl = this.configService.get<string>(
      'AVIATION_EDGE_API_URL',
      'https://aviation-edge.com/v2/public',
    );
    this.apiKey = this.configService.get<string>('AVIATION_EDGE_API_KEY');
    this.baseUrl = this.configService.get<string>('BASE_URL');

    this.logger.log(
      `FlightService initialized with Aviation Edge API: ${this.apiUrl}`,
    );
  }

  private async authenticate(authHeader: string) {
    return this.usersService.authenticate(authHeader);
  }

  async createFlight(authHeader: string, flightData: CreateFlightDto) {
    const user = await this.authenticate(authHeader);

    if (user.accountType !== 'CARRIER') {
      throw new BadRequestException('Только перевозчики могут создавать рейсы');
    }

    // Проверяем, существует ли рейс в FR24
    const flightExists = await this.getFlightsByRouteAndDate(
      authHeader,
      flightData.departure,
      flightData.arrival,
      flightData.date.toISOString().split('T')[0], // Приводим дату к формату YYYY-MM-DD
    );

    if (!flightExists || !flightExists.length) {
      throw new BadRequestException(
        'Рейс с такими параметрами не найден в AVIATION_EDGE. Проверьте данные',
      );
    }

    const db = this.prisma.getDatabase(user.dbRegion);

    const flight = await db.flight.create({
      data: {
        userId: user.id,
        departure: flightData.departure,
        dbRegion: user.dbRegion,
        arrival: flightData.arrival,
        date: flightData.date,
        description: flightData.description,
        documentUrl: flightData.documentUrl || null,
        status: FlightStatus.PENDING,
      },
    });

    await this.telegramService.delegateToModeration(
      'flight',
      flight.id,
      user.dbRegion,
    );

    return { message: 'Рейс создан и отправлен на модерацию', flight };
  }

  async uploadDocument(authHeader: string, flightId: string) {
    const user = await this.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const flight = await db.flight.findUnique({
      where: { id: Number(flightId) },
    });

    if (!flight) {
      throw new NotFoundException('Рейс не найден');
    }

    if (flight.userId !== user.id) {
      throw new ForbiddenException('Вы не владелец этого рейса');
    }

    const documentUrl = `${this.baseUrl}/flights/${flightId}/document`;

    await db.flight.update({
      where: { id: Number(flightId) },
      data: { documentUrl },
    });

    return { message: 'Документ загружен', documentUrl };
  }

  async searchFlightsForCustomer(
    authHeader: string,
    departure: string,
    arrival: string,
    date?: string,
  ) {
    const user = await this.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    await db.userSearch.create({
      data: {
        userId: user.id,
        query: date
          ? `${departure}-${arrival} ${date}`
          : `${departure}-${arrival}`,
        type: SearchType.CITY,
      },
    });

    const whereCondition: any = {
      departure,
      arrival,
      status: FlightStatus.CONFIRMED,
    };

    if (date) {
      whereCondition.date = new Date(date);
    }

    const flights = await db.flight.findMany({
      where: whereCondition,
      orderBy: { date: 'asc' },
    });

    return { message: 'Список подтверждённых рейсов', flights };
  }

  async markFlightAsArrived(authHeader: string, flightId: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const flight = await db.flight.findUnique({
      where: { id: Number(flightId) },
    });

    if (!flight) {
      throw new NotFoundException('Рейс не найден');
    }

    if (flight.userId !== user.id) {
      throw new ForbiddenException('Вы не являетесь владельцем рейса');
    }

    await db.flight.update({
      where: { id: Number(flightId) },
      data: { status: FlightStatus.ARRIVED },
    });

    return { message: 'Рейс помечен как прибыл', flightId };
  }

  async getAirports(authHeader: string) {
    const user = await this.authenticate(authHeader);
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      'ALL_AIRPORTS',
      SearchType.AIRPORT,
    );
    return this.fetchWithCache('airports-light', `${this.apiUrl}/api/airports`);
  }

  async getCities(authHeader: string) {
    const user = await this.authenticate(authHeader);

    // Сохраняем историю поиска для городов
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      'ALL_CITIES',
      SearchType.CITY,
    );

    // Получаем список аэропортов
    const airports = await this.fetchWithCache(
      'airports-light',
      `${this.apiUrl}/api/airports`,
    );

    // Извлекаем города из списка аэропортов
    const cities = airports.map((airport: { city: string }) => airport.city);

    return cities;
  }

  async getFlightByNumber(authHeader: string, flightNumber: string) {
    const user = await this.authenticate(authHeader);
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      flightNumber,
      SearchType.FLIGHT_NUMBER,
    );
    return this.fetchWithCache(
      `flight:${flightNumber}`,
      `${this.apiUrl}/api/flights/${flightNumber}`,
    );
  }

  async getFlightsByRoute(
    authHeader: string,
    departure: string,
    arrival: string,
  ) {
    this.logger.log(`Получение рейсов по маршруту: ${departure} -> ${arrival}`);

    const user = await this.authenticate(authHeader);
    this.logger.log(
      `Аутентифицирован пользователь ID: ${user.id}, регион: ${user.dbRegion}`,
    );

    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      `${departure}-${arrival}`,
      SearchType.CITY,
    );

    const apiUrl = `${this.apiUrl}/api/live/flight-positions/light?airports=${departure},${arrival}`;
    this.logger.log(`Запрос к внешнему API: ${apiUrl}`);

    try {
      const response = await this.fetchWithCache(
        `route:${departure}-${arrival}`,
        apiUrl,
      );

      this.logger.log(
        `Успешно получены данные от API: ${JSON.stringify(response).slice(0, 500)}...`,
      );
      return response;
    } catch (error) {
      this.logger.error(`Ошибка при получении данных от API: ${error.message}`);
      throw error;
    }
  }

  async getFlightsByRouteAndDate(
    authHeader: string,
    departure: string,
    arrival: string,
    date: string,
  ) {
    this.logger.log(
      `Получение рейсов по маршруту ${departure} -> ${arrival} на ${date}`,
    );

    const user = await this.authenticate(authHeader);
    this.logger.log(
      `Аутентифицирован пользователь ID: ${user.id}, регион: ${user.dbRegion}`,
    );

    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      `${departure}-${arrival}:${date}`,
      SearchType.CITY,
    );

    const cacheKey = `route:${departure}-${arrival}:${date}`;
    let queryDate = date;

    // Минимально разрешенная дата (сегодня + 7 дней)
    const minAllowedDate = new Date();
    minAllowedDate.setDate(minAllowedDate.getDate() + 7);
    const minAllowedDateString = minAllowedDate.toISOString().split('T')[0];

    if (date < minAllowedDateString) {
      // Если дата меньше разрешенной, запрашиваем аналогичную неделю вперед
      const newDate = new Date(date);
      newDate.setDate(newDate.getDate() + 7);
      queryDate = newDate.toISOString().split('T')[0];

      this.logger.warn(
        `Дата ${date} недоступна, запрашиваем аналогичную неделю вперед: ${queryDate}`,
      );
    }

    const departuresUrl = `${this.apiUrl}/flightsFuture?key=${this.apiKey}&type=departure&iataCode=${departure}&date=${queryDate}`;
    const arrivalsUrl = `${this.apiUrl}/flightsFuture?key=${this.apiKey}&type=arrival&iataCode=${arrival}&date=${queryDate}`;

    this.logger.log(`Запрос расписания вылетов: ${departuresUrl}`);
    this.logger.log(`Запрос расписания прилетов: ${arrivalsUrl}`);

    try {
      const [departures, arrivals] = await Promise.all([
        this.fetchWithCache(`${cacheKey}:departures`, departuresUrl),
        this.fetchWithCache(`${cacheKey}:arrivals`, arrivalsUrl),
      ]);

      this.logger.log(
        `Ответ на departures: ${JSON.stringify(departures).slice(0, 500)}...`,
      );
      this.logger.log(
        `Ответ на arrivals: ${JSON.stringify(arrivals).slice(0, 500)}...`,
      );

      const validDepartures = Array.isArray(departures) ? departures : [];
      const validArrivals = Array.isArray(arrivals) ? arrivals : [];

      const flights = validDepartures.filter((dep) =>
        validArrivals.some(
          (arr) => arr.flight?.iataNumber === dep.flight?.iataNumber,
        ),
      );

      if (flights.length === 0) {
        this.logger.warn(`Нет рейсов ${departure} → ${arrival} на ${date}`);
      } else {
        this.logger.log(
          `Найдено ${flights.length} рейсов, подставляем нужную дату (${date}) и убираем дубли`,
        );
      }

      // Убираем дубликаты и проставляем реальную дату
      const uniqueFlights = flights
        .map((flight) => ({
          ...flight,
          date, // Проставляем реальную дату пользователя
        }))
        .filter(
          (flight, index, self) =>
            index ===
            self.findIndex(
              (f) => f.flight.iataNumber === flight.flight.iataNumber,
            ),
        );

      return uniqueFlights;
    } catch (error) {
      this.logger.error(`Ошибка запроса к Aviation Edge: ${error.message}`);
      throw new HttpException(
        'Ошибка получения данных о рейсах',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getFlightsByDate(authHeader: string, date: string) {
    const user = await this.authenticate(authHeader);
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      date,
      SearchType.FLIGHT_DATE,
    );
    return this.fetchWithCache(
      `flights:${date}`,
      `${this.apiUrl}/api/historic/flights?date=${date}`,
    );
  }

  async getFlightsFromAirportToday(airportCode: string) {
    return this.fetchWithCache(
      `departures:${airportCode}`,
      `${this.apiUrl}/api/live/flights?departure=${airportCode}`,
    );
  }

  private async fetchWithCache(cacheKey: string, url: string): Promise<any> {
    try {
      this.logger.log(`Checking cache for key: ${cacheKey}`);
      const cachedData = await this.redisService.get(cacheKey);
      if (cachedData) {
        this.logger.log(`Cache hit for key: ${cacheKey}`);
        return JSON.parse(cachedData);
      }

      this.logger.log(`Cache miss. Fetching data from: ${url}`);
      const response = await firstValueFrom(this.httpService.get(url));

      this.logger.log(`Data successfully fetched from: ${url}`);
      await this.redisService.set(
        cacheKey,
        JSON.stringify(response.data),
        this.cacheTTL,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Request to ${url} failed: ${error.message}`);
      throw new HttpException(
        'Ошибка соединения с API Aviation Edge',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
  async getUnmoderatedFlights(authHeader: string) {
    const { dbRegion } = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(dbRegion);

    const flights = await db.flight.findMany({
      where: { status: FlightStatus.PENDING },
    });

    return flights.length
      ? flights
      : { message: 'Нет неподтвержденных рейсов' };
  }

  async approveFlightModeration(authHeader: string, flightId: string) {
    const { dbRegion } = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(dbRegion);

    const flight = await db.flight.findUnique({
      where: { id: Number(flightId) },
    });
    if (!flight) throw new NotFoundException('Рейс не найден');

    await db.flight.update({
      where: { id: Number(flightId) },
      data: { status: FlightStatus.CONFIRMED },
    });

    return { message: `Рейс ${flightId} подтвержден` };
  }

  async rejectFlightModeration(authHeader: string, flightId: string) {
    const { dbRegion } = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(dbRegion);

    const flight = await db.flight.findUnique({
      where: { id: Number(flightId) },
    });
    if (!flight) throw new NotFoundException('Рейс не найден');

    await db.flight.delete({ where: { id: Number(flightId) } });

    return { message: `Рейс ${flightId} отклонен и удален` };
  }
}
