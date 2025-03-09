import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, MinLength } from 'class-validator';
import { ReviewDto } from './review.dto';
import { AccountType } from '@prisma/client';

export class UserProfileResponseDto {
  @ApiProperty({ example: 1, required: true })
  id: number;

  @ApiProperty({ example: 'user@example.com', required: true })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John', required: false })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ example: 'Doe', required: false })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'johnny', required: false })
  @IsString()
  @IsOptional()
  nickname?: string;

  @ApiProperty({ example: '+123456789', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: '@durov', required: false })
  @IsString()
  @IsOptional()
  telegram?: string;

  @ApiProperty({
    type: [ReviewDto],
    description: 'Отзывы, оставленные пользователем',
    required: false,
  })
  @IsOptional()
  reviews?: ReviewDto[];

  // Новые поля
  @ApiProperty({
    example: 0,
    description: 'Количество заказов',
    required: true,
  })
  numberOfOrders: number;

  @ApiProperty({
    example: 0,
    description: 'Количество перелетов',
    required: true,
  })
  numberOfFlights: number;

  @ApiProperty({
    example: 0,
    description: 'Количество доставленных заказов',
    required: true,
  })
  numberOfDeliveredOrders: number;

  @ApiProperty({
    example: 'CARRIER',
    enum: AccountType,
    description: 'Тип аккаунта: CUSTOMER или CARRIER',
    required: false,
  })
  @IsOptional()
  accountType?: AccountType;
}

export class UpdateProfileDto {
  @ApiProperty({
    example: 'John',
    description: 'Имя пользователя',
    required: false,
  })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({
    example: 'Doe',
    description: 'Фамилия пользователя',
    required: false,
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'johnny', description: 'Никнейм', required: false })
  @IsString()
  @IsOptional()
  nickname?: string;

  @ApiProperty({
    example: '+123456789',
    description: 'Номер телефона',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    example: '@durov',
    description: 'Телеграм пользователя',
    required: false,
  })
  @IsString()
  @IsOptional()
  telegram?: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'Электронная почта пользователя',
    required: false,
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({
    example: 'StrongP@ssw0rd',
    description: 'Новый пароль пользователя',
    required: false,
  })
  @IsString()
  @MinLength(8)
  @IsOptional()
  password?: string;
}

export type AuthenticatedUser = UserProfileResponseDto & {
  dbRegion: 'PENDING' | 'RU' | 'OTHER';
};
