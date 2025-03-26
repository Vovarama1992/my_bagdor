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

  constructor(private configService: ConfigService) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.fromEmail = this.configService.get<string>('EMAIL_FROM');

    this.logger.log(
      `Initializing transporter with host ${smtpHost}, port ${smtpPort}`,
    );

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: true, // обязательно для 465 (SSL)
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      logger: true,
      debug: true,
    });
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    const subject = 'Подтверждение регистрации';
    this.logger.log(`Preparing to send verification email to: ${email}`);

    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'email_code.html',
    );

    let html: string;
    try {
      html = fs.readFileSync(templatePath, 'utf8');
      this.logger.log(`Email template loaded from ${templatePath}`);
    } catch (e) {
      this.logger.error(`Failed to read email template: ${e.message}`);
      return;
    }

    const finalHtml = html.replace('{{code}}', code);
    this.logger.log(`Verification code inserted: ${code}`);

    try {
      const info = await this.transporter.sendMail({
        from: this.fromEmail,
        to: email,
        subject,
        html: finalHtml,
      });

      this.logger.log(
        `Email successfully sent to ${email}. Message ID: ${info.messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${email}: ${error.message}`,
        error.stack,
      );
    }
  }
}

{
  /*import { Injectable, Logger } from '@nestjs/common';
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

    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'email_code.html',
    );
    const logoPath = path.join(
      process.cwd(),
      'src',
      'templates',
      'logosss.png',
    );

    this.logger.log(`Reading email template from: ${templatePath}`);
    this.logger.log(`Reading logo from: ${logoPath}`);

    let html: string;
    try {
      html = fs.readFileSync(templatePath, 'utf8');
    } catch (e) {
      this.logger.error(`Failed to read email template: ${e.message}`);
      return;
    }

    html = html.replace(/54690/g, code);

    if (!fs.existsSync(logoPath)) {
      this.logger.warn(`Logo file does not exist at path: ${logoPath}`);
    } else {
      this.logger.log(`Logo file found at path: ${logoPath}`);
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.fromEmail,
        to: email,
        subject,
        html,
        attachments: [
          {
            filename: 'logosss.png',
            path: path.join(process.cwd(), 'src', 'templates', 'logosss.png'),
            cid: 'logo',
            contentType: 'image/png',
          },
        ],
      });

      this.logger.log(`Email sent: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
    }
  }
}*/
}
