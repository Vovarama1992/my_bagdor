import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { JwtModule } from 'src/JwtModule/jwt.module';
import { AuthController } from './auth.controller';
import { SmsService } from '../MessageModule/sms.service';
import { EmailService } from '../MessageModule/email.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { PassportModule } from '@nestjs/passport';
import { AppleStrategy } from './strategies/apple.strategy';
import { RedisModule } from 'src/RedisModule/redis.module';
import { MessageModule } from 'src/MessageModule/message.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule,
    RedisModule,
    PassportModule,
    MessageModule,
  ],
  providers: [
    AuthService,
    SmsService,
    EmailService,
    GoogleStrategy,
    AppleStrategy,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
