import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { ModerationService } from './moderation.service';
import { UsersModule } from 'src/UserModule/users.module';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule],
  providers: [TelegramService, ModerationService],
  exports: [TelegramService],
})
export class TelegramModule {}
