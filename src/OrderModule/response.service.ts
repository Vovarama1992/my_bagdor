import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { UsersService } from 'src/UserModule/users.service';
import { DbRegion, OrderStatus } from '@prisma/client';

@Injectable()
export class ResponseService {
  private readonly logger = new Logger(ResponseService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async createResponse(
    authHeader: string,
    region: DbRegion,
    orderId: number,
    flightId: number,
    message?: string,
    priceOffer?: number,
  ) {
    this.logger.log(
      `Called createResponse: region=${region}, orderId=${orderId}, flightId=${flightId}`,
    );

    try {
      const user = await this.usersService.authenticate(authHeader);
      this.logger.debug(
        `Authenticated user ${user.id}, dbRegion=${user.dbRegion}`,
      );

      if (!message?.trim()) {
        this.logger.warn(`Empty message from user ${user.id}`);
        throw new BadRequestException('Сообщение обязательно');
      }

      const orderDb = this.prisma.getDatabase(region);
      const userDb = this.prisma.getDatabase(user.dbRegion);

      let order, flight, existingResponses;

      try {
        order = await orderDb.order.findUnique({ where: { id: orderId } });
        if (!order) {
          this.logger.warn(`Order ${orderId} not found in region ${region}`);
          throw new NotFoundException('Заказ не найден');
        }

        if (order.dbRegion !== user.dbRegion) {
          this.logger.warn(
            `User ${user.id} (region ${user.dbRegion}) пытается откликнуться на заказ из другого региона (${order.dbRegion})`,
          );
          throw new BadRequestException(
            'Нельзя откликаться на заказ из другого региона',
          );
        }

        flight = await userDb.flight.findUnique({
          where: { id: flightId, userId: user.id },
        });

        existingResponses = await orderDb.response.findMany({
          where: { orderId },
        });

        this.logger.debug(
          `Fetched flight=${!!flight}, responses=${existingResponses.length}`,
        );
      } catch (error) {
        this.logger.error('Ошибка при получении данных', error.stack);
        throw error;
      }

      if (!flight) {
        this.logger.warn(
          `Flight ${flightId} not found or not owned by user ${user.id}`,
        );
        throw new NotFoundException('Рейс не найден или вам не принадлежит');
      }

      if (flight.status !== 'CONFIRMED') {
        this.logger.warn(
          `Flight ${flightId} is not confirmed (status: ${flight.status})`,
        );
        throw new BadRequestException(
          'Можно откликаться только на подтверждённые рейсы',
        );
      }

      let response;
      try {
        response = await orderDb.response.create({
          data: { orderId, flightId, carrierId: user.id, message, priceOffer },
        });
      } catch (error) {
        this.logger.error('Ошибка при создании отклика', error.stack);
        throw error;
      }

      if (existingResponses.length === 0) {
        try {
          await orderDb.order.update({
            where: { id: orderId },
            data: { status: OrderStatus.PROCESSED_BY_CARRIER },
          });
          this.logger.debug(
            `Order ${orderId} status updated to PROCESSED_BY_CARRIER`,
          );
        } catch (error) {
          this.logger.error(
            'Ошибка при обновлении статуса заказа',
            error.stack,
          );
        }
      }

      this.logger.log(`Отклик создан: orderId=${orderId}, userId=${user.id}`);
      return { message: 'Отклик создан', response };
    } catch (error) {
      this.logger.error('❌ Unhandled error in createResponse', error.stack);
      this.handleException(error);
    }
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

  handleException(error: any) {
    const status = error?.status || 500;
    throw new HttpException(
      {
        code: status,
        status: 'error',
        stack: error.stack || 'no stack trace',
      },
      status,
    );
  }
}
