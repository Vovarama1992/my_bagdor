import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { ModerationService } from './moderation.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [TelegramService, ModerationService],
  exports: [TelegramService],
})
export class TelegramModule {}
