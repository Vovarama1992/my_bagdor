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

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
  ) {
    this.apiUrl = this.configService.get<string>(
      'FR24_API_URL',
      'https://fr24api.flightradar24.com/api/sandbox',
    );
    this.apiKey = this.configService.get<string>('FR24_PRODUCTION_KEY');
    this.logger.log(`FlightService initialized with API URL: ${this.apiUrl}`);
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
        'Рейс с такими параметрами не найден в FR24. Проверьте данные',
      );
    }

    const db = this.prisma.getDatabase(user.dbRegion);

    const flight = await db.flight.create({
      data: {
        userId: user.id,
        departure: flightData.departure,
        arrival: flightData.arrival,
        date: flightData.date,
        description: flightData.description,
        documentUrl: flightData.documentUrl || null,
        status: FlightStatus.PENDING,
      },
    });

    await this.telegramService.sendFlightForModeration(flight, user.dbRegion);

    return { message: 'Рейс создан и отправлен на модерацию', flight };
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

  async getCities(authHeader: string) {
    const user = await this.authenticate(authHeader);
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      'ALL_CITIES',
      SearchType.CITY,
    );
    return this.getAirports(authHeader);
  }

  async getAirports(authHeader: string) {
    const user = await this.authenticate(authHeader);
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      'ALL_AIRPORTS',
      SearchType.AIRPORT,
    );
    return this.fetchWithCache(
      'airports-light',
      `${this.apiUrl}/static/airports/light`,
    );
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
      `${this.apiUrl}/flight-tracks?flight_id=${flightNumber}`,
    );
  }

  async getFlightsByRoute(
    authHeader: string,
    departure: string,
    arrival: string,
  ) {
    const user = await this.authenticate(authHeader);
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      `${departure}-${arrival}`,
      SearchType.CITY,
    );
    return this.fetchWithCache(
      `route:${departure}-${arrival}`,
      `${this.apiUrl}/live/flight-positions/full?routes=${departure}-${arrival}`,
    );
  }

  async getFlightsByRouteAndDate(
    authHeader: string,
    departure: string,
    arrival: string,
    date: string,
  ) {
    const user = await this.authenticate(authHeader);
    await this.usersService.saveSearchHistory(
      user.id,
      user.dbRegion,
      `${departure}-${arrival}:${date}`,
      SearchType.CITY,
    );
    return this.fetchWithCache(
      `route:${departure}-${arrival}:${date}`,
      `${this.apiUrl}/historic/flight-positions/full?routes=${departure}-${arrival}&timestamp=${date}`,
    );
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
      `${this.apiUrl}/historic/flight-positions/full?timestamp=${date}`,
    );
  }

  async getFlightsFromAirportToday(airportCode: string) {
    return this.fetchWithCache(
      `departures:${airportCode}`,
      `${this.apiUrl}/live/flight-positions/full?airports=outbound:${airportCode}`,
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
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }),
      );

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
        'Ошибка соединения с API Flightradar24',
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
