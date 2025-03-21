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
import { ResponseService } from './response.service';
import { DisputeService } from './dispute.service';
import { AdminGuard } from 'guards/admin.guard';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    PrismaModule,
    JwtModule,
    UsersModule,
    TelegramModule,
    ConfigModule,
    MessageModule,
  ],
  controllers: [OrderController, DeliveryController],
  providers: [
    OrderService,
    DeliveryStageService,
    ResponseService,
    DisputeService,
    AdminGuard,
  ],
})
export class OrderModule {}
