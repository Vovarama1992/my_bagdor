import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDate, IsOptional, IsInt } from 'class-validator';

export class CreateFlightDto {
  @ApiProperty({ example: 1, description: 'ID пользователя (перевозчика)' })
  @IsInt()
  userId: number;

  @ApiProperty({ example: 'SVO', description: 'Код аэропорта отправления' })
  @IsString()
  departure: string;

  @ApiProperty({ example: 'JFK', description: 'Код аэропорта прибытия' })
  @IsString()
  arrival: string;

  @ApiProperty({
    example: '2025-05-10T12:00:00Z',
    description: 'Дата и время рейса',
  })
  @IsDate()
  date: Date;

  @ApiProperty({
    example: 'Готов взять до 5 кг ручной клади',
    description: 'Описание перевозки',
  })
  @IsString()
  description: string;

  @ApiProperty({
    example: 'https://example.com/doc.pdf',
    description: 'Ссылка на маршрутную карту',
    required: false,
  })
  @IsOptional()
  @IsString()
  documentUrl?: string;
}
