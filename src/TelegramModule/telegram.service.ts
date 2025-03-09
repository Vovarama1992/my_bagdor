import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { Flight, Order, Review, User } from '@prisma/client';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Telegraf;
  private readonly moderatorChatId: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.moderatorChatId = this.configService.get<string>('TELEGRAM_CHAT_ID');

    if (!botToken || !this.moderatorChatId) {
      this.logger.warn('Telegram bot credentials are missing in .env');
      return;
    }

    this.bot = new Telegraf(botToken);
    this.logger.log('Telegram bot initialized');

    this.bot.action(/^approve_flight_(\d+)_(\w+)$/, async (ctx) => {
      const [, flightId, dbRegion] = ctx.match;
      this.logger.log(`Flight ${flightId} approved in ${dbRegion}`);
      await ctx.editMessageText(`✅ Рейс ${flightId} подтвержден`, {
        parse_mode: 'Markdown',
      });
      await this.approveFlight(Number(flightId), dbRegion);
    });

    this.bot.action(/^reject_flight_(\d+)_(\w+)$/, async (ctx) => {
      const [, flightId, dbRegion] = ctx.match;
      this.logger.log(`Flight ${flightId} rejected in ${dbRegion}`);
      await ctx.editMessageText(`❌ Рейс ${flightId} отклонен`, {
        parse_mode: 'Markdown',
      });
      await this.rejectFlight(Number(flightId), dbRegion);
    });

    this.bot.action(/^approve_review_(\d+)_(\w+)$/, async (ctx) => {
      const [, reviewId, dbRegion] = ctx.match;
      this.logger.log(`Review ${reviewId} approved in ${dbRegion}`);
      await ctx.editMessageText(`✅ Отзыв ${reviewId} подтвержден`, {
        parse_mode: 'Markdown',
      });
      await this.approveReview(Number(reviewId), dbRegion);
    });

    this.bot.action(/^reject_review_(\d+)_(\w+)$/, async (ctx) => {
      const [, reviewId, dbRegion] = ctx.match;
      this.logger.log(`Review ${reviewId} rejected in ${dbRegion}`);
      await ctx.editMessageText(`❌ Отзыв ${reviewId} отклонен`, {
        parse_mode: 'Markdown',
      });
      await this.rejectReview(Number(reviewId), dbRegion);
    });

    this.bot.action(/^approve_order_(\d+)_(\w+)$/, async (ctx) => {
      const [, orderId, dbRegion] = ctx.match;
      this.logger.log(`Order ${orderId} approved in ${dbRegion}`);
      await ctx.editMessageText(`✅ Заказ ${orderId} подтвержден`, {
        parse_mode: 'Markdown',
      });
      await this.approveOrder(Number(orderId), dbRegion);
    });

    this.bot.action(/^reject_order_(\d+)_(\w+)$/, async (ctx) => {
      const [, orderId, dbRegion] = ctx.match;
      this.logger.log(`Order ${orderId} rejected in ${dbRegion}`);
      await ctx.editMessageText(`❌ Заказ ${orderId} отклонен`, {
        parse_mode: 'Markdown',
      });
      await this.rejectOrder(Number(orderId), dbRegion);
    });

    this.bot.action('get_pending_items', async (ctx) => {
      this.logger.log('Fetching pending items from all databases...');

      const pendingItems = await this.getPendingItems();
      if (!pendingItems.length) {
        return ctx.reply('✅ Нет неподтвержденных заявок.');
      }

      for (const item of pendingItems) {
        const message = `🔹 *${item.type}* (ID: ${item.id}) - Регион: ${item.region}`;

        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '✅ Подтвердить',
                `approve_${item.type.toLowerCase()}_${item.id}_${item.region}`,
              ),
              Markup.button.callback(
                '❌ Отклонить',
                `reject_${item.type.toLowerCase()}_${item.id}_${item.region}`,
              ),
            ],
          ]),
        });
      }
    });

    this.bot.action(
      /^approve_(flight|review|order)_(\d+)_(\w+)$/,
      async (ctx) => {
        const [, type, itemId, dbRegion] = ctx.match;
        this.logger.log(`Approving ${type} ${itemId} in ${dbRegion}`);

        await this.approveItem(type, Number(itemId), dbRegion);
        await ctx.editMessageText(
          `✅ ${type.toUpperCase()} ${itemId} подтвержден`,
          { parse_mode: 'Markdown' },
        );
      },
    );

    this.bot.action(
      /^reject_(flight|review|order)_(\d+)_(\w+)$/,
      async (ctx) => {
        const [, type, itemId, dbRegion] = ctx.match;
        this.logger.log(`Rejecting ${type} ${itemId} in ${dbRegion}`);

        await this.rejectItem(type, Number(itemId), dbRegion);
        await ctx.editMessageText(
          `❌ ${type.toUpperCase()} ${itemId} отклонен`,
          { parse_mode: 'Markdown' },
        );
      },
    );

    this.bot.launch();
  }

  async sendOrderForModeration(
    order: Order,
    user: Partial<User>,
    dbRegion: string,
  ) {
    if (!this.bot) {
      this.logger.warn('Telegram bot is not initialized');
      return;
    }

    const message = `
  📦 *Новый заказ на модерации*  
  👤 *Заказчик:* ${user.firstName || 'Неизвестно'} ${user.lastName || ''}  
  📩 *Email:* ${user.email || 'Не указан'}  
  📞 *Телефон:* ${user.phone || 'Не указан'}  
  📍 *Рейс:* ${order.flightId ? `ID: ${order.flightId}` : 'Не указан'}  
  📝 *Описание груза:* ${order.description}  
  🔗 *ID заказа:* ${order.id}  
  🌍 *Регион:* ${dbRegion}  
    `;

    try {
      await this.bot.telegram.sendMessage(this.moderatorChatId, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Подтвердить заказ',
              `approve_order_${order.id}_${dbRegion}`,
            ),
          ],
          [
            Markup.button.callback(
              '❌ Отклонить заказ',
              `reject_order_${order.id}_${dbRegion}`,
            ),
          ],
        ]),
      });
      this.logger.log(`Order ${order.id} sent to moderation in ${dbRegion}`);
    } catch (error) {
      this.logger.error(
        `Failed to send order ${order.id} to Telegram: ${error.message}`,
      );
    }
  }

  async sendFlightForModeration(flight: Flight, dbRegion: string) {
    if (!this.bot) {
      this.logger.warn('Telegram bot is not initialized');
      return;
    }

    const user = await this.prisma.getDatabase(dbRegion).user.findUnique({
      where: { id: flight.userId },
    });

    if (!user) {
      this.logger.warn(`User ${flight.userId} not found in ${dbRegion}`);
      return;
    }

    const message = `
  ✈️ *Новый рейс на модерации*  
  👤 *Перевозчик:* ${user.firstName || 'Неизвестно'} ${user.lastName || ''}  
  📩 *Email:* ${user.email || 'Не указан'}  
  📞 *Телефон:* ${user.phone || 'Не указан'}  
  📍 *Отправление:* ${flight.departure}  
  📍 *Прибытие:* ${flight.arrival}  
  🗓 *Дата:* ${new Date(flight.date).toLocaleString()}  
  🔗 *ID рейса:* ${flight.id}  
  🌍 *Регион:* ${dbRegion}  
    `;

    try {
      await this.bot.telegram.sendMessage(this.moderatorChatId, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Подтвердить',
              `approve_flight_${flight.id}_${dbRegion}`,
            ),
          ],
          [
            Markup.button.callback(
              '❌ Отклонить',
              `reject_flight_${flight.id}_${dbRegion}`,
            ),
          ],
        ]),
      });
      this.logger.log(`Flight ${flight.id} sent to moderation in ${dbRegion}`);
    } catch (error) {
      this.logger.error(
        `Failed to send flight ${flight.id} to Telegram: ${error.message}`,
      );
    }
  }

  async sendReviewForModeration(
    review: Review,
    user: Partial<User>,
    dbRegion: string,
  ) {
    if (!this.bot) {
      this.logger.warn('Telegram bot is not initialized');
      return;
    }

    const message = `
  📝 *Новый отзыв на модерации*  
  👤 *Автор:* ${user.firstName || 'Неизвестно'} ${user.lastName || ''}  
  📩 *Email:* ${user.email || 'Не указан'}  
  📞 *Телефон:* ${user.phone || 'Не указан'}  
  ⭐ *Оценка:* ${review.rating}/5  
  💬 *Комментарий:* ${review.comment}  
  🔗 *ID отзыва:* ${review.id}  
  🌍 *Регион:* ${dbRegion}  
    `;

    try {
      await this.bot.telegram.sendMessage(this.moderatorChatId, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Подтвердить',
              `approve_review_${review.id}_${dbRegion}`,
            ),
          ],
          [
            Markup.button.callback(
              '❌ Отклонить',
              `reject_review_${review.id}_${dbRegion}`,
            ),
          ],
        ]),
      });
      this.logger.log(`Review ${review.id} sent to moderation in ${dbRegion}`);
    } catch (error) {
      this.logger.error(
        `Failed to send review ${review.id} to Telegram: ${error.message}`,
      );
    }
  }

  private async getPendingItems() {
    const databases = ['PENDING', 'RU', 'OTHER']; // Какие базы проверяем
    const pendingItems = [];

    for (const dbRegion of databases) {
      const db = this.prisma.getDatabase(dbRegion);

      const flights = await db.flight.findMany({
        where: { status: 'PENDING' },
        select: { id: true },
      });
      pendingItems.push(
        ...flights.map((f) => ({ type: 'flight', id: f.id, region: dbRegion })),
      );

      const reviews = await db.review.findMany({
        where: { isModerated: false },
        select: { id: true },
      });
      pendingItems.push(
        ...reviews.map((r) => ({ type: 'review', id: r.id, region: dbRegion })),
      );

      const orders = await db.order.findMany({
        where: { isModerated: false },
        select: { id: true },
      });
      pendingItems.push(
        ...orders.map((o) => ({ type: 'order', id: o.id, region: dbRegion })),
      );
    }

    return pendingItems;
  }

  private async approveFlight(flightId: number, dbRegion: string) {
    await this.prisma.getDatabase(dbRegion).flight.update({
      where: { id: flightId },
      data: { status: 'CONFIRMED' },
    });
    this.logger.log(`Flight ${flightId} approved in ${dbRegion}`);
  }

  private async rejectFlight(flightId: number, dbRegion: string) {
    await this.prisma.getDatabase(dbRegion).flight.delete({
      where: { id: flightId },
    });
    this.logger.log(`Flight ${flightId} rejected in ${dbRegion}`);
  }

  private async approveReview(reviewId: number, dbRegion: string) {
    await this.prisma.getDatabase(dbRegion).review.update({
      where: { id: reviewId },
      data: { isModerated: true },
    });
    this.logger.log(`Review ${reviewId} approved in ${dbRegion}`);
  }

  private async rejectReview(reviewId: number, dbRegion: string) {
    await this.prisma.getDatabase(dbRegion).review.delete({
      where: { id: reviewId },
    });
    this.logger.log(`Review ${reviewId} rejected in ${dbRegion}`);
  }

  private async approveOrder(orderId: number, dbRegion: string) {
    await this.prisma.getDatabase(dbRegion).order.update({
      where: { id: orderId },
      data: { isModerated: true },
    });
    this.logger.log(`Order ${orderId} approved in ${dbRegion}`);
  }

  private async rejectOrder(orderId: number, dbRegion: string) {
    await this.prisma.getDatabase(dbRegion).order.delete({
      where: { id: orderId },
    });
    this.logger.log(`Order ${orderId} rejected in ${dbRegion}`);
  }

  private async approveItem(type: string, id: number, dbRegion: string) {
    const db = this.prisma.getDatabase(dbRegion);

    if (type === 'flight') {
      await db.flight.update({ where: { id }, data: { status: 'CONFIRMED' } });
    } else if (type === 'review') {
      await db.review.update({ where: { id }, data: { isModerated: true } });
    } else if (type === 'order') {
      await db.order.update({ where: { id }, data: { isModerated: true } });
    }
  }

  private async rejectItem(type: string, id: number, dbRegion: string) {
    const db = this.prisma.getDatabase(dbRegion);

    if (type === 'flight') {
      await db.flight.delete({ where: { id } });
    } else if (type === 'review') {
      await db.review.delete({ where: { id } });
    } else if (type === 'order') {
      await db.order.delete({ where: { id } });
    }
  }
}
