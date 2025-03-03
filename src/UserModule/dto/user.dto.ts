import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail } from 'class-validator';
import { ReviewDto } from './review.dto';

export class UserProfileResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'johnny' })
  @IsString()
  @IsOptional()
  nickname?: string;

  @ApiProperty({ example: '+123456789' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: '@durov' })
  @IsString()
  @IsOptional()
  telegram?: string;

  @ApiProperty({
    type: [ReviewDto],
    description: 'Отзывы, оставленные пользователем',
  })
  @IsOptional()
  reviews?: ReviewDto[];
}

export class UpdateProfileDto {
  @ApiProperty({ example: 'John', description: 'Имя пользователя' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ example: 'Doe', description: 'Фамилия пользователя' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'johnny', description: 'Никнейм' })
  @IsString()
  @IsOptional()
  nickname?: string;

  @ApiProperty({ example: '+123456789', description: 'Номер телефона' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: '@durov', description: 'Телеграм пользователя' })
  @IsString()
  @IsOptional()
  telegram?: string;
}
