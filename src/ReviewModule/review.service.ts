import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { UsersService } from 'src/UserModule/users.service';
import { CreateReviewDto } from './dto/review.dto';
import { FlightStatus } from '@prisma/client';
import { TelegramService } from 'src/TelegramModule/telegram.service';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly telegramService: TelegramService,
  ) {}

  async createReview(authHeader: string, createReviewDto: CreateReviewDto) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({
      where: { id: createReviewDto.orderId },
      include: { flight: { include: { reviews: true, orders: true } } },
    });

    if (!order) {
      throw new BadRequestException('Заказ не найден');
    }

    const existingReview = await db.review.findFirst({
      where: { orderId: order.id, fromUserId: user.id },
    });

    if (existingReview) {
      throw new BadRequestException('Вы уже оставили отзыв на этот заказ');
    }

    let toUserId: number;
    if (user.id === order.userId) {
      toUserId = order.flight?.userId ?? null;
    } else if (user.id === order.flight?.userId) {
      toUserId = order.userId;
    } else {
      throw new BadRequestException(
        'Вы не можете оставлять отзыв на этот заказ',
      );
    }

    const review = await db.review.create({
      data: {
        fromUserId: user.id,
        toUserId: toUserId,
        flightId: createReviewDto.flightId,
        dbRegion: user.dbRegion,
        orderId: createReviewDto.orderId,
        comment: createReviewDto.comment,
        rating: createReviewDto.rating,
        accountType: createReviewDto.accountType,
        isDisputed: createReviewDto.isDisputed || false,
      },
    });

    const flight = order.flight;
    const allOrders = flight.orders;
    const allReviews = flight.reviews.filter((r) => !r.isDisputed);

    const ordersWithCustomerReviews = allOrders.every((o) =>
      allReviews.some(
        (r) => r.orderId === o.id && r.accountType === 'CUSTOMER',
      ),
    );

    const ordersWithCarrierReviews = allOrders.every((o) =>
      allReviews.some((r) => r.orderId === o.id && r.accountType === 'CARRIER'),
    );

    if (ordersWithCustomerReviews && ordersWithCarrierReviews) {
      await db.flight.update({
        where: { id: flight.id },
        data: { status: FlightStatus.ARCHIVED },
      });
    }

    await this.telegramService.delegateToModeration(
      'review',
      review.id,
      user.dbRegion,
    );

    return { message: 'Отзыв оставлен', review };
  }

  async getUnmoderatedReviews(authHeader: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    return db.review.findMany({ where: { isModerated: false } });
  }

  async approveReviewModeration(authHeader: string, reviewId: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    return db.review.update({
      where: { id: Number(reviewId) },
      data: { isModerated: true },
    });
  }

  async rejectReviewModeration(authHeader: string, reviewId: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    await db.review.delete({ where: { id: Number(reviewId) } });

    return { message: 'Отзыв удален' };
  }
}
