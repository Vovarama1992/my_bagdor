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
    this.apiUrl = this.configService.get<string>(
      'FR24_API_URL',
      'https://fr24api.flightradar24.com/api/sandbox',
    );
    this.apiKey = this.configService.get<string>('FR24_PRODUCTION_KEY');
  }

  private getAuthHeaders() {
    return {
      Accept: 'application/json',
      'Accept-Version': 'v1',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async fetchWithCache(cacheKey: string, url: string): Promise<any> {
    try {
      const cachedData = await this.redisService.get(cacheKey);
      if (cachedData) {
        return JSON.parse(cachedData);
      }

      this.logger.log(`Fetching data from: ${url}`);
      const response = await firstValueFrom(
        this.httpService.get(url, { headers: this.getAuthHeaders() }),
      );

      await this.redisService.set(
        cacheKey,
        JSON.stringify(response.data),
        this.cacheTTL,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Request to ${error.config?.url} failed: ${error.message}`,
      );
      if (error.response) {
        const status = error.response.status;
        const apiMessage =
          error.response.data?.message ||
          JSON.stringify(error.response.data) ||
          'Unknown API error';
        this.logger.error(
          `API Error ${status}: ${apiMessage} (URL: ${error.config?.url})`,
        );
        throw new HttpException(apiMessage, status);
      }
      throw new HttpException(
        'Ошибка соединения с API Flightradar24',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getAirportByCode(code: string): Promise<any> {
    return this.fetchWithCache(
      `airport:${code}`,
      `${this.apiUrl}/static/airports/${code}/full`,
    );
  }

  async getAirportsLight(): Promise<any> {
    return this.fetchWithCache(
      'airports-light',
      `${this.apiUrl}/static/airports/light`,
    );
  }

  async getAirlineByICAO(icao: string): Promise<any> {
    return this.fetchWithCache(
      `airline:${icao}`,
      `${this.apiUrl}/static/airlines/${icao}/light`,
    );
  }

  async getLiveFlights(bounds?: string, airports?: string): Promise<any> {
    let url = `${this.apiUrl}/live/flight-positions/full`;
    const params = [];
    if (bounds) params.push(`bounds=${bounds}`);
    if (airports) params.push(`airports=${airports}`);
    if (params.length) url += `?${params.join('&')}`;

    return this.fetchWithCache(`live-flights:${bounds || 'global'}`, url);
  }

  async getFlightByNumber(flightNumber: string): Promise<any> {
    return this.fetchWithCache(
      `flight:${flightNumber}`,
      `${this.apiUrl}/flight-tracks?flight_id=${flightNumber}`,
    );
  }

  async getFlightsByRoute(departure: string, arrival: string): Promise<any> {
    return this.fetchWithCache(
      `route:${departure}-${arrival}`,
      `${this.apiUrl}/live/flight-positions/full?routes=${departure}-${arrival}`,
    );
  }

  async getFlightsByRouteAndDate(
    departure: string,
    arrival: string,
    date: string,
  ): Promise<any> {
    return this.fetchWithCache(
      `route:${departure}-${arrival}:${date}`,
      `${this.apiUrl}/historic/flight-positions/full?routes=${departure}-${arrival}&timestamp=${date}`,
    );
  }

  async getFlightsByDate(date: string): Promise<any> {
    return this.fetchWithCache(
      `flights:${date}`,
      `${this.apiUrl}/historic/flight-positions/full?timestamp=${date}`,
    );
  }

  async getFlightsFromAirportToday(airportCode: string): Promise<any> {
    return this.fetchWithCache(
      `departures:${airportCode}`,
      `${this.apiUrl}/live/flight-positions/full?airports=outbound:${airportCode}`,
    );
  }

  async getUsage(): Promise<any> {
    return this.fetchWithCache('usage', `${this.apiUrl}/usage`);
  }
}
