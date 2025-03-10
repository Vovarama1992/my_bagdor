import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { Markup, Context } from 'telegraf';

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(private prisma: PrismaService) {}

  async getPendingCounts(): Promise<{
    reviews: number;
    orders: number;
    flights: number;
  }> {
    const db = this.prisma.getDatabase('PENDING');
    const reviews = await db.review.count({ where: { isModerated: false } });
    const orders = await db.order.count({ where: { isModerated: false } });
    const flights = await db.flight.count({ where: { status: 'PENDING' } });
    return { reviews, orders, flights };
  }

  async sendPendingReviews(ctx: Context): Promise<void> {
    const db = this.prisma.getDatabase('PENDING');
    const reviews = await db.review.findMany({ where: { isModerated: false } });
    for (const review of reviews) {
      await ctx.reply(
        `📝 *Отзыв #${review.id}*\n👤 От кого: ${review.fromUserId}\n👤 Кому: ${review.toUserId}\n⭐ Оценка: ${review.rating}/5\n💬 Комментарий: ${review.comment}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Опубликовать',
              `approve_review_${review.id}_PENDING`,
            ),
          ],
          [
            Markup.button.callback(
              '❌ Отклонить',
              `reject_review_${review.id}_PENDING`,
            ),
          ],
        ]),
      );
    }
  }

  async sendPendingOrders(ctx: Context): Promise<void> {
    const db = this.prisma.getDatabase('PENDING');
    const orders = await db.order.findMany({ where: { isModerated: false } });
    for (const order of orders) {
      await ctx.reply(
        `📦 *Заказ #${order.id}*\n👤 Пользователь: ${order.userId}\n📜 Описание: ${order.description}\n💰 Стоимость: ${order.price} ₽\n🎁 Вознаграждение: ${order.reward} ₽\n📅 Доставка: ${order.deliveryStart ? new Date(order.deliveryStart).toLocaleDateString() : 'Не указано'} – ${order.deliveryEnd ? new Date(order.deliveryEnd).toLocaleDateString() : 'Не указано'}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Опубликовать',
              `approve_order_${order.id}_PENDING`,
            ),
          ],
          [
            Markup.button.callback(
              '❌ Отклонить',
              `reject_order_${order.id}_PENDING`,
            ),
          ],
        ]),
      );
    }
  }

  async sendPendingFlights(ctx: Context): Promise<void> {
    const db = this.prisma.getDatabase('PENDING');
    const flights = await db.flight.findMany({ where: { status: 'PENDING' } });
    for (const flight of flights) {
      await ctx.reply(
        `✈️ *Рейс #${flight.id}*\n👤 Перевозчик: ${flight.userId}\n📍 Откуда: ${flight.departure}\n📍 Куда: ${flight.arrival}\n📅 Дата: ${new Date(flight.date).toLocaleString()}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Подтвердить',
              `approve_flight_${flight.id}_PENDING`,
            ),
          ],
          [
            Markup.button.callback(
              '❌ Отклонить',
              `reject_flight_${flight.id}_PENDING`,
            ),
          ],
        ]),
      );
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
