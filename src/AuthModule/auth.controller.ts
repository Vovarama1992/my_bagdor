import { Controller, Post, Body, Get, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import {
  RegisterDto,
  LoginDto,
  OAuthUserDto,
  AuthResponseDto,
} from './dto/auth.dto';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Google OAuth Login' })
  @ApiResponse({ status: 302, description: 'Redirect to Google OAuth' })
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {}

  @ApiOperation({ summary: 'Google OAuth Callback' })
  @ApiOkResponse({
    description: 'Returns JWT token and user data',
    type: AuthResponseDto,
  })
  @ApiQuery({ name: 'code', required: true, example: '4/0AfJohXAAAB' })
  @ApiQuery({ name: 'state', required: false, example: 'xyz' })
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: Request): Promise<AuthResponseDto> {
    const user = req.user as OAuthUserDto;
    return this.authService.oauthLogin(user);
  }

  @ApiOperation({ summary: 'Apple OAuth Login' })
  @ApiResponse({ status: 302, description: 'Redirect to Apple OAuth' })
  @Get('apple')
  @UseGuards(AuthGuard('apple'))
  async appleAuth() {}

  @ApiOperation({ summary: 'Apple OAuth Callback' })
  @ApiOkResponse({
    description: 'Returns JWT token and user data',
    type: AuthResponseDto,
  })
  @ApiQuery({
    name: 'code',
    required: true,
    example: '001234.abcdefg.hijklmnop',
  })
  @ApiQuery({ name: 'state', required: false, example: 'xyz' })
  @Get('apple/callback')
  @UseGuards(AuthGuard('apple'))
  async appleAuthRedirect(@Req() req: Request): Promise<AuthResponseDto> {
    const user = req.user as OAuthUserDto;
    return this.authService.oauthLogin(user);
  }

  @ApiOperation({ summary: 'Регистрация пользователя' })
  @ApiResponse({ status: 201, description: 'Пользователь зарегистрирован' })
  @ApiResponse({ status: 400, description: 'Ошибка валидации' })
  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @ApiOperation({ summary: 'Логин пользователя' })
  @ApiResponse({
    status: 200,
    description: 'Успешный вход, выдаётся JWT-токен',
  })
  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }
}
