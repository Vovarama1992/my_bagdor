import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, Max, IsBoolean, IsEnum } from 'class-validator';
import { AccountType } from '@prisma/client';

export class CreateReviewDto {
  @ApiProperty({ example: 5, description: 'Рейтинг от 1 до 5', required: true })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({
    example: 'Отличный сервис!',
    description: 'Комментарий к отзыву',
    required: true,
  })
  @IsString()
  comment: string;

  @ApiProperty({
    example: 10,
    description: 'ID рейса, к которому относится отзыв',
    required: true,
  })
  @IsInt()
  flightId: number;

  @ApiProperty({
    example: 25,
    description: 'ID заказа, к которому относится отзыв',
    required: true,
  })
  @IsInt()
  orderId: number;

  @ApiProperty({
    example: 'CUSTOMER',
    description: 'Тип аккаунта (заказчик или перевозчик)',
    enum: AccountType,
    required: true,
  })
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiProperty({
    example: false,
    description: 'Является ли отзыв спорным',
    required: false,
  })
  @IsBoolean()
  isDisputed?: boolean;
}
