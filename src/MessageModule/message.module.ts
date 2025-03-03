import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { EmailService } from './email.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [SmsService, EmailService],
  exports: [SmsService, EmailService],
})
export class MessageModule {}
