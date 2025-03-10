import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { UsersModule } from 'src/UserModule/users.module';
import { TelegramModule } from 'src/TelegramModule/telegram.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, UsersModule, TelegramModule, ConfigModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
