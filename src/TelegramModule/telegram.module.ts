import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { PrismaModule } from 'src/PrismaModule/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
