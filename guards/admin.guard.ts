import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.get<boolean>(
      'isPublic',
      context.getHandler(),
    );
    if (isPublic) {
      console.log('AdminGuard: Пропускаем публичный маршрут');
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();
    console.log(
      'AdminGuard сработал для запроса:',
      request.method,
      request.url,
    );

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      console.warn('AdminGuard: Authorization header missing');
      throw new HttpException(
        'Authorization header missing',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      console.warn('AdminGuard: Token missing');
      throw new HttpException('Token missing', HttpStatus.UNAUTHORIZED);
    }

    try {
      const decoded = this.jwtService.verify(token);
      console.log('AdminGuard: Token decoded:', decoded);

      if (!decoded || decoded.role !== 'ADMIN') {
        console.warn('AdminGuard: Forbidden - user is not an admin');
        throw new HttpException(
          'Forbidden: Admin role required',
          HttpStatus.FORBIDDEN,
        );
      }

      return true;
    } catch (error) {
      console.error('AdminGuard: Invalid token', error.message);
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
