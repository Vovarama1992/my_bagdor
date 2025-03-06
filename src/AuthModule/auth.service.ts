import {
  Injectable,
  ForbiddenException,
  Logger,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  RegisterDto,
  LoginDto,
  OAuthUserDto,
  AuthResponseDto,
} from './dto/auth.dto';
import { RedisService } from 'src/RedisModule/redis.service';
import { SmsService } from '../MessageModule/sms.service';
import { EmailService } from '../MessageModule/email.service';
import { InternalOAuthError } from 'passport-apple';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async handleAppleCallback(code: string): Promise<AuthResponseDto> {
    if (!code) {
      throw new BadRequestException('Missing authorization code from Apple');
    }

    const { id_token } = await this.exchangeCodeForToken(code);
    const user = this.extractUserFromIdToken(id_token);

    return this.oauthLogin(user);
  }

  private async exchangeCodeForToken(
    code: string,
  ): Promise<{ id_token: string }> {
    const response = await axios.post(
      'https://appleid.apple.com/auth/token',
      new URLSearchParams({
        client_id: this.configService.get<string>('APPLE_CLIENT_ID'),
        client_secret: this.generateAppleClientSecret(),
        code,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    return response.data;
  }

  private extractUserFromIdToken(id_token: string): OAuthUserDto {
    const decoded: any = jwt.decode(id_token);
    return {
      appleId: decoded.sub,
      phone: decoded.phone || null,
      email: decoded.email || null,
      firstName: decoded.name?.firstName || null,
      lastName: decoded.name?.lastName || null,
    };
  }

  private generateAppleClientSecret(): string {
    const privateKeyRaw = this.configService.get<string>('APPLE_PRIVATE_KEY');
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n'); // Преобразуем в многострочный PEM

    this.logger.log(
      `Apple OAuth: Raw Private Key (before formatting): ${privateKeyRaw}`,
    );
    this.logger.log(`Apple OAuth: Formatted Private Key:\n${privateKey}`);

    const clientSecret = jwt.sign({}, privateKey, {
      algorithm: 'ES256',
      keyid: this.configService.get<string>('APPLE_KEY_ID'),
      issuer: this.configService.get<string>('APPLE_TEAM_ID'),
      subject: this.configService.get<string>('APPLE_CLIENT_ID'),
      audience: 'https://appleid.apple.com',
      expiresIn: '1h',
    });

    this.logger.log(`Apple OAuth: Generated client_secret: ${clientSecret}`);
    return clientSecret;
  }

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
        if (!existingUser.isEmailVerified) {
          this.logger.warn(`User exists but not verified: email=${email}`);

          // Генерируем новый код подтверждения
          const verificationCode = Math.floor(
            100000 + Math.random() * 900000,
          ).toString();
          this.logger.log(`Generated verification code: ${verificationCode}`);

          // Обновляем код в Redis и отправляем его на почту
          await this.redisService.set(
            `email_verification:${email}`,
            verificationCode,
            300,
          );
          await this.emailService.sendVerificationEmail(
            email,
            verificationCode,
          );

          return {
            userId: existingUser.id,
            message:
              'Verification required. A new verification code has been sent to your email.',
          };
        }

        this.logger.warn(`User already registered: email=${email}`);
        throw new ForbiddenException('User with this email already exists');
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

      let user = null;
      let dbRegion: 'RU' | 'OTHER' | 'PENDING' | null = null;

      for (const region of ['RU', 'OTHER', 'PENDING'] as const) {
        const db = this.prismaService.getDatabase(region);
        user = await db.user.findFirst({
          where: {
            OR: [{ email: body.email }, { phone: body.phone }],
          },
        });

        if (user) {
          dbRegion = region;
          break;
        }
      }

      if (!user) {
        this.logger.warn(
          `User not found: email=${body.email || ''}, phone=${body.phone || ''}`,
        );
        throw new ForbiddenException('Invalid credentials');
      }

      if (dbRegion === 'PENDING') {
        this.logger.warn(
          `User found in PENDING: email=${body.email || ''}, phone=${body.phone || ''}`,
        );
        throw new ForbiddenException('User is not verified yet');
      }

      const passwordMatch = await bcrypt.compare(body.password, user.password);
      if (!passwordMatch) {
        this.logger.warn(
          `Incorrect password for user: email=${body.email || ''}, phone=${body.phone || ''}`,
        );
        throw new ForbiddenException('Invalid credentials');
      }

      const token = this.jwtService.sign({
        id: user.id,
        dbRegion, // Теперь в токене есть регион пользователя
      });

      this.logger.log(
        `User logged in successfully: id=${user.id}, region=${dbRegion}`,
      );

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

      if (!user.email && !user.googleId && !user.appleId) {
        this.logger.warn('OAuth login failed: Missing user identifiers');
        throw new BadRequestException(
          'OAuth login failed: Missing user identifiers',
        );
      }

      const dbPending = this.prismaService.getDatabase('PENDING');
      let dbRegion: 'RU' | 'OTHER' | 'PENDING' | null = null;

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
        try {
          dbRegion = 'PENDING';

          const emailExists = await dbPending.user.findUnique({
            where: { email: user.email },
          });

          if (emailExists) {
            this.logger.warn(
              `User with this email already exists: ${user.email}`,
            );
            throw new ConflictException('User with this email already exists.');
          }

          existingUser = await dbPending.user.create({
            data: {
              email: user.email,
              phone: user.phone && user.phone.trim() !== '' ? user.phone : null,
              firstName: user.firstName || '',
              lastName: user.lastName || '',
              googleId: user.googleId || null,
              appleId: user.appleId || null,
              accountType: 'CUSTOMER',
              isRegistered: false,
            },
          });

          this.logger.log(`Created new user: id=${existingUser.id}`);
        } catch (error) {
          this.logger.error(`Database error: ${error.message}`, error.stack);
          if (error.code === 'P2002') {
            // Prisma уникальный constraint error
            throw new ConflictException(
              'User with this phone or email already exists.',
            );
          }
          throw error;
        }
      }

      if (!dbRegion) {
        dbRegion =
          existingUser.googleId || existingUser.appleId ? 'PENDING' : 'RU';
      }

      const token = this.jwtService.sign({
        id: existingUser.id,
        dbRegion,
      });

      this.logger.log(
        `OAuth login successful: id=${existingUser.id}, region=${dbRegion}`,
      );

      return {
        token,
        message: `Login successful via ${user.googleId ? 'Google' : 'Apple'}`,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        region: dbRegion,
      };
    } catch (error) {
      this.logger.error(`OAuth login failed: ${error.message}`, error.stack);

      if (error instanceof InternalOAuthError) {
        this.logger.error(`OAuth provider error: ${error.oauthError.data}`);
        throw new UnauthorizedException(
          error.oauthError.data || 'OAuth provider error',
        );
      }

      if (error instanceof HttpException) {
        throw error;
      }

      if (error.code === 'P2002') {
        this.logger.warn('User with this email already exists');
        throw new ConflictException('User with this email already exists');
      }

      throw new BadRequestException(error.message || 'OAuth login failed');
    }
  }

  async handleAppleMobileAuth(authorizationCode: string) {
    try {
      this.logger.log(
        `Apple OAuth: received authorizationCode=${authorizationCode}`,
      );

      // Генерируем корректный client_secret
      const clientSecret = this.generateAppleClientSecret();
      this.logger.log(`Apple OAuth: Generated client_secret=${clientSecret}`);

      const tokenResponse = await axios.post(
        'https://appleid.apple.com/auth/token',
        new URLSearchParams({
          client_id: this.configService.get<string>('APPLE_CLIENT_ID'),
          client_secret: clientSecret, // Используем сгенерированный client_secret
          code: authorizationCode,
          grant_type: 'authorization_code',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );

      this.logger.log(
        `Apple OAuth: token response=${JSON.stringify(tokenResponse.data)}`,
      );

      if (!tokenResponse.data.id_token) {
        const errorMessage = 'Apple OAuth failed: Missing id_token in response';
        this.logger.error(errorMessage);
        throw new BadRequestException(errorMessage);
      }

      const idToken = jwt.decode(tokenResponse.data.id_token) as any;
      if (!idToken) {
        const errorMessage = `Apple OAuth failed: Unable to decode id_token=${tokenResponse.data.id_token}`;
        this.logger.error(errorMessage);
        throw new BadRequestException(errorMessage);
      }

      this.logger.log(
        `Apple OAuth: decoded id_token=${JSON.stringify(idToken)}`,
      );

      const user: OAuthUserDto = {
        appleId: idToken.sub,
        email: idToken.email || null,
        firstName: '',
        lastName: '',
        phone: null,
      };

      return this.oauthLogin(user);
    } catch (error) {
      this.logger.error(`Apple OAuth failed: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(
          `Apple OAuth HTTP Response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new InternalServerErrorException({
        message: 'Apple OAuth failed',
        error: error.message,
        stack: error.stack,
        response: error.response?.data || null,
      });
    }
  }

  async handleGoogleMobileAuth(accessToken: string) {
    try {
      this.logger.log(`Google OAuth: received accessToken=${accessToken}`);

      // Запрос к Google API для получения данных юзера
      const userInfoResponse = await axios.get(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      this.logger.log(
        `Google OAuth: user info response=${JSON.stringify(userInfoResponse.data)}`,
      );

      const user: OAuthUserDto = {
        googleId: userInfoResponse.data.id,
        email: userInfoResponse.data.email || null,
        firstName: userInfoResponse.data.given_name || '',
        lastName: userInfoResponse.data.family_name || '',
        phone: null,
      };

      return this.oauthLogin(user);
    } catch (error) {
      this.logger.error(`Google OAuth failed: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(
          `Google OAuth HTTP Response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new InternalServerErrorException({
        message: 'Google OAuth failed',
        error: error.message,
        stack: error.stack,
        response: error.response?.data || null,
      });
    }
  }
}
