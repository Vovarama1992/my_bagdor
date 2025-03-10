import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { UsersService } from 'src/UserModule/users.service';
import { CreateOrderDto, AcceptOrderDto } from './dto/order.dto';
import { Flight, FlightStatus, OrderStatus } from '@prisma/client';
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
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    let flight = null;
    let status: OrderStatus;

    if (createOrderDto.flightId) {
      flight = await db.flight.findUnique({
        where: { id: createOrderDto.flightId },
      });

      if (!flight || flight.status !== FlightStatus.CONFIRMED) {
        throw new BadRequestException('Рейс не найден или не подтверждён');
      }

      status = OrderStatus.PROCESSED_BY_CUSTOMER;
    }

    const order = await db.order.create({
      data: {
        userId: user.id,
        flightId: flight ? flight.id : null,
        description: createOrderDto.description,
        status,
      },
    });

    await this.telegramService.sendOrderForModeration(order.id, user.dbRegion);

    return { message: 'Заказ создан и отправлен на модерацию', order };
  }

  async uploadMedia(authHeader: string, orderId: string, fileNames: string[]) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({
      where: { id: Number(orderId) },
    });

    if (!order) {
      throw new NotFoundException('Заказ не найден');
    }

    if (order.userId !== user.id) {
      throw new ForbiddenException('Вы не владелец этого заказа');
    }

    const mediaUrls = fileNames.map(
      (file) => `${this.baseUrl}/orders/${orderId}/media/${file}`,
    );

    await db.order.update({
      where: { id: Number(orderId) },
      data: { mediaUrls: { push: mediaUrls } },
    });

    return { message: 'Файлы загружены', mediaUrls };
  }

  async getUnmoderatedOrders(authHeader: string) {
    const { dbRegion } = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(dbRegion);

    const orders = await db.order.findMany({
      where: { isModerated: false },
    });

    return orders.length ? orders : { message: 'Нет неподтвержденных заказов' };
  }

  async approveOrderModeration(authHeader: string, orderId: string) {
    const { dbRegion } = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(dbRegion);

    const order = await db.order.findUnique({ where: { id: Number(orderId) } });
    if (!order) throw new NotFoundException('Заказ не найден');

    await db.order.update({
      where: { id: Number(orderId) },
      data: { isModerated: true },
    });

    return { message: `Заказ ${orderId} подтвержден` };
  }

  async rejectOrderModeration(authHeader: string, orderId: string) {
    const { dbRegion } = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(dbRegion);

    const order = await db.order.findUnique({ where: { id: Number(orderId) } });
    if (!order) throw new NotFoundException('Заказ не найден');

    await db.order.delete({ where: { id: Number(orderId) } });

    return { message: `Заказ ${orderId} отклонен и удален` };
  }

  async acceptOrder(
    authHeader: string,
    orderId: string,
    acceptOrderDto?: AcceptOrderDto,
  ) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({
      where: { id: Number(orderId) },
      include: { flight: true }, // Загружаем связанный рейс
    });

    if (!order) {
      throw new NotFoundException('Заказ не найден');
    }

    if (order.status === OrderStatus.CONFIRMED) {
      throw new BadRequestException('Заказ уже подтверждён');
    }

    if (order.status === OrderStatus.PROCESSED_BY_CUSTOMER) {
      // Подтвердить может только перевозчик, который отвечает за указанный рейс
      if (!order.flight || order.flight.userId !== user.id) {
        throw new ForbiddenException(
          'Вы не являетесь исполнителем этого рейса',
        );
      }

      await db.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CONFIRMED },
      });

      return { message: 'Перевозчик подтвердил заказ, сделка заключена' };
    }

    if (order.status === OrderStatus.PROCESSED_BY_CARRIER) {
      if (order.userId !== user.id) {
        throw new ForbiddenException(
          'Только заказчик может подтвердить этот заказ',
        );
      }

      await db.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CONFIRMED },
      });

      return { message: 'Заказчик подтвердил заказ' };
    }

    if (order.status === OrderStatus.RAW) {
      if (!acceptOrderDto?.flightId) {
        throw new BadRequestException('Не указан рейс для привязки');
      }

      const flight = await db.flight.findUnique({
        where: { id: acceptOrderDto.flightId },
      });

      if (!flight || flight.status !== FlightStatus.CONFIRMED) {
        throw new BadRequestException('Рейс не найден или не подтверждён');
      }

      if (flight.userId !== user.id) {
        throw new ForbiddenException('Вы не являетесь владельцем этого рейса');
      }

      await db.order.update({
        where: { id: order.id },
        data: {
          flightId: flight.id,
          status: OrderStatus.PROCESSED_BY_CARRIER,
        },
      });

      return { message: 'Перевозчик подтвердил заказ' };
    }

    throw new BadRequestException(
      'Невозможно обработать заказ с таким статусом',
    );
  }

  async getOrdersForCustomer(authHeader: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const orders = await db.order.findMany({
      where: {
        userId: user.id,
        status: OrderStatus.PROCESSED_BY_CARRIER,
      },
      include: { flight: true },
    });

    if (!orders.length) {
      throw new NotFoundException(
        'Нет заказов, ожидающих вашего подтверждения',
      );
    }

    return { message: 'Заказы, ожидающие подтверждения заказчиком', orders };
  }

  async getOrdersForCarrier(authHeader: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    // Найти все рейсы пользователя
    const userFlights: Flight[] = await db.flight.findMany({
      where: { userId: user.id },
    });

    if (!userFlights.length) {
      throw new NotFoundException('У вас нет активных рейсов');
    }

    const flightIds = userFlights.map((flight) => flight.id);

    const orders = await db.order.findMany({
      where: {
        flightId: { in: flightIds },
        status: OrderStatus.PROCESSED_BY_CUSTOMER,
      },
      include: { user: true },
    });

    if (!orders.length) {
      throw new NotFoundException(
        'Нет заказов, ожидающих вашего подтверждения',
      );
    }

    return { message: 'Заказы, ожидающие подтверждения перевозчиком', orders };
  }

  async markOrderAsDelivered(authHeader: string, orderId: string) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({
      where: { id: Number(orderId) },
      include: { flight: true },
    });

    if (!order) {
      throw new NotFoundException('Заказ не найден');
    }

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

    if (remainingOrders.length === 0) {
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
  }
}
