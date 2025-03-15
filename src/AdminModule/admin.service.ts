import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { LoginDto, RegisterDto } from 'src/AuthModule/dto/auth.dto';
import { UpdateProfileDto } from 'src/UserModule/dto/user.dto';
import { EmailService } from '../MessageModule/email.service';
import { SmsService } from '../MessageModule/sms.service';
import { RedisService } from '../RedisModule/redis.service';
import * as bcrypt from 'bcryptjs';
import { DbRegion, User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async loginAdmin(loginDto: LoginDto) {
    const { email, password } = loginDto;

    let user: User = null;
    let dbRegion: 'RU' | 'OTHER' | 'PENDING' | null = null;

    for (const region of ['RU', 'OTHER', 'PENDING'] as const) {
      const db = this.prismaService.getDatabase(region);
      user = await db.user.findFirst({
        where: { email, accountType: 'ADMIN' },
      });

      if (user) {
        dbRegion = region;
        break;
      }
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials or not an admin');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const jwtSecret = this.configService.get<string>('JWT_SECRET');

    this.logger.log(`🔑 JWT_SECRET (из process.env): ${jwtSecret}`);

    if (!jwtSecret || jwtSecret === 'НЕ НАЙДЕН') {
      throw new Error('❌ JWT_SECRET отсутствует!');
    }

    const token = this.jwtService.sign(
      { id: user.id, dbRegion, role: 'ADMIN' },
      { secret: jwtSecret }, // 🔥 Передаем `secret` явно!
    );

    this.logger.log(
      `Admin logged in: id=${user.id}, email=${email}, region=${dbRegion}`,
    );
    return { token, message: 'Login successful' };
  }

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
