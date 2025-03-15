import {
  Controller,
  Post,
  Delete,
  Put,
  Body,
  Param,
  UseGuards,
  SetMetadata,
  Get,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LoginDto, RegisterDto } from 'src/AuthModule/dto/auth.dto';
import { UpdateProfileDto } from 'src/UserModule/dto/user.dto';
import { DbRegion } from '@prisma/client';
import { AdminGuard } from 'guards/admin.guard';

@UseGuards(AdminGuard)
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @SetMetadata('isPublic', true)
  @ApiOperation({ summary: 'Авторизация админа' })
  @ApiResponse({ status: 200, description: 'Успешный вход', type: String })
  @ApiResponse({ status: 401, description: 'Неверные учетные данные' })
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.adminService.loginAdmin(loginDto);
  }

  @ApiOperation({ summary: 'Создать профиль пользователя' })
  @ApiResponse({ status: 201, description: 'Профиль создан' })
  @Post('create')
  async createProfile(@Body() createUserDto: RegisterDto) {
    return this.adminService.createProfile(createUserDto);
  }

  @ApiOperation({ summary: 'Удалить профиль пользователя' })
  @ApiResponse({ status: 200, description: 'Профиль удалён' })
  @Delete('delete/:id/:dbRegion')
  async deleteProfile(
    @Param('id') id: string,
    @Param('dbRegion') dbRegion: DbRegion,
  ) {
    return this.adminService.deleteProfile(Number(id), dbRegion);
  }

  @ApiOperation({ summary: 'Редактировать профиль пользователя' })
  @ApiResponse({ status: 200, description: 'Профиль обновлён' })
  @Put('update/:id/:dbRegion')
  async updateProfile(
    @Param('id') id: string,
    @Param('dbRegion') dbRegion: DbRegion,
    @Body() updateUserDto: UpdateProfileDto,
  ) {
    return this.adminService.updateProfile(Number(id), updateUserDto, dbRegion);
  }

  @ApiOperation({ summary: 'Получить всех пользователей из всех баз' })
  @ApiResponse({ status: 200, description: 'Список пользователей' })
  @Get('users')
  async getAllUsers() {
    return this.adminService.getAllUsersFromAllDatabases();
  }
}
