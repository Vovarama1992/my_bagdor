import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { FlightService } from './flight.service';

@ApiTags('Flights') // Группа эндпоинтов в Swagger
@Controller('flights')
export class FlightController {
  constructor(private readonly flightService: FlightService) {}

  @ApiOperation({ summary: 'Получить список городов' })
  @ApiResponse({ status: 200, description: 'Список городов успешно получен' })
  @Get('cities')
  async getCities() {
    return this.flightService.getCities();
  }

  @ApiOperation({ summary: 'Получить список аэропортов' })
  @ApiResponse({
    status: 200,
    description: 'Список аэропортов успешно получен',
  })
  @Get('airports')
  async getAirports() {
    return this.flightService.getAirports();
  }

  @ApiOperation({ summary: 'Получить информацию о рейсе по его номеру' })
  @ApiParam({ name: 'flightNumber', example: 'SU100' })
  @ApiResponse({ status: 200, description: 'Данные о рейсе успешно получены' })
  @Get(':flightNumber')
  async getFlightByNumber(@Param('flightNumber') flightNumber: string) {
    return this.flightService.getFlightByNumber(flightNumber);
  }

  @ApiOperation({ summary: 'Получить список рейсов по маршруту' })
  @ApiParam({
    name: 'departure',
    example: 'SVO',
    description: 'Код аэропорта отправления',
  })
  @ApiParam({
    name: 'arrival',
    example: 'JFK',
    description: 'Код аэропорта прибытия',
  })
  @ApiResponse({ status: 200, description: 'Список рейсов успешно получен' })
  @Get('route/:departure/:arrival')
  async getFlightsByRoute(
    @Param('departure') departure: string,
    @Param('arrival') arrival: string,
  ) {
    return this.flightService.getFlightsByRoute(departure, arrival);
  }

  @ApiOperation({ summary: 'Получить список рейсов по маршруту и дате' })
  @ApiParam({
    name: 'departure',
    example: 'SVO',
    description: 'Код аэропорта отправления',
  })
  @ApiParam({
    name: 'arrival',
    example: 'JFK',
    description: 'Код аэропорта прибытия',
  })
  @ApiParam({
    name: 'date',
    example: '2025-03-05',
    description: 'Дата рейса (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Список рейсов на указанную дату успешно получен',
  })
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

  @ApiOperation({ summary: 'Получить список рейсов по дате' })
  @ApiParam({
    name: 'date',
    example: '2025-03-05',
    description: 'Дата рейсов (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Список рейсов на указанную дату успешно получен',
  })
  @Get('date/:date')
  async getFlightsByDate(@Param('date') date: string) {
    return this.flightService.getFlightsByDate(date);
  }

  @ApiOperation({ summary: 'Получить список вылетов из аэропорта на сегодня' })
  @ApiParam({
    name: 'airportCode',
    example: 'SVO',
    description: 'Код аэропорта',
  })
  @ApiResponse({ status: 200, description: 'Список вылетов успешно получен' })
  @Get('departures/:airportCode')
  async getFlightsFromAirportToday(@Param('airportCode') airportCode: string) {
    return this.flightService.getFlightsFromAirportToday(airportCode);
  }
}
