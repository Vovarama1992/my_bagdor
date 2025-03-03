import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RedisService } from 'src/RedisModule/redis.service';

@Injectable()
export class FlightService {
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

  async getCities(): Promise<any> {
    const cacheKey = 'cities';
    const cachedCities = await this.redisService.get(cacheKey);

    if (cachedCities) {
      return JSON.parse(cachedCities);
    }

    const url = `${this.apiUrl}/cities`;
    const response = await firstValueFrom(
      this.httpService.get(url, { headers: this.getAuthHeaders() }),
    );

    await this.redisService.set(
      cacheKey,
      JSON.stringify(response.data),
      this.cacheTTL,
    );

    return response.data;
  }

  async getAirports(): Promise<any> {
    const cacheKey = 'airports';
    const cachedAirports = await this.redisService.get(cacheKey);

    if (cachedAirports) {
      return JSON.parse(cachedAirports);
    }

    const url = `${this.apiUrl}/airports`;
    const response = await firstValueFrom(
      this.httpService.get(url, { headers: this.getAuthHeaders() }),
    );

    await this.redisService.set(
      cacheKey,
      JSON.stringify(response.data),
      this.cacheTTL,
    );

    return response.data;
  }

  async getFlightByNumber(flightNumber: string): Promise<any> {
    const url = `${this.apiUrl}/flights/${flightNumber}`;
    const response = await firstValueFrom(
      this.httpService.get(url, { headers: this.getAuthHeaders() }),
    );
    return response.data;
  }

  async getFlightsByRoute(departure: string, arrival: string): Promise<any> {
    const url = `${this.apiUrl}/flights/route/${departure}/${arrival}`;
    const response = await firstValueFrom(
      this.httpService.get(url, { headers: this.getAuthHeaders() }),
    );
    return response.data;
  }

  async getFlightsByRouteAndDate(
    departure: string,
    arrival: string,
    date: string,
  ): Promise<any> {
    const url = `${this.apiUrl}/flights/route/${departure}/${arrival}/${date}`;
    const response = await firstValueFrom(
      this.httpService.get(url, { headers: this.getAuthHeaders() }),
    );
    return response.data;
  }

  async getFlightsByDate(date: string): Promise<any> {
    const url = `${this.apiUrl}/flights/date/${date}`;
    const response = await firstValueFrom(
      this.httpService.get(url, { headers: this.getAuthHeaders() }),
    );
    return response.data;
  }

  async getFlightsFromAirportToday(airportCode: string): Promise<any> {
    const url = `${this.apiUrl}/flights/departures/${airportCode}`;
    const response = await firstValueFrom(
      this.httpService.get(url, { headers: this.getAuthHeaders() }),
    );
    return response.data;
  }
}
