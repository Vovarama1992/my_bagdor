import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { UsersService } from 'src/UserModule/users.service';
import { CreateOrderDto } from './dto/order.dto';
import {
  Flight,
  FlightStatus,
  ModerationStatus,
  OrderStatus,
} from '@prisma/client';
import { TelegramService } from 'src/TelegramModule/telegram.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OrderService {
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('BASE_URL');
  }

  async createOrder(authHeader: string, createOrderDto: CreateOrderDto) {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      if (
        createOrderDto.type === 'STORE_PURCHASE' &&
        !createOrderDto.productLink
      ) {
        throw new BadRequestException(
          'Product link is required for STORE_PURCHASE orders',
        );
      }

      const order = await db.order.create({
        data: {
          userId: user.id,
          productLink: createOrderDto.productLink || null,
          type: createOrderDto.type,
          weight: createOrderDto.weight,
          name: createOrderDto.name,
          dbRegion: user.dbRegion,
          description: createOrderDto.description,
          price: createOrderDto.price,
          reward: createOrderDto.reward,
          deliveryStart: new Date(createOrderDto.deliveryStart),
          deliveryEnd: new Date(createOrderDto.deliveryEnd),
          departure: createOrderDto.departure,
          arrival: createOrderDto.arrival,
        },
      });

      await this.telegramService.delegateToModeration(
        'order',
        order.id,
        user.dbRegion,
      );

      return { message: 'Заказ создан и отправлен на модерацию', order };
    } catch (error) {
      this.handleException(error, 'Ошибка при создании заказа');
    }
  }

  async attachOrderToFlight(
    authHeader: string,
    orderId: number,
    updateData: { flightId: number },
  ) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.userId !== user.id)
      throw new ForbiddenException('Вы не можете редактировать этот заказ');

    const flight = await db.flight.findUnique({
      where: { id: updateData.flightId },
    });
    if (!flight) throw new NotFoundException('Рейс не найден');

    const updatedOrder = await db.order.update({
      where: { id: orderId },
      data: {
        flightId: flight.id,
        status: OrderStatus.PROCESSED_BY_CUSTOMER,
      },
    });

    return { message: 'Заказ успешно привязан к рейсу', order: updatedOrder };
  }

  async uploadMedia(authHeader: string, orderId: string, fileNames: string[]) {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      const order = await db.order.findUnique({
        where: { id: Number(orderId) },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.userId !== user.id)
        throw new ForbiddenException('Вы не владелец этого заказа');

      const mediaUrls = fileNames.map(
        (file) => `${this.baseUrl}/orders/${orderId}/media/${file}`,
      );

      await db.order.update({
        where: { id: Number(orderId) },
        data: { mediaUrls: { push: mediaUrls } },
      });

      return { message: 'Файлы загружены', mediaUrls };
    } catch (error) {
      this.handleException(error, 'Ошибка при загрузке файлов для заказа');
    }
  }

  async addFavoriteOrder(authHeader: string, orderId: number) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const existingFavorite = await db.favoriteOrder.findFirst({
      where: {
        userId: user.id,
        orderId: orderId,
      },
    });

    if (existingFavorite) {
      throw new BadRequestException('Этот заказ уже в избранном');
    }

    await db.favoriteOrder.create({
      data: {
        userId: user.id,
        orderId: orderId,
      },
    });

    return { message: 'Заказ добавлен в избранное' };
  }

  async getUnmoderatedOrders(authHeader: string) {
    try {
      const { dbRegion } = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(dbRegion);

      const orders = await db.order.findMany({
        where: { moderationStatus: ModerationStatus.PENDING },
      });

      return orders.length
        ? orders
        : { message: 'Нет неподтвержденных заказов' };
    } catch (error) {
      this.handleException(
        error,
        'Ошибка при получении неподтвержденных заказов',
      );
    }
  }

  async getOrdersByCustomer(authHeader: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    return db.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrdersWaitingForCustomer(authHeader: string) {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      const orders = await db.order.findMany({
        where: { userId: user.id, status: OrderStatus.PROCESSED_BY_CARRIER },
        include: { flight: true },
      });

      if (!orders.length)
        throw new NotFoundException(
          'Нет заказов, ожидающих вашего подтверждения',
        );

      return { message: 'Заказы, ожидающие подтверждения заказчиком', orders };
    } catch (error) {
      this.handleException(error, 'Ошибка при получении заказов для заказчика');
    }
  }

  async getOrdersByCarrier(authHeader: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    return db.order.findMany({
      where: { carrierId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrdersWaitingForCarrier(authHeader: string) {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      const userFlights: Flight[] = await db.flight.findMany({
        where: { userId: user.id },
      });
      if (!userFlights.length)
        throw new NotFoundException('У вас нет активных рейсов');

      const flightIds = userFlights.map((flight) => flight.id);

      const orders = await db.order.findMany({
        where: {
          flightId: { in: flightIds },
          status: OrderStatus.PROCESSED_BY_CUSTOMER,
        },
        include: { user: true },
      });

      if (!orders.length)
        throw new NotFoundException(
          'Нет заказов, ожидающих вашего подтверждения',
        );

      return {
        message: 'Заказы, ожидающие подтверждения перевозчиком',
        orders,
      };
    } catch (error) {
      this.handleException(
        error,
        'Ошибка при получении заказов для перевозчика',
      );
    }
  }

  async getFavoriteOrders(authHeader: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const favorites = await db.favoriteOrder.findMany({
      where: { userId: user.id },
      include: { order: true },
    });

    return favorites.map((f) => f.order);
  }

  async editOrder(
    authHeader: string,
    orderId: number,
    updateData: CreateOrderDto,
  ) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Заказ не найден');
    }

    if (order.userId !== user.id) {
      throw new ForbiddenException('Вы не можете редактировать этот заказ');
    }

    const updatedOrder = await db.order.update({
      where: { id: orderId },
      data: updateData,
    });

    return { message: 'Заказ успешно отредактирован', order: updatedOrder };
  }

  async approveOrderModeration(authHeader: string, orderId: string) {
    try {
      const { dbRegion } = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(dbRegion);

      const order = await db.order.findUnique({
        where: { id: Number(orderId) },
      });
      if (!order) throw new NotFoundException('Заказ не найден');

      await db.order.update({
        where: { id: Number(orderId) },
        data: { moderationStatus: ModerationStatus.APPROVED },
      });

      return { message: `Заказ ${orderId} подтвержден` };
    } catch (error) {
      this.handleException(error, 'Ошибка при подтверждении заказа');
    }
  }

  async rejectOrderModeration(authHeader: string, orderId: string) {
    try {
      const { dbRegion } = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(dbRegion);

      const order = await db.order.findUnique({
        where: { id: Number(orderId) },
      });
      if (!order) throw new NotFoundException('Заказ не найден');

      await db.order.delete({ where: { id: Number(orderId) } });

      return { message: `Заказ ${orderId} отклонен и удален` };
    } catch (error) {
      this.handleException(error, 'Ошибка при отклонении заказа');
    }
  }

  async markOrderAsDelivered(authHeader: string, orderId: string) {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      const order = await db.order.findUnique({
        where: { id: Number(orderId) },
        include: { flight: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (!order.flight || order.flight.userId !== user.id) {
        throw new ForbiddenException('Вы не владелец этого рейса');
      }

      await db.order.update({
        where: { id: Number(orderId) },
        data: { isDone: true },
      });

      const remainingOrders = await db.order.findMany({
        where: { flightId: order.flightId, isDone: false },
      });

      if (!remainingOrders.length) {
        await db.flight.update({
          where: { id: order.flightId },
          data: { status: FlightStatus.COMPLETED },
        });

        return {
          message: 'Все заказы на этом рейсе доставлены. Рейс завершён.',
          flightId: order.flightId,
        };
      }

      return { message: 'Заказ помечен как доставленный', orderId };
    } catch (error) {
      this.handleException(
        error,
        'Ошибка при пометке заказа как доставленного',
      );
    }
  }

  async getArchivedOrders(authHeader: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    return db.order.findMany({
      where: {
        OR: [{ userId: user.id }, { carrierId: user.id }],
        isDone: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptOrderByCarrier(authHeader: string, orderId: number) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { flight: true },
    });

    if (!order) throw new NotFoundException('Заказ не найден');
    if (!order.flight || order.flight.userId !== user.id)
      throw new ForbiddenException('Заказ не привязан к вашему рейсу');

    if (order.status !== OrderStatus.PROCESSED_BY_CUSTOMER)
      throw new BadRequestException('Заказ не ожидает подтверждения');

    await db.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED, carrierId: user.id },
    });

    return { message: 'Вы приняли предложение заказчика, заказ подтверждён' };
  }

  private handleException(error: any, customMessage: string) {
    if (error.code === 'P2002')
      throw new BadRequestException(
        'Дублирование данных: такой заказ уже существует',
      );
    if (error.code === 'P2025')
      throw new NotFoundException('Запись не найдена');
    throw new HttpException(
      { message: customMessage, error: error.message },
      error.status || 500,
    );
  }
}
