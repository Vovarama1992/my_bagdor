import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { FlightService } from './flight.service';
import { FlightController } from './flight.controller';
import { RedisModule } from 'src/RedisModule/redis.module';
import { TelegramModule } from 'src/TelegramModule/telegram.module';

@Module({
  imports: [HttpModule, ConfigModule, RedisModule, TelegramModule],
  providers: [FlightService],
  controllers: [FlightController],
})
export class FlightModule {}
