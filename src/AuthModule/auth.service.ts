import {
  Injectable,
  ForbiddenException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto, LoginDto, OAuthUserDto } from './dto/auth.dto';
import { RedisService } from 'src/RedisModule/redis.service';
import { SmsService } from '../MessageModule/sms.service';
import { EmailService } from '../MessageModule/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
  ) {}

  async register(body: RegisterDto) {
    try {
      const { firstName, lastName, email, phone, password } = body;
      this.logger.log(`Registering user: email=${email}, phone=${phone}`);

      const db = this.prismaService.getDatabase('PENDING');
      this.logger.log(`Database instance type: ${db.constructor.name}`);
      this.logger.log(`Checking if user exists...`);

      const existingUser = await db.user.findFirst({
        where: { OR: [{ phone }, { email }] },
      });

      if (existingUser) {
        this.logger.warn(`User already exists: email=${email}, phone=${phone}`);
        throw new ForbiddenException(
          'User with this phone or email already exists',
        );
      }

      this.logger.log(`Hashing password...`);
      const hashedPassword = await bcrypt.hash(password, 10);

      this.logger.log(`Creating new user...`);
      const newUser = await db.user.create({
        data: {
          firstName,
          lastName,
          email,
          phone: phone || null,
          password: hashedPassword,
          isRegistered: false,
        },
      });
      this.logger.log(`User created: id=${newUser.id}`);

      const verificationCode = Math.floor(
        100000 + Math.random() * 900000,
      ).toString();
      this.logger.log(`Generated verification code: ${verificationCode}`);

      if (email) {
        this.logger.log(`Saving email verification code in Redis...`);
        await this.redisService.set(
          `email_verification:${email}`,
          verificationCode,
          300,
        );
        this.logger.log(`Sending verification email...`);
        await this.emailService.sendVerificationEmail(email, verificationCode);
      }

      if (phone) {
        this.logger.log(`Saving phone verification code in Redis...`);
        await this.redisService.set(
          `phone_verification:${phone}`,
          verificationCode,
          300,
        );
        this.logger.log(`Sending verification SMS...`);
        await this.smsService.sendVerificationSms(phone, verificationCode);
      }

      this.logger.log(`User registration completed.`);
      return {
        userId: newUser.id,
        message: 'User registered, please verify your phone or email',
      };
    } catch (error) {
      this.logger.error(`Registration failed: ${error.message}`, error.stack);
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async login(body: LoginDto) {
    try {
      this.logger.log(
        `Logging in user: email=${body.email || ''}, phone=${body.phone || ''}`,
      );

      let db = this.prismaService.getDatabase('RU');
      let user = await db.user.findFirst({
        where: {
          OR: [{ email: body.email }, { phone: body.phone }],
        },
      });

      // Если не нашли, ищем в OTHER
      if (!user) {
        db = this.prismaService.getDatabase('OTHER');
        user = await db.user.findFirst({
          where: {
            OR: [{ email: body.email }, { phone: body.phone }],
          },
        });
      }

      // Если не нашли, ищем в PENDING
      if (!user) {
        db = this.prismaService.getDatabase('PENDING');
        user = await db.user.findFirst({
          where: {
            OR: [{ email: body.email }, { phone: body.phone }],
          },
        });

        if (user) {
          this.logger.warn(
            `User found in PENDING: email=${body.email || ''}, phone=${body.phone || ''}`,
          );
          throw new ForbiddenException('User is not verified yet');
        }
      }

      if (!user) {
        this.logger.warn(
          `User not found: email=${body.email || ''}, phone=${body.phone || ''}`,
        );
        throw new ForbiddenException('Invalid credentials');
      }

      const passwordMatch = await bcrypt.compare(body.password, user.password);
      if (!passwordMatch) {
        this.logger.warn(
          `Incorrect password for user: email=${body.email || ''}, phone=${body.phone || ''}`,
        );
        throw new ForbiddenException('Invalid credentials');
      }

      const token = this.jwtService.sign({ id: user.id });
      this.logger.log(`User logged in successfully: id=${user.id}`);

      return { token, message: 'Login successful' };
    } catch (error) {
      this.logger.error(`Login failed: ${error.message}`, error.stack);
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async oauthLogin(user: OAuthUserDto) {
    try {
      this.logger.log(
        `Processing OAuth login: email=${user.email || ''}, googleId=${user.googleId || ''}, appleId=${user.appleId || ''}`,
      );
      const dbPending = this.prismaService.getDatabase('PENDING');

      let existingUser = user.googleId
        ? await dbPending.user.findUnique({
            where: { googleId: user.googleId },
          })
        : user.appleId
          ? await dbPending.user.findUnique({
              where: { appleId: user.appleId },
            })
          : null;

      if (!existingUser) {
        const region = Math.random() < 0.5 ? 'RU' : 'OTHER';
        const finalDB = this.prismaService.getDatabase(region);

        existingUser = await finalDB.user.findUnique({
          where: { email: user.email },
        });

        if (!existingUser) {
          existingUser = await dbPending.user.create({
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
      this.logger.log(`OAuth login successful: id=${existingUser.id}`);

      return {
        token,
        message: `Login successful via ${user.googleId ? 'Google' : 'Apple'}`,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
      };
    } catch (error) {
      this.logger.error(`OAuth login failed: ${error.message}`, error.stack);

      if (error instanceof HttpException) {
        throw error; // Оставляем статус ошибки, если он уже определён
      }

      throw new HttpException(
        error.message || 'Internal Server Error',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
