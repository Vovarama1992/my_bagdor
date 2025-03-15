import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/PrismaModule/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prismaService: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new HttpException(
        'Authorization header missing',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new HttpException('Token missing', HttpStatus.UNAUTHORIZED);
    }

    try {
      const decoded = this.jwtService.verify(token);

      if (typeof decoded !== 'object' || !decoded) {
        throw new HttpException(
          'Invalid token structure',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const userId = decoded['userId'];
      const dbRegion = decoded['dbRegion'];

      if (!userId || !dbRegion) {
        throw new HttpException(
          'Invalid token payload',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const userModel = this.prismaService.getUserModel(dbRegion);
      const user = await userModel.findUnique({ where: { id: userId } });
      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      if (user.accountType !== 'ADMIN') {
        throw new HttpException(
          'Forbidden: Admin role required',
          HttpStatus.FORBIDDEN,
        );
      }

      return true;
    } catch (error) {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
