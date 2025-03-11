import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { Flight, Order, Review, User } from '@prisma/client';

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(private prisma: PrismaService) {}

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

  async getPendingOrders(): Promise<(Order & { user: User })[]> {
    const databases = ['PENDING', 'RU', 'OTHER'];

    const orders = await Promise.all(
      databases.map(async (region) => {
        const db = this.prisma.getDatabase(region);
        return db.order.findMany({
          where: { isModerated: false },
          include: { user: true },
        });
      }),
    );
    return orders.flat();
  }

  async getPendingFlights(): Promise<(Flight & { user: User })[]> {
    const databases = ['PENDING', 'RU', 'OTHER'];

    const flights = await Promise.all(
      databases.map(async (region) => {
        const db = this.prisma.getDatabase(region);
        return db.flight.findMany({
          where: { status: 'PENDING' },
          include: { user: true },
        });
      }),
    );
    return flights.flat();
  }

  async getPendingReviews(): Promise<
    (Review & { fromUser: User } & { toUser: User })[]
  > {
    const databases = ['PENDING', 'RU', 'OTHER'];

    const reviews = await Promise.all(
      databases.map(async (region) => {
        const db = this.prisma.getDatabase(region);
        return db.review.findMany({
          where: { isModerated: false },
          include: { fromUser: true, toUser: true },
        });
      }),
    );
    return reviews.flat();
  }

  async findOrderById(
    dbRegion: string,
    orderId: number,
  ): Promise<(Order & { user: User }) | null> {
    const db = this.prisma.getDatabase(dbRegion);
    return db.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });
  }

  async findFlightById(
    dbRegion: string,
    flightId: number,
  ): Promise<(Flight & { user: User }) | null> {
    const db = this.prisma.getDatabase(dbRegion);
    return db.flight.findUnique({
      where: { id: flightId },
      include: { user: true },
    });
  }

  async findReviewById(
    dbRegion: string,
    reviewId: number,
  ): Promise<(Review & { fromUser: User; toUser: User }) | null> {
    const db = this.prisma.getDatabase(dbRegion);
    return db.review.findUnique({
      where: { id: reviewId },
      include: { fromUser: true, toUser: true },
    });
  }

  async approveItem(dbRegion: string, type: string, id: number): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);

    try {
      if (type === 'flight') {
        await db.flight.update({
          where: { id },
          data: { status: 'CONFIRMED' },
        });
        this.logger.log(`FLIGHT ${id} approved in ${dbRegion}`);
      } else if (type === 'review') {
        await db.review.update({ where: { id }, data: { isModerated: true } });
        this.logger.log(`REVIEW ${id} approved in ${dbRegion}`);
      } else if (type === 'order') {
        await db.order.update({ where: { id }, data: { isModerated: true } });
        this.logger.log(`ORDER ${id} approved in ${dbRegion}`);
      }
    } catch (e) {
      this.logger.warn(
        `Failed to approve ${type.toUpperCase()} ${id} in ${dbRegion}: ${e.message}`,
      );
    }
  }

  async rejectItem(dbRegion: string, type: string, id: number): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);

    try {
      if (type === 'flight') {
        await db.flight.delete({ where: { id } });
        this.logger.log(`FLIGHT ${id} rejected in ${dbRegion}`);
      } else if (type === 'review') {
        await db.review.delete({ where: { id } });
        this.logger.log(`REVIEW ${id} rejected in ${dbRegion}`);
      } else if (type === 'order') {
        await db.order.delete({ where: { id } });
        this.logger.log(`ORDER ${id} rejected in ${dbRegion}`);
      }
    } catch (e) {
      this.logger.warn(
        `Failed to reject ${type.toUpperCase()} ${id} in ${dbRegion}: ${e.message}`,
      );
    }
  }
}
