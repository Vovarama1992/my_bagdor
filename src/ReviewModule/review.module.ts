import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { UsersModule } from 'src/UserModule/users.module';
import { TelegramModule } from 'src/TelegramModule/telegram.module';

@Module({
  imports: [PrismaModule, UsersModule, TelegramModule],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
