import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsBoolean } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 1, description: 'ID заказчика', required: true })
  @IsInt()
  userId: number;

  @ApiProperty({
    example: 'Нужен курьер для перевозки документов',
    description: 'Описание заказа',
    required: true,
  })
  @IsString()
  description: string;

  @ApiProperty({
    example: 10,
    description: 'ID рейса, к которому привязывается заказ (если известен)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  flightId?: number;
}

export class AcceptOrderDto {
  @ApiProperty({
    example: true,
    description: 'Подтвержден ли заказ (исполнителем или заказчиком)',
    required: true,
  })
  @IsBoolean()
  isAccepted: boolean;

  @ApiProperty({
    example: 10,
    description:
      'ID рейса, к которому привязывается заказ (если подтверждает перевозчик)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  flightId?: number;
}
