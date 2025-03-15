import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.get<boolean>(
      'isPublic',
      context.getHandler(),
    );

    if (isPublic) {
      this.logger.log('AdminGuard: Пропускаем публичный маршрут');
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();
    this.logger.log(
      `AdminGuard сработал для запроса: ${request.method} ${request.url}`,
    );

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      this.logger.warn('AdminGuard: Authorization header missing');
      throw new HttpException(
        'Authorization header missing',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      this.logger.warn('AdminGuard: Token missing');
      throw new HttpException('Token missing', HttpStatus.UNAUTHORIZED);
    }

    try {
      const jwtSecret = this.configService.get<string>('JWT_SECRET');
      const decoded = this.jwtService.verify(token, { secret: jwtSecret });
      this.logger.log(`AdminGuard: Token decoded: ${JSON.stringify(decoded)}`);

      if (!decoded || decoded.role !== 'ADMIN') {
        this.logger.warn('AdminGuard: Forbidden - user is not an admin');
        throw new HttpException(
          'Forbidden: Admin role required',
          HttpStatus.FORBIDDEN,
        );
      }

      // Проверяем, есть ли этот админ в БД
      const db = this.prismaService.getDatabase(decoded.dbRegion);
      const admin = await db.user.findUnique({
        where: { id: decoded.id, accountType: 'ADMIN' },
      });

      if (!admin) {
        this.logger.warn(
          `AdminGuard: Admin user not found in DB - id=${decoded.id}`,
        );
        throw new HttpException(
          'Forbidden: Admin not found',
          HttpStatus.FORBIDDEN,
        );
      }

      this.logger.log(`AdminGuard: Доступ разрешен для adminId=${decoded.id}`);
      return true;
    } catch (error) {
      this.logger.error(`AdminGuard: Invalid token - ${error.message}`);
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
