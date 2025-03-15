import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from 'guards/admin.guard';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from 'src/PrismaModule/prisma.module';

@Module({
  imports: [JwtModule, PrismaModule],
  controllers: [AdminController],
  providers: [
    AdminService,

    {
      provide: APP_GUARD,
      useClass: AdminGuard,
    },
  ],
})
export class AdminModule {}
