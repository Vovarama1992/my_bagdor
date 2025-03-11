import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { Context } from 'telegraf';
import {} from 'telegraf/typings/core/types/typegram';
import { TelegramService } from './telegram.service';

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
  ) {}

  async getPendingCounts(): Promise<{
    reviews: number;
    orders: number;
    flights: number;
  }> {
    const databases = ['PENDING', 'RU', 'OTHER'];

    const results = await Promise.all(
      databases.map(async (region) => {
        const db = this.prisma.getDatabase(region);
        return {
          orders: await db.order.count({ where: { isModerated: false } }),
          flights: await db.flight.count({ where: { status: 'PENDING' } }),
          reviews: await db.review.count({ where: { isModerated: false } }),
        };
      }),
    );

    return results.reduce(
      (acc, curr) => ({
        orders: acc.orders + curr.orders,
        flights: acc.flights + curr.flights,
        reviews: acc.reviews + curr.reviews,
      }),
      { orders: 0, flights: 0, reviews: 0 },
    );
  }

  async sendPendingOrders(ctx: Context): Promise<void> {
    await this.sendOrdersFromDB(ctx, 'PENDING');
    await this.sendOrdersFromDB(ctx, 'RU');
    await this.sendOrdersFromDB(ctx, 'OTHER');
  }

  private async sendOrdersFromDB(
    ctx: Context,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const orders = await db.order.findMany({
      where: { isModerated: false },
      include: { user: true },
    });

    for (const order of orders) {
      await this.telegramService.sendOrderForModeration(order.id, dbRegion);
    }
  }

  async sendPendingFlights(ctx: Context): Promise<void> {
    await this.sendFlightsFromDB(ctx, 'PENDING');
    await this.sendFlightsFromDB(ctx, 'RU');
    await this.sendFlightsFromDB(ctx, 'OTHER');
  }

  private async sendFlightsFromDB(
    ctx: Context,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const flights = await db.flight.findMany({
      where: { status: 'PENDING' },
      include: { user: true },
    });

    for (const flight of flights) {
      await this.telegramService.sendFlightForModeration(flight.id, dbRegion);
    }
  }

  async sendPendingReviews(ctx: Context): Promise<void> {
    await this.sendReviewsFromDB(ctx, 'PENDING');
    await this.sendReviewsFromDB(ctx, 'RU');
    await this.sendReviewsFromDB(ctx, 'OTHER');
  }

  private async sendReviewsFromDB(
    ctx: Context,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const reviews = await db.review.findMany({
      where: { isModerated: false },
      include: { fromUser: true, toUser: true },
    });

    for (const review of reviews) {
      await this.telegramService.sendReviewForModeration(review.id, dbRegion);
    }
  }

  async approveItem(type: string, id: number, dbRegion: string): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    if (type === 'flight') {
      await db.flight.update({ where: { id }, data: { status: 'CONFIRMED' } });
    } else if (type === 'review') {
      await db.review.update({ where: { id }, data: { isModerated: true } });
    } else if (type === 'order') {
      await db.order.update({ where: { id }, data: { isModerated: true } });
    }
    this.logger.log(`${type.toUpperCase()} ${id} approved in ${dbRegion}`);
  }

  async rejectItem(type: string, id: number, dbRegion: string): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    if (type === 'flight') {
      await db.flight.delete({ where: { id } });
    } else if (type === 'review') {
      await db.review.delete({ where: { id } });
    } else if (type === 'order') {
      await db.order.delete({ where: { id } });
    }
    this.logger.log(`${type.toUpperCase()} ${id} rejected in ${dbRegion}`);
  }
}
