import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, Max, IsBoolean } from 'class-validator';

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
    example: 3,
    description: 'ID пользователя, который оставил отзыв',
    required: true,
  })
  userId: number;
}

export class ReviewDto {
  @ApiProperty({ example: 1, description: 'ID отзыва', required: true })
  id: number;

  @ApiProperty({
    example: 3,
    description: 'ID пользователя, который оставил отзыв',
    required: true,
  })
  userId: number;

  @ApiProperty({ example: 5, description: 'Рейтинг', required: true })
  rating: number;

  @ApiProperty({
    example: 'Отличный сервис!',
    description: 'Комментарий',
    required: true,
  })
  comment: string;

  @ApiProperty({
    example: false,
    description: 'Прошел ли отзыв модерацию',
    required: true,
  })
  @IsBoolean()
  isModerated: boolean;

  @ApiProperty({
    example: '2025-03-01T12:00:00Z',
    description: 'Дата создания',
    required: true,
  })
  createdAt: string;
}
