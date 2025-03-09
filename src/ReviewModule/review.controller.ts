import {
  Controller,
  Post,
  Body,
  Headers,
  Param,
  Get,
  Patch,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { ReviewService } from './review.service';
import { CreateReviewDto } from './dto/review.dto';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @ApiOperation({ summary: 'Оставить отзыв на заказ' })
  @ApiResponse({ status: 201, description: 'Отзыв оставлен' })
  @ApiBody({ type: CreateReviewDto })
  @Post()
  async createReview(
    @Headers('authorization') authHeader: string,
    @Body() createReviewDto: CreateReviewDto,
  ) {
    return this.reviewService.createReview(authHeader, createReviewDto);
  }

  @ApiOperation({ summary: 'Получить список немодерированных отзывов' })
  @ApiResponse({ status: 200, description: 'Список отзывов без модерации' })
  @Get('pending-moderation')
  async getUnmoderatedReviews(@Headers('authorization') authHeader: string) {
    return this.reviewService.getUnmoderatedReviews(authHeader);
  }

  @ApiOperation({ summary: 'Подтвердить отзыв (модерация)' })
  @ApiParam({ name: 'reviewId', example: 1, description: 'ID отзыва' })
  @ApiResponse({ status: 200, description: 'Отзыв подтвержден' })
  @Patch(':reviewId/approve')
  async approveReviewModeration(
    @Headers('authorization') authHeader: string,
    @Param('reviewId') reviewId: string,
  ) {
    return this.reviewService.approveReviewModeration(authHeader, reviewId);
  }

  @ApiOperation({ summary: 'Отклонить отзыв (модерация)' })
  @ApiParam({ name: 'reviewId', example: 1, description: 'ID отзыва' })
  @ApiResponse({ status: 200, description: 'Отзыв удален' })
  @Delete(':reviewId/reject')
  async rejectReviewModeration(
    @Headers('authorization') authHeader: string,
    @Param('reviewId') reviewId: string,
  ) {
    return this.reviewService.rejectReviewModeration(authHeader, reviewId);
  }
}
