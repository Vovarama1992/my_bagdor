import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { FlightService } from './flight.service';
import { FlightController } from './flight.controller';
import { RedisModule } from 'src/RedisModule/redis.module';
import { TelegramModule } from 'src/TelegramModule/telegram.module';
import { UsersModule } from 'src/UserModule/users.module';
import { PrismaModule } from 'src/PrismaModule/prisma.module';

@Module({
  imports: [
    HttpModule,
    PrismaModule,
    ConfigModule,
    RedisModule,
    TelegramModule,
    UsersModule,
  ],
  providers: [FlightService],
  controllers: [FlightController],
})
export class FlightModule {}
