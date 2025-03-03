import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  private smsApiUrl: string;
  private smsLogin: string;
  private smsPassword: string;

  constructor(private configService: ConfigService) {
    this.smsApiUrl = this.configService.get<string>('SMS_API_URL');
    this.smsLogin = this.configService.get<string>('SMS_LOGIN');
    this.smsPassword = this.configService.get<string>('SMS_PASSWORD');
  }

  async sendVerificationSms(phone: string, code: string): Promise<void> {
    const authHeader = `Basic ${Buffer.from(`${this.smsLogin}:${this.smsPassword}`).toString('base64')}`;

    await axios.post(
      this.smsApiUrl,
      { to: phone, txt: `Your verification code: ${code}` },
      { headers: { Authorization: authHeader } },
    );
  }
}
