import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter;
  private fromEmail: string;

  constructor(private configService: ConfigService) {
    this.logger.log('Initializing email service...');

    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.fromEmail = this.configService.get<string>('EMAIL_FROM');

    this.logger.log(
      `SMTP Config: host=${smtpHost}, port=${smtpPort}, user=${smtpUser}`,
    );

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    this.logger.log(`Sending verification email to ${email} with code ${code}`);

    try {
      const info = await this.transporter.sendMail({
        from: this.fromEmail,
        to: email,
        subject: 'Email Verification',
        text: `Your verification code is: ${code}`,
      });

      this.logger.log(`Email sent: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
    }
  }
}
