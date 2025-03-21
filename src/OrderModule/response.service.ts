import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { UsersService } from 'src/UserModule/users.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class ResponseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async createResponse(
    authHeader: string,
    orderId: number,
    flightId: number,
    message?: string,
    priceOffer?: number,
  ) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);
    if (!message?.trim()) {
      throw new BadRequestException('Сообщение обязательно');
    }

    const [order, flight, existingResponses] = await Promise.all([
      db.order.findUnique({ where: { id: orderId } }),
      db.flight.findUnique({ where: { id: flightId, userId: user.id } }),
      db.response.findMany({ where: { orderId } }),
    ]);

    if (flight.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Можно откликаться только на подтверждённые рейсы',
      );
    }

    if (!order) throw new NotFoundException('Заказ не найден');
    if (!flight)
      throw new NotFoundException('Рейс не найден или вам не принадлежит');

    const response = await db.response.create({
      data: { orderId, flightId, carrierId: user.id, message, priceOffer },
    });

    if (existingResponses.length === 0) {
      await db.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PROCESSED_BY_CARRIER },
      });
    }

    return { message: 'Отклик создан', response };
  }

  async acceptResponse(authHeader: string, responseId: number) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const response = await db.response.findUnique({
      where: { id: responseId },
      include: { order: true },
    });

    if (!response) throw new NotFoundException('Отклик не найден');
    if (response.order.userId !== user.id)
      throw new ForbiddenException('Вы не владелец заказа');

    await db.$transaction([
      db.response.update({
        where: { id: responseId },
        data: { isAccepted: true },
      }),
      db.order.update({
        where: { id: response.orderId },
        data: {
          flightId: response.flightId,
          carrierId: response.carrierId,
          status: OrderStatus.CONFIRMED,
        },
      }),
    ]);

    return { message: 'Отклик принят, заказ подтверждён' };
  }

  async rejectResponse(authHeader: string, responseId: number) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const response = await db.response.findUnique({
      where: { id: responseId },
      include: { order: true },
    });

    if (!response) throw new NotFoundException('Отклик не найден');
    if (response.order.userId !== user.id)
      throw new ForbiddenException('Вы не владелец заказа');

    await db.response.delete({ where: { id: responseId } });

    const remainingResponses = await db.response.count({
      where: { orderId: response.orderId },
    });

    if (remainingResponses === 0) {
      await db.order.update({
        where: { id: response.orderId },
        data: { status: OrderStatus.RAW },
      });
    }

    return { message: 'Отклик отклонён и удалён' };
  }

  async getResponsesForOrder(authHeader: string, orderId: number) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    const responses = await db.response.findMany({
      where: { orderId },
      include: {
        carrier: true,
        flight: true,
      },
    });

    return responses;
  }
}
