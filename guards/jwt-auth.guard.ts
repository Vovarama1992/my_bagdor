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
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest();
    console.log(
      'JwtAuthGuard сработал для запроса:',
      request.method,
      request.url,
    );

    const authHeader = request.headers.authorization;

    const isPublic = this.reflector.get<boolean>(
      'isPublic',
      context.getHandler(),
    );
    if (isPublic) {
      return true;
    }

    if (!authHeader) {
      console.warn('JwtAuthGuard: Authorization header missing');
      throw new HttpException(
        'Authorization header missing',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      console.warn('JwtAuthGuard: Token missing');
      throw new HttpException('Token missing', HttpStatus.UNAUTHORIZED);
    }

    try {
      this.jwtService.verify(token);
      return true;
    } catch (error) {
      console.error('JwtAuthGuard: Invalid token', error.message);
      throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
    }
  }
}
