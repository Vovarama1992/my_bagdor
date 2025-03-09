import {
  Controller,
  Get,
  Param,
  Headers,
  Post,
  Body,
  Query,
  Patch,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { FlightService } from './flight.service';
import { CreateFlightDto } from './dto/create-flight.dto';

@ApiTags('Flights')
@Controller('flights')
export class FlightController {
  constructor(private readonly flightService: FlightService) {}

  @ApiOperation({ summary: 'Создать новый рейс (перевозчик)' })
  @ApiResponse({
    status: 201,
    description: 'Рейс создан и отправлен на модерацию',
  })
  @ApiBody({ type: CreateFlightDto })
  @Post()
  async createFlight(
    @Headers('authorization') authHeader: string,
    @Body() flightData: CreateFlightDto,
  ) {
    return this.flightService.createFlight(authHeader, flightData);
  }

  @ApiOperation({ summary: 'Поиск подтверждённых рейсов в БД (заказчик)' })
  @ApiQuery({
    name: 'departure',
    example: 'SVO',
    description: 'Код аэропорта отправления',
    required: true,
  })
  @ApiQuery({
    name: 'arrival',
    example: 'JFK',
    description: 'Код аэропорта прибытия',
    required: true,
  })
  @ApiQuery({
    name: 'date',
    example: '2025-05-10',
    description: 'Дата рейса (YYYY-MM-DD)',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Список подходящих рейсов' })
  @Get('search')
  async searchFlights(
    @Query('departure') departure: string,
    @Query('arrival') arrival: string,
    @Query('date') date: string,
    @Headers('authorization') authHeader: string,
  ) {
    return this.flightService.searchFlightsForCustomer(
      authHeader,
      departure,
      arrival,
      date,
    );
  }

  @ApiOperation({ summary: 'Обновить статус рейса на ARRIVED (прибыл)' })
  @ApiParam({ name: 'flightId', example: '10', description: 'ID рейса' })
  @ApiResponse({
    status: 200,
    description: 'Статус рейса обновлён на ARRIVED',
  })
  @Patch(':flightId/arrived')
  async markFlightArrived(
    @Param('flightId') flightId: string,
    @Headers('authorization') authHeader: string,
  ) {
    return this.flightService.markFlightAsArrived(authHeader, flightId);
  }

  @ApiOperation({ summary: 'Получить список городов' })
  @ApiResponse({ status: 200, description: 'Список городов успешно получен' })
  @Get('cities')
  async getCities(@Headers('authorization') authHeader: string) {
    return this.flightService.getCities(authHeader);
  }

  @ApiOperation({ summary: 'Получить список аэропортов' })
  @ApiResponse({
    status: 200,
    description: 'Список аэропортов успешно получен',
  })
  @Get('airports')
  async getAirports(@Headers('authorization') authHeader: string) {
    return this.flightService.getAirports(authHeader);
  }

  @ApiOperation({ summary: 'Получить информацию о рейсе по его номеру' })
  @ApiParam({ name: 'flightNumber', example: 'SU100' })
  @ApiResponse({ status: 200, description: 'Данные о рейсе успешно получены' })
  @Get(':flightNumber')
  async getFlightByNumber(
    @Param('flightNumber') flightNumber: string,
    @Headers('authorization') authHeader: string,
  ) {
    return this.flightService.getFlightByNumber(authHeader, flightNumber);
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
    @Headers('authorization') authHeader: string,
  ) {
    return this.flightService.getFlightsByRoute(authHeader, departure, arrival);
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
    @Headers('authorization') authHeader: string,
  ) {
    return this.flightService.getFlightsByRouteAndDate(
      authHeader,
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
  async getFlightsByDate(
    @Param('date') date: string,
    @Headers('authorization') authHeader: string,
  ) {
    return this.flightService.getFlightsByDate(authHeader, date);
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

  @ApiOperation({ summary: 'Получить список немодерированных рейсов' })
  @ApiResponse({ status: 200, description: 'Список рейсов без модерации' })
  @Get('pending-moderation')
  async getUnmoderatedFlights(@Headers('authorization') authHeader: string) {
    return this.flightService.getUnmoderatedFlights(authHeader);
  }

  @ApiOperation({ summary: 'Подтвердить рейс (модерация)' })
  @ApiParam({ name: 'flightId', example: 1, description: 'ID рейса' })
  @ApiResponse({ status: 200, description: 'Рейс подтвержден' })
  @Patch(':flightId/approve')
  async approveFlightModeration(
    @Headers('authorization') authHeader: string,
    @Param('flightId') flightId: string,
  ) {
    return this.flightService.approveFlightModeration(authHeader, flightId);
  }

  @ApiOperation({ summary: 'Отклонить рейс (модерация)' })
  @ApiParam({ name: 'flightId', example: 1, description: 'ID рейса' })
  @ApiResponse({ status: 200, description: 'Рейс удален' })
  @Delete(':flightId/reject')
  async rejectFlightModeration(
    @Headers('authorization') authHeader: string,
    @Param('flightId') flightId: string,
  ) {
    return this.flightService.rejectFlightModeration(authHeader, flightId);
  }
}
