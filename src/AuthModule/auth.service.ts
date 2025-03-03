import { Injectable, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto, LoginDto, OAuthUserDto } from './dto/auth.dto';
import { RedisService } from 'src/RedisModule/redis.service';
import { SmsService } from './sms.service';
import { EmailService } from './email.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
  ) {}

  async register(body: RegisterDto) {
    const { firstName, lastName, email, phone, password } = body;
    const db = this.prismaService.getDatabase('PENDING');

    const existingUser = await db.user.findFirst({
      where: { OR: [{ phone }, { email }] },
    });
    if (existingUser) {
      throw new ForbiddenException(
        'User with this phone or email already exists',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await db.user.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        password: hashedPassword,
        isRegistered: false,
      },
    });

    // Генерируем 6-значный код
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();

    // Сохраняем код в Redis на 5 минут
    if (email) {
      await this.redisService.set(
        `email_verification:${email}`,
        verificationCode,
        300,
      );
      await this.emailService.sendVerificationEmail(email, verificationCode);
    }

    if (phone) {
      await this.redisService.set(
        `phone_verification:${phone}`,
        verificationCode,
        300,
      );
      await this.smsService.sendVerificationSms(phone, verificationCode);
    }

    return {
      userId: newUser.id,
      message: 'User registered, please verify your phone or email',
    };
  }

  async oauthLogin(user: OAuthUserDto) {
    const dbPending = this.prismaService.getDatabase('PENDING');
    let existingUser: any;

    if (user.googleId) {
      existingUser = await dbPending.user.findUnique({
        where: { googleId: user.googleId },
      });
    } else if (user.appleId) {
      existingUser = await dbPending.user.findUnique({
        where: { appleId: user.appleId },
      });
    }

    if (!existingUser) {
      const region = Math.random() < 0.5 ? 'RU' : 'OTHER';
      const finalDB = this.prismaService.getDatabase(region);
      const pendingDB = this.prismaService.getDatabase('PENDING');

      if (user.googleId) {
        existingUser = await finalDB.user.findUnique({
          where: { googleId: user.googleId },
        });
      } else if (user.appleId) {
        existingUser = await finalDB.user.findUnique({
          where: { appleId: user.appleId },
        });
      }

      if (!existingUser && user.email) {
        existingUser = await finalDB.user.findUnique({
          where: { email: user.email },
        });

        if (existingUser) {
          const updateData = user.googleId
            ? { googleId: user.googleId }
            : { appleId: user.appleId };

          existingUser = await finalDB.user.update({
            where: { id: existingUser.id },
            data: updateData,
          });
        }
      }

      if (!existingUser) {
        existingUser = await pendingDB.user.create({
          data: {
            email: user.email,
            phone: user.phone || '',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            googleId: user.googleId || null,
            appleId: user.appleId || null,
            accountType: 'CUSTOMER',
            isRegistered: false,
          },
        });

        if (user.phone) {
          const verificationCode = Math.floor(
            100000 + Math.random() * 900000,
          ).toString();
          await this.redisService.set(
            `phone_verification:${user.phone}`,
            verificationCode,
            300,
          );
          await this.smsService.sendVerificationSms(
            user.phone,
            verificationCode,
          );
        }
      }
    }

    const token = this.jwtService.sign({ id: existingUser.id });

    return {
      token,
      message: `Login successful via ${user.googleId ? 'Google' : 'Apple'}`,
    };
  }

  async login(body: LoginDto) {
    const db = this.prismaService.getDatabase('OTHER');

    const user = await db.user.findFirst({
      where: {
        OR: [{ email: body.email }, { phone: body.phone }],
      },
    });

    if (!user || !(await bcrypt.compare(body.password, user.password))) {
      throw new ForbiddenException('Invalid credentials');
    }

    const token = this.jwtService.sign({ id: user.id });

    return { token, message: 'Login successful' };
  }
}
