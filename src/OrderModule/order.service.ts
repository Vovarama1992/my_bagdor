import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  HttpException,
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
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      const order = await db.order.create({
        data: {
          userId: user.id,
          type: createOrderDto.type,
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

  async updateOrder(
    authHeader: string,
    orderId: number,
    updateData: { flightId: number },
  ) {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      const order = await db.order.findUnique({ where: { id: orderId } });

      if (!order) {
        throw new BadRequestException('Заказ не найден');
      }

      if (order.userId !== user.id) {
        throw new ForbiddenException('Вы не можете редактировать этот заказ');
      }

      const flight = await db.flight.findUnique({
        where: { id: updateData.flightId },
      });

      if (!flight) {
        throw new BadRequestException('Рейс не найден');
      }

      const updatedOrder = await db.order.update({
        where: { id: orderId },
        data: {
          flightId: flight.id,
          status: OrderStatus.PROCESSED_BY_CUSTOMER,
        },
      });

      return { message: 'Заказ обновлён', order: updatedOrder };
    } catch (error) {
      this.handleException(error, 'Ошибка при обновлении заказа');
    }
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

  async getUnmoderatedOrders(authHeader: string) {
    try {
      const { dbRegion } = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(dbRegion);

      const orders = await db.order.findMany({ where: { isModerated: false } });

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

  async getOrdersForCustomer(authHeader: string) {
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

  async getOrdersForCarrier(authHeader: string) {
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
        data: { isModerated: true },
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

  async acceptOrder(
    authHeader: string,
    orderId: string,
    acceptOrderDto?: AcceptOrderDto,
  ) {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prisma.getDatabase(user.dbRegion);

      const order = await db.order.findUnique({
        where: { id: Number(orderId) },
        include: { flight: true },
      });

      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.status === OrderStatus.CONFIRMED) {
        throw new BadRequestException('Заказ уже подтверждён');
      }

      // === Вариант 1: Заказчик указал рейс при создании ===
      if (order.status === OrderStatus.PROCESSED_BY_CUSTOMER) {
        if (!order.flight) {
          throw new BadRequestException('Ошибка: отсутствует привязанный рейс');
        }
        if (order.flight.userId !== user.id) {
          throw new ForbiddenException(
            'Вы не являетесь исполнителем этого рейса',
          );
        }

        // Перевозчик подтверждает заказ → статус CONFIRMED
        await db.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CONFIRMED },
        });

        return { message: 'Перевозчик подтвердил заказ, сделка заключена' };
      }

      // === Вариант 2: Заказчик создал заказ без указания рейса ===
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
          throw new ForbiddenException(
            'Вы не являетесь владельцем этого рейса',
          );
        }

        // Перевозчик назначает заказ на свой рейс → статус PROCESSED_BY_CARRIER
        await db.order.update({
          where: { id: order.id },
          data: {
            flightId: flight.id,
            status: OrderStatus.PROCESSED_BY_CARRIER,
          },
        });

        return { message: 'Заказ привязан к рейсу перевозчика' };
      }

      // === Вариант 3: Заказ уже привязан к рейсу перевозчиком (ждёт подтверждения заказчика) ===
      if (order.status === OrderStatus.PROCESSED_BY_CARRIER) {
        if (order.userId !== user.id) {
          throw new ForbiddenException(
            'Только заказчик может подтвердить этот заказ',
          );
        }

        // Заказчик подтверждает → статус CONFIRMED
        await db.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CONFIRMED },
        });

        return { message: 'Заказ подтверждён заказчиком' };
      }

      throw new BadRequestException(
        'Невозможно обработать заказ с таким статусом',
      );
    } catch (error) {
      this.handleException(error, 'Ошибка при принятии заказа');
    }
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
