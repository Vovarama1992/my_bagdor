import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { UsersModule } from 'src/UserModule/users.module';
import { TelegramModule } from 'src/TelegramModule/telegram.module';
import { ConfigModule } from '@nestjs/config';
import { DeliveryController } from './delivery-stage.controller';
import { DeliveryStageService } from './delivery-stage.service';
import { MessageModule } from 'src/MessageModule/message.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    TelegramModule,
    ConfigModule,
    MessageModule,
  ],
  controllers: [OrderController, DeliveryController],
  providers: [OrderService, DeliveryStageService],
})
export class OrderModule {}
