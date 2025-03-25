import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { OrderType } from '@prisma/client';

export class CreateOrderDto {
  @ApiProperty({
    example: 'DOCUMENTS',
    description: 'Тип заказа (документы, личные вещи, покупка из магазина)',
    enum: OrderType,
    required: true,
  })
  @IsEnum(OrderType)
  type: OrderType;

  @ApiPropertyOptional({
    example: 2.5,
    description: 'Примерный вес (в кг)',
  })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiProperty({
    example: 'Перевезти ноутбук',
    description: 'Название заказа',
    required: true,
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Нужен курьер для перевозки документов',
    description: 'Описание заказа',
    required: true,
  })
  @IsString()
  description: string;

  @ApiProperty({
    example: 500,
    description: 'Стоимость заказа',
    required: true,
  })
  @IsNumber()
  price: number;

  @ApiProperty({
    example: 100,
    description: 'Вознаграждение перевозчику',
    required: true,
  })
  @IsNumber()
  reward: number;

  @ApiProperty({
    example: '2025-03-15T10:00:00Z',
    description: 'Начало периода доставки',
    required: true,
  })
  @IsDateString()
  deliveryStart: string;

  @ApiProperty({
    example: '2025-03-20T18:00:00Z',
    description: 'Конец периода доставки',
    required: true,
  })
  @IsDateString()
  deliveryEnd: string;

  @ApiProperty({
    example: 'Москва',
    description: 'Город отправления',
    required: true,
  })
  @IsString()
  departure: string;

  @ApiProperty({
    example: 'Париж',
    description: 'Город прибытия',
    required: true,
  })
  @IsString()
  arrival: string;

  @ApiPropertyOptional({
    example: 'https://example.com/product/123',
    description: 'Ссылка на товар',
  })
  @IsOptional()
  @IsString()
  productLink?: string;
}

export class AcceptOrderDto {
  @ApiProperty({
    example: 10,
    description:
      'ID рейса, к которому привязывается заказ (если подтверждает перевозчик)',
    required: false,
  })
  @IsInt()
  flightId?: number;
}
