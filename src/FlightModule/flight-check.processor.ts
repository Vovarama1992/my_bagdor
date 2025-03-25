import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { FlightStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CheckFlightJobDto } from './dto/check-flight-job.dto';

@Processor('flightCheckQueue')
@Injectable()
export class FlightCheckProcessor {
  private readonly logger = new Logger(FlightCheckProcessor.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.apiUrl = this.configService.get<string>(
      'AVIATION_EDGE_API_URL',
      'https://aviation-edge.com/v2/public',
    );
    this.apiKey = this.configService.get<string>('AVIATION_EDGE_API_KEY');
  }

  @Process('check-flight')
  async handle(job: Job<CheckFlightJobDto>) {
    const { flightId, region } = job.data;
    const db = this.prisma.getDatabase(region);

    const flight = await db.flight.findUnique({ where: { id: flightId } });
    if (!flight) {
      this.logger.warn(`Рейс ID ${flightId} не найден в регионе ${region}`);
      return;
    }

    const flightDateStr = flight.date.toISOString().split('T')[0];
    this.logger.log(
      `Проверка статуса рейса ${flight.departure} → ${flight.arrival} от ${flightDateStr}`,
    );

    try {
      const response = await axios.get(`${this.apiUrl}/flights`, {
        params: { key: this.apiKey },
      });

      const liveFlights = Array.isArray(response.data) ? response.data : [];

      const match = liveFlights.find((f) => {
        const isEnRoute = f.status === 'en-route';
        const isSameDeparture = f.departure?.iataCode === flight.departure;
        const isSameArrival = f.arrival?.iataCode === flight.arrival;

        if (flight.iataNumber) {
          return (
            f.flight?.iataNumber === flight.iataNumber &&
            isSameDeparture &&
            isSameArrival &&
            isEnRoute
          );
        }

        const liveDate = f.departure?.scheduledTime
          ? new Date(f.departure.scheduledTime).toISOString().split('T')[0]
          : null;

        return (
          isSameDeparture &&
          isSameArrival &&
          liveDate === flightDateStr &&
          isEnRoute
        );
      });

      if (match) {
        await db.flight.update({
          where: { id: flight.id },
          data: { status: FlightStatus.IN_PROGRESS },
        });
        this.logger.log(`Рейс ID ${flight.id} переведён в статус IN_PROGRESS`);
      } else {
        this.logger.warn(`Совпадение не найдено — рейс пока не в воздухе`);
        throw new Error('Рейс не найден в живых данных, будет повтор');
      }
    } catch (error) {
      this.logger.error(`Ошибка проверки рейса: ${error.message}`);
      throw error;
    }
  }
}
