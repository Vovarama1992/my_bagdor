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
    this.logger.log(`FlightService initialized with API URL: ${this.apiUrl}`);
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
      this.logger.log(`Checking cache for key: ${cacheKey}`);
      const cachedData = await this.redisService.get(cacheKey);
      if (cachedData) {
        this.logger.log(`Cache hit for key: ${cacheKey}`);
        return JSON.parse(cachedData);
      }

      this.logger.log(`Cache miss. Fetching data from: ${url}`);
      const response = await firstValueFrom(
        this.httpService.get(url, { headers: this.getAuthHeaders() }),
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
      if (error.response) {
        const status = error.response.status;
        const apiMessage =
          error.response.data?.message ||
          JSON.stringify(error.response.data) ||
          'Unknown API error';
        this.logger.error(`API Error ${status}: ${apiMessage} (URL: ${url})`);
        throw new HttpException(apiMessage, status);
      }
      throw new HttpException(
        'Ошибка соединения с API Flightradar24',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getAirportByCode(code: string): Promise<any> {
    this.logger.log(`Fetching airport by code: ${code}`);
    return this.fetchWithCache(
      `airport:${code}`,
      `${this.apiUrl}/static/airports/${code}/full`,
    );
  }

  async getAirportsLight(): Promise<any> {
    this.logger.log('Fetching light airports list');
    return this.fetchWithCache(
      'airports-light',
      `${this.apiUrl}/static/airports/light`,
    );
  }

  async getAirlineByICAO(icao: string): Promise<any> {
    this.logger.log(`Fetching airline by ICAO: ${icao}`);
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

    this.logger.log(`Fetching live flights with params: ${params.join(', ')}`);
    return this.fetchWithCache(`live-flights:${bounds || 'global'}`, url);
  }

  async getFlightByNumber(flightNumber: string): Promise<any> {
    this.logger.log(`Fetching flight by number: ${flightNumber}`);
    return this.fetchWithCache(
      `flight:${flightNumber}`,
      `${this.apiUrl}/flight-tracks?flight_id=${flightNumber}`,
    );
  }

  async getFlightsByRoute(departure: string, arrival: string): Promise<any> {
    this.logger.log(`Fetching flights from ${departure} to ${arrival}`);
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
    this.logger.log(
      `Fetching flights from ${departure} to ${arrival} on ${date}`,
    );
    return this.fetchWithCache(
      `route:${departure}-${arrival}:${date}`,
      `${this.apiUrl}/historic/flight-positions/full?routes=${departure}-${arrival}&timestamp=${date}`,
    );
  }

  async getFlightsByDate(date: string): Promise<any> {
    this.logger.log(`Fetching flights for date: ${date}`);
    return this.fetchWithCache(
      `flights:${date}`,
      `${this.apiUrl}/historic/flight-positions/full?timestamp=${date}`,
    );
  }

  async getFlightsFromAirportToday(airportCode: string): Promise<any> {
    this.logger.log(`Fetching departures from airport: ${airportCode}`);
    return this.fetchWithCache(
      `departures:${airportCode}`,
      `${this.apiUrl}/live/flight-positions/full?airports=outbound:${airportCode}`,
    );
  }

  async getUsage(): Promise<any> {
    this.logger.log('Fetching API usage statistics');
    return this.fetchWithCache('usage', `${this.apiUrl}/usage`);
  }
}
