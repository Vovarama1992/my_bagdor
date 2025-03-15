import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { RegisterDto } from 'src/AuthModule/dto/auth.dto';
import { UpdateProfileDto } from 'src/UserModule/dto/user.dto';
import { EmailService } from '../MessageModule/email.service';
import { SmsService } from '../MessageModule/sms.service';
import { RedisService } from '../RedisModule/redis.service';
import * as bcrypt from 'bcryptjs';
import { DbRegion } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly redisService: RedisService,
  ) {}

  async createProfile(createUserDto: RegisterDto) {
    const { email, phone, password, firstName } = createUserDto;
    const userModel = this.prismaService.getUserModel('PENDING');

    const existingUser = await userModel.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existingUser) {
      throw new ConflictException(
        'User with this email or phone already exists',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await userModel.create({
      data: { ...createUserDto, password: hashedPassword },
    });

    this.logger.log(`Created new user: id=${newUser.id}, region=PENDING`);

    const verificationCode = Math.floor(
      10000 + Math.random() * 900000,
    ).toString();
    await this.redisService.set(
      `email_verification:${email}`,
      verificationCode,
      300,
    );
    await this.redisService.set(
      `phone_verification:${phone}`,
      verificationCode,
      300,
    );

    if (email) {
      await this.emailService.sendVerificationEmail(
        email,
        firstName,
        verificationCode,
      );
    }
    if (phone) {
      await this.smsService.sendVerificationSms(
        phone,
        firstName,
        verificationCode,
      );
    }

    return {
      userId: newUser.id,
      message: 'User created. Verification required.',
    };
  }

  async deleteProfile(userId: number, dbRegion: DbRegion) {
    const userModel = this.prismaService.getUserModel(dbRegion);
    const user = await userModel.findUnique({ where: { id: userId } });

    if (!user) {
      this.logger.warn(`User not found in ${dbRegion}: ${userId}`);
      throw new NotFoundException('User not found');
    }

    this.logger.log(`Deleting user in ${dbRegion}: ${userId}`);
    return userModel.delete({ where: { id: userId } });
  }

  async updateProfile(
    userId: number,
    updateUserDto: UpdateProfileDto,
    dbRegion: DbRegion,
  ) {
    const userModel = this.prismaService.getUserModel(dbRegion);
    const user = await userModel.findUnique({ where: { id: userId } });

    if (!user) {
      this.logger.warn(`User not found in ${dbRegion}: ${userId}`);
      throw new NotFoundException('User not found');
    }

    this.logger.log(`Updating user in ${dbRegion}: ${userId}`);
    return userModel.update({
      where: { id: userId },
      data: updateUserDto,
    });
  }
}
