import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { Request } from 'express';
import { AuthenticatedUser, UpdateProfileDto } from './dto/user.dto';
import { RedisService } from 'src/RedisModule/redis.service';
import { SmsService } from 'src/MessageModule/sms.service';
import { VerifyEmailDto } from 'src/AuthModule/dto/auth.dto';
import { EmailService } from 'src/MessageModule/email.service';
import { SearchType } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private redisService: RedisService,
    private smsService: SmsService,
    private emailService: EmailService,
  ) {}

  async authenticate(authHeader: string): Promise<AuthenticatedUser> {
    if (!authHeader) {
      this.logger.error('Authorization header missing');
      throw new UnauthorizedException('Authorization header missing');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      this.logger.error('Token missing');
      throw new UnauthorizedException('Token missing');
    }

    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const { id, dbRegion } = decoded;

      if (!id || !dbRegion) {
        this.logger.error(
          `Invalid token structure: ${JSON.stringify(decoded)}`,
        );
        throw new UnauthorizedException('Invalid token structure');
      }

      const userModel = this.prismaService.getUserModel(dbRegion);
      const user = await userModel.findUnique({ where: { id } });

      if (!user) {
        this.logger.warn(`User ${id} not found in ${dbRegion}`);
        throw new NotFoundException('User not found');
      }

      return { ...user, dbRegion };
    } catch (error) {
      this.logger.error(`Token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async getUserSearchHistory(authHeader: string) {
    const user = await this.authenticate(authHeader);
    const db = this.prismaService.getDatabase(user.dbRegion);

    const history = await db.userSearch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20, // Ограничиваем последние 20 запросов
    });

    return { message: 'История поисков', history };
  }

  async updateProfile(req: Request, updateData: UpdateProfileDto) {
    const user = await this.authenticate(req.headers.authorization);
    this.logger.log(
      `Updating profile for user ID: ${user.id} in ${user.dbRegion}`,
    );

    const userModel = this.prismaService.getUserModel(user.dbRegion);
    const updatePayload: Partial<
      UpdateProfileDto & {
        isPhoneVerified?: boolean;
        isEmailVerified?: boolean;
        password?: string;
      }
    > = { ...updateData };

    if (updateData.phone && updateData.phone !== user.phone) {
      this.logger.log(
        `Phone number changed for user ${user.id}, sending verification code...`,
      );
      updatePayload.isPhoneVerified = false;

      const verificationCode = Math.floor(
        10000 + Math.random() * 900000,
      ).toString();
      await this.redisService.del(`phone_verification:${user.id}`);
      await this.redisService.set(
        `phone_verification:${user.id}`,
        verificationCode,
        300,
      );

      await this.smsService.sendVerificationSms(
        updateData.phone,
        verificationCode,
      );
    }

    if (updateData.email && updateData.email !== user.email) {
      this.logger.log(
        `Email changed for user ${user.id}, sending verification code...`,
      );
      updatePayload.isEmailVerified = false;

      const verificationCode = Math.floor(
        100000 + Math.random() * 900000,
      ).toString();
      await this.redisService.del(`email_verification:${user.email}`);
      await this.redisService.set(
        `email_verification:${updateData.email}`,
        verificationCode,
        300,
      );
      this.logger.log(
        `Setting Redis key: email_verification:${updateData.email} with value: ${verificationCode} and TTL: 300s`,
      );
      await this.emailService.sendVerificationEmail(
        updateData.email,
        verificationCode,
      );
    }

    if (updateData.password) {
      this.logger.log(`Hashing new password for user ${user.id}...`);
      updatePayload.password = await bcrypt.hash(updateData.password, 10);
    }

    const updatedUser = await userModel.update({
      where: { id: user.id },
      data: updatePayload,
    });

    this.logger.log(
      `User ${user.id} profile updated successfully in ${user.dbRegion}`,
    );
    return updatedUser;
  }

  async resendVerificationCode(email: string) {
    this.logger.log(`Resending verification code for email: ${email}`);

    // Поиск пользователя во всех БД
    for (const region of ['PENDING', 'RU', 'OTHER'] as const) {
      const userModel = this.prismaService.getUserModel(region);
      const user = await userModel.findUnique({ where: { email } });

      if (user) {
        this.logger.log(`User found in ${region}: ID=${user.id}`);

        // Проверяем наличие кода в Redis
        const phoneCode = await this.redisService.get(
          `phone_verification:${user.id}`,
        );
        const emailCode = await this.redisService.get(
          `email_verification:${email}`,
        );

        if (phoneCode) {
          this.logger.log(`Resending phone verification code to ${user.phone}`);
          await this.smsService.sendVerificationSms(user.phone, phoneCode);
          return { message: 'Verification code sent to phone' };
        }

        if (emailCode) {
          this.logger.log(`Resending email verification code to ${email}`);
          await this.emailService.sendVerificationEmail(email, emailCode);
          return { message: 'Verification code sent to email' };
        }

        this.logger.warn(`No verification code found for user ID: ${user.id}`);
        throw new BadRequestException('Verification code expired or not found');
      }
    }

    this.logger.warn(`User with email ${email} not found in any database`);
    throw new NotFoundException('User not found');
  }

  async verifyPhone(req: Request, code: string) {
    const user = await this.authenticate(req.headers.authorization);
    this.logger.log(
      `Verifying phone for user ID: ${user.id} in ${user.dbRegion}`,
    );

    const storedCode = await this.redisService.get(
      `phone_verification:${user.id}`,
    );

    if (!storedCode) {
      this.logger.warn(`No verification code found for user ID: ${user.id}`);
      throw new BadRequestException(
        'Verification code expired or does not exist',
      );
    }

    if (storedCode !== code) {
      this.logger.warn(`Invalid verification code for user ID: ${user.id}`);
      throw new BadRequestException('Incorrect verification code');
    }

    const userModel = this.prismaService.getUserModel(user.dbRegion);
    await userModel.update({
      where: { id: user.id },
      data: { isPhoneVerified: true },
    });

    await this.redisService.del(`phone_verification:${user.id}`);
    this.logger.log(`Phone verification completed for user ID: ${user.id}`);

    return { message: 'Phone number successfully verified' };
  }

  async verifyEmail(body: VerifyEmailDto) {
    const storedCode = await this.redisService.get(
      `email_verification:${body.email}`,
    );

    this.logger.log(
      `Retrieving Redis key: email_verification:${body.email}, stored value: ${storedCode}, comparing with input value: ${body.code}`,
    );

    if (!storedCode || storedCode !== body.code) {
      this.logger.warn(
        `Verification failed: expected ${storedCode}, received ${body.code}`,
      );
      throw new BadRequestException('Invalid verification code');
    }

    const dbPending = this.prismaService.getDatabase('PENDING');
    const user = await dbPending.user.findUnique({
      where: { email: body.email },
    });

    if (!user) {
      throw new ForbiddenException('User not found in PENDING database');
    }

    const targetRegion = Math.random() < 0.5 ? 'RU' : 'OTHER';
    const finalDB = this.prismaService.getDatabase(targetRegion);

    this.logger.log(`Moving user ${user.id} from PENDING to ${targetRegion}`);

    const existingUser = await finalDB.user.findUnique({
      where: { email: user.email },
    });
    if (existingUser && existingUser.isEmailVerified) {
      this.logger.warn(
        `User with email ${user.email} already exists in ${targetRegion}`,
      );
      throw new ForbiddenException(
        'User already exists in the target database',
      );
    }

    await finalDB.user.create({
      data: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        password: user.password,
        isRegistered: true,
        isEmailVerified: true,
        accountType: user.accountType,
      },
    });

    await dbPending.user.delete({ where: { id: user.id } });

    this.logger.log(`User ${user.id} successfully moved to ${targetRegion}`);

    await this.redisService.del(`email_verification:${body.email}`);

    return { message: 'Email verified and user moved successfully' };
  }

  async saveSearchHistory(
    userId: number,
    dbRegion: string,
    query: string,
    type: SearchType,
  ) {
    this.logger.log(
      `Saving search history for user ${userId} in ${dbRegion}: ${query} (${type})`,
    );

    const db = this.prismaService.getDatabase(dbRegion);
    await db.userSearch.create({
      data: {
        userId,
        query,
        type,
      },
    });
  }
}
