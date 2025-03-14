import {
  Controller,
  Get,
  Put,
  Request,
  Body,
  Post,
  Headers,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Request as Req } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UserProfileResponseDto, UpdateProfileDto } from './dto/user.dto';
import { VerifyEmailDto, VerifyPhoneDto } from 'src/AuthModule/dto/auth.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Получить профиль текущего пользователя' })
  @ApiResponse({
    status: 200,
    description: 'Успешное получение профиля',
    type: UserProfileResponseDto,
  })
  @Get('profile')
  async getProfile(@Request() req: Req) {
    return this.usersService.authenticate(req.headers.authorization);
  }

  @ApiOperation({ summary: 'Обновить профиль пользователя' })
  @ApiResponse({
    status: 200,
    description: 'Профиль успешно обновлён',
    type: UserProfileResponseDto,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        oldPass: { type: 'string', example: 'current_password' },
        newPass: { type: 'string', example: 'new_secure_password' },
      },
      required: [], // Если нет обязательных полей, оставляем пустым массивом
    },
  })
  @Put('profile')
  async updateProfile(
    @Request() req: Req,
    @Body() body: UpdateProfileDto & { oldPass?: string; newPass?: string },
  ) {
    return this.usersService.updateProfile(req, body);
  }

  @ApiOperation({ summary: 'Получить историю поисков пользователя' })
  @ApiResponse({ status: 200, description: 'История поисков успешно получена' })
  @Get('search-history')
  async getUserSearchHistory(@Headers('authorization') authHeader: string) {
    return this.usersService.getUserSearchHistory(authHeader);
  }

  @ApiOperation({ summary: 'Повторная отправка кода подтверждения' })
  @ApiResponse({
    status: 200,
    description: 'Код повторно отправлен',
  })
  @ApiResponse({
    status: 404,
    description: 'Пользователь не найден',
  })
  @ApiResponse({
    status: 400,
    description: 'Код не найден в системе',
  })
  @ApiBody({ schema: { properties: { email: { type: 'string' } } } })
  @Post('resend-verification-code')
  async resendVerificationCode(@Body() body: { email: string }) {
    return this.usersService.resendVerificationCode(body.email);
  }

  @ApiOperation({ summary: 'Подтвердить номер телефона' })
  @ApiResponse({
    status: 200,
    description: 'Номер успешно подтверждён',
  })
  @ApiResponse({
    status: 400,
    description: 'Неверный код подтверждения',
  })
  @ApiResponse({
    status: 401,
    description: 'Неавторизованный доступ',
  })
  @ApiBody({ type: VerifyPhoneDto })
  @Post('verify-phone')
  async verifyPhone(@Request() req: Req, @Body() body: { code: string }) {
    return this.usersService.verifyPhone(req, body.code);
  }

  @ApiOperation({ summary: 'Подтвердить email' })
  @ApiResponse({
    status: 200,
    description: 'Email успешно подтверждён',
  })
  @ApiResponse({
    status: 400,
    description: 'Неверный код подтверждения',
  })
  @ApiResponse({
    status: 401,
    description: 'Неавторизованный доступ',
  })
  @ApiBody({ type: VerifyEmailDto })
  @Post('verify-email')
  async verifyEmail(@Request() req: Req, @Body() body: VerifyEmailDto) {
    return this.usersService.verifyEmail(body);
  }
}
