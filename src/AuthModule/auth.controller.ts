import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiOkResponse,
  ApiBody,
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
  private readonly logger = new Logger(AuthController.name);
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
    const code = Array.isArray(req.query.code)
      ? req.query.code[0]
      : req.query.code;
    if (typeof code !== 'string') {
      throw new BadRequestException('Invalid authorization code format');
    }
    return this.authService.handleAppleCallback(code);
  }

  @ApiOperation({ summary: 'Apple OAuth Mobile Login' })
  @ApiOkResponse({ description: 'Returns JWT token and user data' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        authorizationCode: {
          type: 'string',
          example: '001234.abcdefg.hijklmnop',
          description: 'OAuth authorization code from Apple',
        },
      },
      required: ['authorizationCode'],
    },
  })
  @Post('apple/mobile')
  async appleAuthMobile(@Body('authorizationCode') authorizationCode: string) {
    if (!authorizationCode) {
      throw new BadRequestException('Missing authorizationCode');
    }
    return this.authService.handleAppleMobileAuth(authorizationCode);
  }

  @ApiOperation({ summary: 'Google OAuth Mobile Login' })
  @ApiOkResponse({ description: 'Returns JWT token and user data' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        authorizationCode: {
          type: 'string',
          example: '4/0AfJohXAAAB',
          description: 'OAuth authorization code from Google',
        },
      },
      required: ['authorizationCode'],
    },
  })
  @Post('google/mobile')
  async googleAuthMobile(@Body('authorizationCode') authorizationCode: string) {
    if (!authorizationCode) {
      throw new BadRequestException('Missing authorizationCode');
    }
    return this.authService.handleGoogleMobileAuth(authorizationCode);
  }

  @ApiOperation({ summary: 'Регистрация пользователя' })
  @ApiResponse({ status: 201, description: 'Пользователь зарегистрирован' })
  @ApiResponse({ status: 400, description: 'Ошибка валидации' })
  @ApiBody({
    type: RegisterDto,
    description: 'Данные для регистрации пользователя',
  })
  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @ApiOperation({ summary: 'Логин пользователя' })
  @ApiResponse({
    status: 200,
    description: 'Успешный вход, выдаётся JWT-токен',
  })
  @ApiBody({
    type: LoginDto,
    description: 'Данные для авторизации пользователя',
  })
  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }
}
