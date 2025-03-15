import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { ModerationService } from './moderation.service';
import { UsersModule } from 'src/UserModule/users.module';
import { PostureReminderService } from './reminder.service';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule],
  providers: [TelegramService, ModerationService, PostureReminderService],
  exports: [TelegramService],
})
export class TelegramModule {}
