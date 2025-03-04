import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly smsApiUrl: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.smsApiUrl = this.configService.get<string>(
      'SMS_API_URL',
      'https://api3.greensms.ru/sms/send',
    );
    this.apiKey = this.configService.get<string>('SMS_API_KEY');

    if (!this.apiKey) {
      this.logger.error(
        'API key for GreenSMS is not configured. SMS sending is disabled.',
      );
    } else {
      this.logger.log('SmsService initialized with API key.');
    }
  }

  async sendVerificationSms(phone: string, code: string): Promise<void> {
    const message = `Ваш код подтверждения: ${code}`;
    const payload = {
      to: phone,
      txt: message,
      // Дополнительно, можно указать "from" или "tag", если нужно
    };

    try {
      const response = await axios.post(this.smsApiUrl, payload, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`, // Используем Bearer Token
        },
      });

      this.logger.log(
        `SMS sent successfully to ${phone}. Response: ${JSON.stringify(response.data)}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send SMS to ${phone}. Error: ${error.message}`,
      );
      if (axios.isAxiosError(error) && error.response) {
        this.logger.error(
          `Response data: ${JSON.stringify(error.response.data)}`,
        );
        throw new HttpException(
          `Failed to send SMS: ${error.response.data.error}`,
          error.response.status || HttpStatus.INTERNAL_SERVER_ERROR,
        );
      } else {
        throw new HttpException(
          'Failed to send SMS due to an unknown error.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }
}
