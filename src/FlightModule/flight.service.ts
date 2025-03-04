import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RedisService } from 'src/RedisModule/redis.service';

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
  ) {
    this.apiUrl = this.configService.get<string>('FR24_API_URL');
    this.apiKey = this.configService.get<string>('FR24_PRODUCTION_KEY');
  }

  private getAuthHeaders() {
    return { 'x-api-key': this.apiKey };
  }

  private async fetchWithCache(cacheKey: string, url: string): Promise<any> {
    try {
      // Проверяем кэш
      const cachedData = await this.redisService.get(cacheKey);
      if (cachedData) {
        return JSON.parse(cachedData);
      }

      // Логируем запрос
      this.logger.log(`Fetching data from: ${url}`);

      // Запрос к API
      const response = await firstValueFrom(
        this.httpService.get(url, { headers: this.getAuthHeaders() }),
      );

      // Сохраняем в кэш
      await this.redisService.set(
        cacheKey,
        JSON.stringify(response.data),
        this.cacheTTL,
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Request to ${url} failed: ${error.message}`);

      // Проверяем, есть ли ответ от API
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || 'Unknown API error';
        throw new HttpException(`API Error ${status}: ${message}`, status);
      }

      // Ошибка сети или внутренний сбой
      throw new HttpException(
        'Internal Server Error: API connection failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getCities(): Promise<any> {
    return this.fetchWithCache('cities', `${this.apiUrl}/cities`);
  }

  async getAirports(): Promise<any> {
    return this.fetchWithCache('airports', `${this.apiUrl}/airports`);
  }

  async getFlightByNumber(flightNumber: string): Promise<any> {
    return this.fetchWithCache(
      `flight:${flightNumber}`,
      `${this.apiUrl}/flights/${flightNumber}`,
    );
  }

  async getFlightsByRoute(departure: string, arrival: string): Promise<any> {
    return this.fetchWithCache(
      `route:${departure}-${arrival}`,
      `${this.apiUrl}/flights/route/${departure}/${arrival}`,
    );
  }

  async getFlightsByRouteAndDate(
    departure: string,
    arrival: string,
    date: string,
  ): Promise<any> {
    return this.fetchWithCache(
      `route:${departure}-${arrival}:${date}`,
      `${this.apiUrl}/flights/route/${departure}/${arrival}/${date}`,
    );
  }

  async getFlightsByDate(date: string): Promise<any> {
    return this.fetchWithCache(
      `flights:${date}`,
      `${this.apiUrl}/flights/date/${date}`,
    );
  }

  async getFlightsFromAirportToday(airportCode: string): Promise<any> {
    return this.fetchWithCache(
      `departures:${airportCode}`,
      `${this.apiUrl}/flights/departures/${airportCode}`,
    );
  }
}
