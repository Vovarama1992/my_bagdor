import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';

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

  async sendVerificationEmail(
    email: string,
    name: string,
    code: string,
  ): Promise<void> {
    this.logger.log(`Sending verification email to ${email} with code ${code}`);

    const subject = 'Подтверждение регистрации';
    const text = `Привет ${name},
    
Это Bagdoor! Спасибо за регистрацию в нашем приложении! Мы рады, что ты теперь с нами.

Чтобы продолжить процесс регистрации, пожалуйста, подтверди свой адрес электронной почты, введя данный код в приложении:
${code}

Код подтверждения действует 5 мин.

В целях безопасности вашего аккаунта никому не сообщайте следующий код подтверждения.

При возникновении любых вопросов свяжитесь с нашей службой поддержки, отправив электронное письмо на адрес ${this.supportEmail}

С любовью, команда Bagdoor`;

    const html = `
      <p>Привет,</p>
      <p>Это <strong>Bagdoor</strong>! Спасибо за регистрацию в нашем приложении! Мы рады, что ты теперь с нами.</p>
      <p><strong>Чтобы продолжить процесс регистрации, пожалуйста, подтверди свой адрес электронной почты, введя данный код в приложении:</strong></p>
      <h2>${code}</h2>
      <p><i>Код подтверждения действует 5 мин.</i></p>
      <p>В целях безопасности никому не сообщайте этот код.</p>
      <p>Если у вас возникли вопросы, напишите в поддержку: <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></p>
      <p>С любовью, команда Bagdoor</p>
    `;

    try {
      const info = await this.transporter.sendMail({
        from: this.fromEmail,
        to: email,
        subject,
        text,
        html,
      });

      this.logger.log(`Email sent: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
    }
  }
}
