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
  UploadedFile,
  BadRequestException,
  UseInterceptors,
  Res,
  NotFoundException,
  Logger,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { FlightService } from './flight.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { DbRegion } from '@prisma/client';

const DOCUMENTS_PATH = path.join(process.cwd(), 'storage', 'flight_documents');

@ApiTags('Flights')
@Controller('flights')
export class FlightController {
  private readonly logger = new Logger(FlightController.name);
  constructor(
    private readonly flightService: FlightService,
    private readonly prismaService: PrismaService,
  ) {}
  @Post(':dbRegion/:flightId/upload-document')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          if (!fs.existsSync(DOCUMENTS_PATH)) {
            fs.mkdirSync(DOCUMENTS_PATH, { recursive: true });
          }
          cb(null, DOCUMENTS_PATH);
        },
        filename: (req, file, cb) => {
          const { flightId, dbRegion } = req.params;
          const extension = path.extname(file.originalname);
          const filename = `flight_${dbRegion}_${flightId}${extension}`;
          cb(null, filename);
        },
      }),
    }),
  )
  async uploadDocument(
    @Headers('authorization') authHeader: string,
    @Param('dbRegion') dbRegion: DbRegion,
    @Param('flightId') flightId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.logger.log(
      `Received request to upload document for flightId=${flightId}, region=${dbRegion}`,
    );

    if (!file) {
      this.logger.warn(`File not provided for flight ${flightId}`);
      throw new BadRequestException('Файл не загружен');
    }

    this.logger.log(
      `File uploaded: filename=${file.filename}, size=${file.size} bytes`,
    );

    return this.flightService.uploadDocument(authHeader, flightId, dbRegion);
  }

  @Get(':dbRegion/:flightId/document')
  async getDocument(
    @Param('dbRegion') dbRegion: string,
    @Param('flightId') flightId: string,
    @Res() res: Response,
  ) {
    const normalizedRegion = dbRegion.toLowerCase(); // Нормализуем регистр
    this.logger.log(
      `Fetching document for flightId=${flightId}, region=${normalizedRegion}`,
    );

    try {
      // 1. Получаем список всех файлов в папке
      const files = fs.readdirSync(DOCUMENTS_PATH);

      // 2. Ищем файл, игнорируя регистр в `dbRegion`
      const file = files.find((f) =>
        f.toLowerCase().startsWith(`flight_${normalizedRegion}_${flightId}`),
      );

      if (!file) {
        const errorMsg = `Document not found for flight ${flightId} in region ${normalizedRegion}`;
        this.logger.warn(errorMsg);
        throw new NotFoundException({
          message: errorMsg,
          flightId,
          dbRegion: normalizedRegion,
        });
      }

      const filePath = path.join(DOCUMENTS_PATH, file);
      this.logger.log(`Document found: ${filePath}`);

      // 3. Отправляем файл
      return res.sendFile(filePath);
    } catch (error) {
      this.logger.error(
        `Failed to fetch document: ${error.message}`,
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

  @ApiOperation({ summary: 'Получить все активные рейсы(из нашей БД)' })
  @ApiResponse({
    status: 200,
    description: 'Список активных рейсов',
  })
  @Get('active')
  async getActiveFlights() {
    return this.flightService.getActiveFlights();
  }

  @ApiOperation({ summary: 'Получить все рейсы в воздухе (онлайн) - из АПИ' })
  @ApiResponse({
    status: 200,
    description: 'Список рейсов в реальном времени',
  })
  @ApiResponse({
    status: 401,
    description: 'Пользователь не авторизован',
  })
  @Get('live')
  async getLiveFlights(@Headers('authorization') authHeader: string) {
    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }
    return this.flightService.getAllLiveFlights(authHeader);
  }

  @ApiOperation({ summary: 'Получить все архивные рейсы' })
  @ApiResponse({
    status: 200,
    description: 'Список архивных рейсов',
  })
  @Get('archived')
  async getArchivedFlights() {
    return this.flightService.getArchivedFlights();
  }

  @ApiOperation({ summary: 'Получить мои рейсы (где я исполнитель)' })
  @ApiResponse({
    status: 200,
    description: 'Список рейсов, где пользователь является исполнителем',
  })
  @ApiResponse({
    status: 401,
    description: 'Пользователь не авторизован',
  })
  @Get('my')
  async getMyFlights(@Headers('authorization') authHeader: string) {
    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }
    return this.flightService.getMyFlights(authHeader);
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
