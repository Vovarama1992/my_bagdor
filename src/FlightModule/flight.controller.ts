import { Controller, Get, Param } from '@nestjs/common';
import { FlightService } from './flight.service';

@Controller('flights')
export class FlightController {
  constructor(private readonly flightService: FlightService) {}

  @Get('cities')
  async getCities() {
    return this.flightService.getCities();
  }

  @Get('airports')
  async getAirports() {
    return this.flightService.getAirports();
  }

  @Get(':flightNumber')
  async getFlightByNumber(@Param('flightNumber') flightNumber: string) {
    return this.flightService.getFlightByNumber(flightNumber);
  }

  @Get('route/:departure/:arrival')
  async getFlightsByRoute(
    @Param('departure') departure: string,
    @Param('arrival') arrival: string,
  ) {
    return this.flightService.getFlightsByRoute(departure, arrival);
  }

  @Get('route/:departure/:arrival/:date')
  async getFlightsByRouteAndDate(
    @Param('departure') departure: string,
    @Param('arrival') arrival: string,
    @Param('date') date: string,
  ) {
    return this.flightService.getFlightsByRouteAndDate(
      departure,
      arrival,
      date,
    );
  }

  @Get('date/:date')
  async getFlightsByDate(@Param('date') date: string) {
    return this.flightService.getFlightsByDate(date);
  }

  @Get('departures/:airportCode')
  async getFlightsFromAirportToday(@Param('airportCode') airportCode: string) {
    return this.flightService.getFlightsFromAirportToday(airportCode);
  }
}
