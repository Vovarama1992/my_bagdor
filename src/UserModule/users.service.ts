import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Logger,
  HttpException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { Request } from 'express';
import { UpdateProfileDto } from './dto/user.dto';
import { RedisService } from 'src/RedisModule/redis.service';
import { SmsService } from 'src/MessageModule/sms.service';
import { CreateReviewDto } from './dto/review.dto';
import { VerifyEmailDto } from 'src/AuthModule/dto/auth.dto';
import { EmailService } from 'src/MessageModule/email.service';

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

  async authenticate(req: Request) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new UnauthorizedException(
        'Authorization header for route getProfile missing',
      );
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('Token missing');
    }

    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const userId = decoded.id;

      for (const region of ['PENDING', 'RU', 'OTHER'] as const) {
        const user = await this.prismaService
          .getUserModel(region)
          .findUnique({ where: { id: userId } });
        if (user) return user;
      }

      throw new NotFoundException('User not found');
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async updateProfile(req: Request, updateData: UpdateProfileDto) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      this.logger.error('Authorization header for updateProfile missing');
      throw new UnauthorizedException('Authorization header missing');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      this.logger.error('Token missing in updateProfile request');
      throw new UnauthorizedException('Token missing');
    }

    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const userId = decoded.id;
      this.logger.log(`Updating profile for user ID: ${userId}`);

      for (const region of ['PENDING', 'RU', 'OTHER'] as const) {
        try {
          const userModel = this.prismaService.getUserModel(region);
          const user = await userModel.findUnique({ where: { id: userId } });

          if (user) {
            this.logger.log(`User found in ${region}, updating profile...`);

            const updatePayload: Partial<
              UpdateProfileDto & { isPhoneVerified?: boolean }
            > = { ...updateData };

            // Если номер изменился — сбрасываем верификацию и отправляем код
            if (updateData.phone && updateData.phone !== user.phone) {
              this.logger.log(
                `Phone number changed for user ${userId}, sending verification code...`,
              );

              updatePayload.isPhoneVerified = false;

              const verificationCode = Math.floor(
                100000 + Math.random() * 900000,
              ).toString();
              await this.redisService.set(
                `phone_verification:${userId}`,
                verificationCode,
                300,
              );
              await this.smsService.sendVerificationSms(
                updateData.phone,
                verificationCode,
              );
            }

            const updatedUser = await userModel.update({
              where: { id: userId },
              data: updatePayload,
            });

            this.logger.log(
              `User ${userId} profile updated successfully in ${region}`,
            );
            return updatedUser;
          }
        } catch (error) {
          this.logger.error(
            `Error updating user ${userId} in ${region}: ${error.message}`,
          );
        }
      }

      this.logger.warn(`User ${userId} not found in any database`);
      throw new NotFoundException('User not found');
    } catch (error) {
      this.logger.error(
        `Failed to update profile for user: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      this.logger.error('Authorization header missing');
      throw new UnauthorizedException('Authorization header missing');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      this.logger.error('Token missing in request');
      throw new UnauthorizedException('Token missing');
    }

    let userId: number;
    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      this.logger.log(`Decoded token: ${JSON.stringify(decoded)}`);

      userId = decoded.id;
      if (!userId) {
        this.logger.error('User ID is missing in decoded token');
        throw new UnauthorizedException(
          'Invalid token structure: missing user ID',
        );
      }
    } catch (error) {
      this.logger.error(`Token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    this.logger.log(`Fetching verification code for userId: ${userId}`);
    const storedCode = await this.redisService.get(
      `phone_verification:${userId}`,
    );

    this.logger.log(`Stored verification code: ${storedCode}`);

    if (!storedCode) {
      this.logger.warn(`No verification code found for userId: ${userId}`);
      throw new BadRequestException(
        'Verification code expired or does not exist',
      );
    }

    if (storedCode !== code) {
      this.logger.warn(`Invalid verification code for userId: ${userId}`);
      throw new BadRequestException('Incorrect verification code');
    }

    let userFound = false;
    for (const region of ['PENDING', 'RU', 'OTHER'] as const) {
      try {
        this.logger.log(`Checking user in ${region} database`);
        const userModel = this.prismaService.getUserModel(region);
        const user = await userModel.findUnique({ where: { id: userId } });

        if (user) {
          this.logger.log(
            `User found in ${region}, updating verification status`,
          );

          await userModel.update({
            where: { id: userId },
            data: { isPhoneVerified: true },
          });

          await this.redisService.del(`phone_verification:${userId}`);
          this.logger.log(`Phone verification completed for userId: ${userId}`);

          userFound = true;
          return { message: 'Phone number successfully verified' };
        }
      } catch (error) {
        this.logger.error(
          `Error querying ${region} database: ${error.message}`,
        );
      }
    }

    if (!userFound) {
      this.logger.warn(`User with ID ${userId} not found in any database`);
      throw new NotFoundException('User not found in any database');
    }
  }

  async verifyEmail(body: VerifyEmailDto) {
    const storedCode = await this.redisService.get(
      `email_verification:${body.email}`,
    );

    if (!storedCode || storedCode !== body.code) {
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
    if (existingUser) {
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

  async createReview(req: Request, reviewData: CreateReviewDto) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('Token missing');
    }

    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const userId = decoded.sub; // Автор отзыва

      for (const region of ['PENDING', 'RU', 'OTHER'] as const) {
        const userModel = this.prismaService.getUserModel(region);
        const user = await userModel.findUnique({ where: { id: userId } });

        if (user) {
          const review = await this.prismaService
            .getDatabase(region)
            .review.create({
              data: {
                userId, // Кто оставил отзыв
                rating: reviewData.rating,
                comment: reviewData.comment,
              },
            });

          return review;
        }
      }

      throw new NotFoundException('User not found');
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
