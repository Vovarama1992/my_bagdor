import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtModule } from '@nestjs/jwt';

import { PrismaModule } from 'src/PrismaModule/prisma.module';
import { MessageModule } from 'src/MessageModule/message.module';
import { RedisModule } from 'src/RedisModule/redis.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from 'src/UserModule/users.module';

@Module({
  imports: [
    JwtModule,
    PrismaModule,
    RedisModule,
    MessageModule,
    ConfigModule,
    UsersModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
