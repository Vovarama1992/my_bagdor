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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...userWithoutPass } = user;

      if (!user) {
        this.logger.warn(`User ${id} not found in ${dbRegion}`);
        throw new NotFoundException('User not found');
      }

      return { ...userWithoutPass, dbRegion };
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

  async updateProfile(
    req: Request,
    updateData: UpdateProfileDto & { oldPass?: string; newPass?: string },
  ) {
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
        `Phone number change detected for user ${user.id}. Old phone: ${user.phone}, New phone: ${updateData.phone}`,
      );

      // Обнуляем статус верификации номера
      updatePayload.isPhoneVerified = false;
      this.logger.log(`isPhoneVerified set to false for user ${user.id}`);

      // Генерация нового кода
      const verificationCode = Math.floor(
        10000 + Math.random() * 9000,
      ).toString();
      this.logger.log(
        `Generated verification code: ${verificationCode} for user ${user.id}`,
      );

      // Удаляем старый код из Redis
      const redisKey = `phone_verification:${user.id}`;
      await this.redisService.del(redisKey);
      this.logger.log(`Deleted old verification code from Redis: ${redisKey}`);

      // Записываем новый код в Redis
      await this.redisService.set(redisKey, verificationCode, 300);
      this.logger.log(
        `Stored new verification code in Redis: ${redisKey} with TTL: 300s`,
      );

      // Отправляем код пользователю
      await this.smsService.sendVerificationSms(
        updateData.phone,
        verificationCode,
      );
      this.logger.log(
        `Sent verification SMS to new phone: ${updateData.phone} for user ${user.id}`,
      );
    }

    if (updateData.email && updateData.email !== user.email) {
      this.logger.log(
        `Email changed for user ${user.id}, sending verification code...`,
      );
      updatePayload.isEmailVerified = false;

      const verificationCode = Math.floor(
        10000 + Math.random() * 9000,
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

    if (updateData.newPass) {
      if (!updateData.oldPass) {
        throw new BadRequestException(
          'Current password is required to set a new password',
        );
      }

      this.logger.log(`Verifying old password for user ${user.id}...`);
      const isOldPasswordValid = await bcrypt.compare(
        updateData.oldPass,
        user.password,
      );
      if (!isOldPasswordValid) {
        throw new ForbiddenException('Incorrect current password');
      }

      this.logger.log(`Hashing new password for user ${user.id}...`);
      updatePayload.password = await bcrypt.hash(updateData.newPass, 10);
    }

    const updatedUser = await userModel.update({
      where: { id: user.id },
      data: updatePayload,
    });

    this.logger.log(
      `User ${user.id} profile updated successfully in ${user.dbRegion}`,
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPass } = updatedUser;
    return userWithoutPass;
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

    // 1. Ищем в PENDING
    const dbPending = this.prismaService.getDatabase('PENDING');
    const user = await dbPending.user.findUnique({
      where: { email: body.email },
    });

    if (user) {
      // 1.1. Переносим пользователя в RU или OTHER
      const targetRegion = Math.random() < 0.5 ? 'RU' : 'OTHER';
      const finalDB = this.prismaService.getDatabase(targetRegion);

      this.logger.log(`Moving user ${user.id} from PENDING to ${targetRegion}`);

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

      // 1.2. Удаляем из PENDING
      await dbPending.user.delete({ where: { id: user.id } });
      this.logger.log(`User ${user.id} removed from PENDING`);
    } else {
      // 2. Если в PENDING нет, ищем в RU или OTHER
      const dbRU = this.prismaService.getDatabase('RU');
      const dbOther = this.prismaService.getDatabase('OTHER');

      let existingUser = await dbRU.user.findUnique({
        where: { email: body.email },
      });
      let targetDB = 'RU';

      if (!existingUser) {
        existingUser = await dbOther.user.findUnique({
          where: { email: body.email },
        });
        targetDB = 'OTHER';
      }

      if (!existingUser) {
        this.logger.warn(
          `User ${body.email} not found in PENDING, RU, or OTHER`,
        );
        throw new ForbiddenException('User not found in any database');
      }

      // 2.1. Обновляем isEmailVerified в RU/OTHER
      this.logger.log(
        `Updating isEmailVerified for user ${body.email} in ${targetDB}`,
      );

      await this.prismaService.getDatabase(targetDB).user.update({
        where: { email: body.email },
        data: { isEmailVerified: true },
      });
    }

    // Удаляем ключ из Redis
    await this.redisService.del(`email_verification:${body.email}`);
    this.logger.log(`Deleted Redis key: email_verification:${body.email}`);

    return { message: 'Email verified successfully' };
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
