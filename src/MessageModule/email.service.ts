import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter;
  private fromEmail: string;
  private readonly supportEmail = 'support@bagdoor.io';

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
      secure: smtpPort == 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    this.logger.log(`Sending verification email to ${email} with code ${code}`);

    const subject = 'Подтверждение регистрации';

    // Читаем шаблон
    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'email_code.html',
    );
    let html = fs.readFileSync(templatePath, 'utf8');

    // Меняем только код подтверждения
    html = html.replace(/54690/g, code);

    try {
      const info = await this.transporter.sendMail({
        from: this.fromEmail,
        to: email,
        subject,
        html,
      });

      this.logger.log(`Email sent: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
    }
  }
}
