import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RedisService } from 'src/RedisModule/redis.service';
import { UsersService } from 'src/UserModule/users.service';
import { DbRegion, FlightStatus, SearchType } from '@prisma/client';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { TelegramService } from 'src/TelegramModule/telegram.service';
import { CheckFlightJobDto } from './dto/check-flight-job.dto';

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
    @InjectQueue('flightCheckQueue')
    private readonly flightCheckQueue: Queue,
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
    try {
      const user = await this.authenticate(authHeader);

      const flightDate = new Date(flightData.date);
      if (isNaN(flightDate.getTime())) {
        throw new BadRequestException('Некорректный формат даты');
      }

      const flightExists = await this.getFlightsByRouteAndDate(
        authHeader,
        flightData.departure,
        flightData.arrival,
        flightDate.toISOString().split('T')[0],
      );

      if (!flightExists || !flightExists.length) {
        throw new BadRequestException(
          'Рейс с такими параметрами не найден в AVIATION_EDGE. Проверьте данные',
        );
      }

      const db = this.prisma.getDatabase(user.dbRegion);

      const firstMatch = flightExists[0];
      const iataNumber = firstMatch?.flight?.iataNumber || null;

      const flight = await db.flight.create({
        data: {
          userId: user.id,
          departure: flightData.departure,
          dbRegion: user.dbRegion,
          arrival: flightData.arrival,
          date: flightDate,
          description: flightData.description,
          documentUrl: flightData.documentUrl || null,
          status: FlightStatus.PENDING,
          iataNumber,
        },
      });

      const now = Date.now();
      const delayCheckTime = new Date(flightDate);
      delayCheckTime.setMinutes(delayCheckTime.getMinutes() + 20); // через 20 мин после вылета

      await this.flightCheckQueue.add(
        'check-flight',
        {
          flightId: flight.id,
          region: user.dbRegion,
        } as CheckFlightJobDto,
        {
          delay: Math.max(delayCheckTime.getTime() - now, 0),
          attempts: 3,
          backoff: 10 * 60 * 1000,
        },
      );

      return { message: 'Рейс создан', flight };
    } catch (error) {
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async uploadDocument(
    authHeader: string,
    flightId: string,
    dbRegion: DbRegion,
  ) {
    this.logger.log(
      `Starting document upload for flightId=${flightId}, region=${dbRegion}`,
    );

    try {
      // 1. Аутентификация пользователя
      const user = await this.authenticate(authHeader);
      this.logger.log(`Authenticated user: id=${user.id}, email=${user.email}`);

      // 2. Получаем базу данных
      const db = this.prisma.getDatabase(dbRegion);
      if (!db) {
        const errorMsg = `Database for region ${dbRegion} not found`;
        this.logger.error(errorMsg);
        throw new InternalServerErrorException({ message: errorMsg, dbRegion });
      }

      // 3. Ищем рейс
      const flight = await db.flight.findUnique({
        where: { id: Number(flightId) },
      });

      if (!flight) {
        const errorMsg = `Flight not found: id=${flightId} in region=${dbRegion}`;
        this.logger.warn(errorMsg);
        throw new NotFoundException({ message: errorMsg, flightId, dbRegion });
      }

      this.logger.log(
        `Flight found: id=${flight.id}, ownerId=${flight.userId}`,
      );

      // 4. Проверяем владельца рейса
      if (flight.userId !== user.id) {
        const errorMsg = `User ${user.id} is not the owner of flight ${flight.id}`;
        this.logger.warn(errorMsg);
        throw new ForbiddenException({
          message: errorMsg,
          userId: user.id,
          flightId,
        });
      }

      // 5. Генерируем URL документа
      const documentUrl = `${this.baseUrl}/flights/${dbRegion}/${flightId}/document`;
      this.logger.log(`Generated document URL: ${documentUrl}`);

      await this.telegramService.delegateToModeration(
        'flight',
        flight.id,
        user.dbRegion,
      );

      // 6. Обновляем запись о рейсе
      try {
        await db.flight.update({
          where: { id: Number(flightId) },
          data: { documentUrl },
        });
        this.logger.log(`Flight document updated successfully: ${documentUrl}`);
      } catch (error) {
        const errorMsg = `Failed to update flight document: ${error.message}`;
        this.logger.error(errorMsg, error.stack);
        throw new InternalServerErrorException({
          message: 'Ошибка при обновлении данных рейса',
          details: error.message,
        });
      }

      return { message: 'Документ загружен', documentUrl };
    } catch (error) {
      this.logger.error(
        `Document upload failed: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        {
          message: error.message,
          details: error.response || error.stack,
          statusCode: error.status || 500,
        },
        error.status || 500,
      );
    }
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

  async getAllLiveFlights(authHeader: string) {
    this.logger.log(`Получение всех онлайн-рейсов (в воздухе)`);

    const user = await this.authenticate(authHeader);
    this.logger.log(
      `Аутентифицирован пользователь ID: ${user.id}, регион: ${user.dbRegion}`,
    );

    const cacheKey = `live:all`;
    const url = `${this.apiUrl}/flights?key=${this.apiKey}`;

    try {
      const liveFlights = await this.fetchWithCache(cacheKey, url);

      const validFlights = Array.isArray(liveFlights) ? liveFlights : [];

      this.logger.log(`Получено ${validFlights.length} рейсов в воздухе`);

      return validFlights;
    } catch (error) {
      this.logger.error(`Ошибка получения живых рейсов: ${error.message}`);
      throw new HttpException(
        'Ошибка получения данных о живых рейсах',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
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

  async getActiveFlights() {
    const databases = ['RU', 'OTHER', 'PENDING'].map((region) =>
      this.prisma.getDatabase(region as DbRegion),
    );

    const flights = await Promise.all(
      databases.map((db) =>
        db.flight.findMany({
          where: { status: 'IN_PROGRESS' },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    );

    return flights.flat(); // Объединяем массивы из всех баз
  }

  // 2. Получение всех архивных рейсов (из всех баз)
  async getArchivedFlights() {
    const databases = ['RU', 'OTHER', 'PENDING'].map((region) =>
      this.prisma.getDatabase(region as DbRegion),
    );

    const flights = await Promise.all(
      databases.map((db) =>
        db.flight.findMany({
          where: { status: 'ARCHIVED' },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    );

    return flights.flat(); // Объединяем массивы из всех баз
  }

  // 3. Получение МОИХ рейсов (где я исполнитель)
  async getMyFlights(authHeader: string) {
    const user = await this.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    return db.flight.findMany({
      where: { userId: user.id }, // Только те, где user — исполнитель
      orderBy: { createdAt: 'desc' },
    });
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
