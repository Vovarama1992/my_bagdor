import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { UsersModule } from './UserModule/users.module';
import { JwtModule } from './JwtModule/jwt.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './PrismaModule/prisma.module';
import { AuthModule } from './AuthModule/auth.module';
import * as express from 'express';
import { join } from 'path';
import { FlightModule } from './FlightModule/flight.module';
import { TelegramModule } from './TelegramModule/telegram.module';
import { OrderModule } from './OrderModule/order.module';
import { ReviewModule } from './ReviewModule/review.module';
import { AdminModule } from './AdminModule/admin.module';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'redis-service',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),

    AuthModule,

    FlightModule,
    AdminModule,

    JwtModule,
    OrderModule,
    ReviewModule,

    UsersModule,
    TelegramModule,

    PrismaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(express.static(join(__dirname, '..', 'uploads')))
      .forRoutes('*');
  }
}
