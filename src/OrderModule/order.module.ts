import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { UsersModule } from 'src/UserModule/users.module';
import { FlightModule } from 'src/FlightModule/flight.module';
import { TelegramModule } from 'src/TelegramModule/telegram.module';

@Module({
  imports: [PrismaModule, UsersModule, FlightModule, TelegramModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
