import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Иван', required: true })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Иванов', required: true })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'ivan_nickname', required: false })
  @IsString()
  @IsOptional()
  nickname?: string;

  @ApiProperty({ example: '+79991234567', required: true })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'ivan@example.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({
    example: 'Password123!',
    required: true,
    description:
      'Пароль должен содержать минимум 8 символов, хотя бы одну цифру, одну заглавную букву и один спецсимвол',
  })
  @IsString()
  @Length(8, 50)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message:
      'Password must have at least 8 characters, one uppercase letter, one number, and one special character',
  })
  password: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'ivan@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '111111' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '+79991234567' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '111111' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ivan@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '+79991234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  password: string;
}

export class OAuthUserDto {
  @ApiProperty({
    example: '12345678901234567890',
    description: 'Google ID пользователя',
  })
  googleId?: string;

  @ApiProperty({
    example: '001234.abcdefg.hijklmnop',
    description: 'Apple ID пользователя',
  })
  appleId?: string;

  @ApiProperty({ example: 'ivan@example.com' })
  email: string | null;

  @ApiProperty({ example: 'Иван' })
  firstName: string;

  @ApiProperty({ example: '+79999999999' })
  phone: string;

  @ApiProperty({ example: 'Иванов' })
  lastName: string;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token: string;

  @ApiProperty({ example: 'Login successful via Google' })
  message: string;

  @ApiProperty({ example: 'ivan@example.com' })
  email: string;

  @ApiProperty({ example: 'Иван' })
  firstName: string;

  @ApiProperty({ example: 'Иванов' })
  lastName: string;
}
