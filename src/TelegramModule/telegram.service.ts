import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup, Context } from 'telegraf';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { ModerationService } from './moderation.service';
import {
  InputMediaPhoto,
  InputMediaVideo,
} from 'telegraf/typings/core/types/typegram';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Telegraf;
  private readonly moderatorChatId: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private moderationService: ModerationService,
  ) {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.moderatorChatId = this.configService.get<string>('TELEGRAM_CHAT_ID');

    if (!botToken || !this.moderatorChatId) {
      this.logger.warn('Telegram bot credentials are missing in .env');
      return;
    }

    this.bot = new Telegraf(botToken);
    this.logger.log('Telegram bot initialized');

    this.bot.start(async (ctx) => {
      await this.showMainMenu(ctx);
    });

    this.bot.action(
      /^approve_(order|flight|review)_(\d+)_PENDING$/,
      async (ctx) => {
        const [, type, id] = ctx.match;
        await this.moderationService.approveItem(type, parseInt(id), 'PENDING');
        await ctx.answerCbQuery(
          `✅ ${this.getTypeLabel(type)} #${id} подтвержден`,
        );
        await ctx.deleteMessage();
      },
    );

    this.bot.action(
      /^reject_(order|flight|review)_(\d+)_PENDING$/,
      async (ctx) => {
        const [, type, id] = ctx.match;
        await this.moderationService.rejectItem(type, parseInt(id), 'PENDING');
        await ctx.answerCbQuery(
          `❌ ${this.getTypeLabel(type)} #${id} отклонен`,
        );
        await ctx.deleteMessage();
      },
    );

    this.bot.action('moderate_reviews', async (ctx) => {
      await this.moderationService.sendPendingReviews(ctx);
    });

    this.bot.action('moderate_orders', async (ctx) => {
      await this.moderationService.sendPendingOrders(ctx);
    });

    this.bot.action('moderate_flights', async (ctx) => {
      await this.moderationService.sendPendingFlights(ctx);
    });

    this.bot.launch();
  }

  async showMainMenu(ctx: Context) {
    const pendingCounts = await this.moderationService.getPendingCounts();
    await ctx.reply(
      '📌 *Меню модерации*',
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `📜 Отзывы (${pendingCounts.reviews})`,
            'moderate_reviews',
          ),
        ],
        [
          Markup.button.callback(
            `📦 Заказы (${pendingCounts.orders})`,
            'moderate_orders',
          ),
        ],
        [
          Markup.button.callback(
            `✈️ Рейсы (${pendingCounts.flights})`,
            'moderate_flights',
          ),
        ],
      ]),
    );
  }

  async sendOrderForModeration(
    orderId: number,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });
    if (!order) return;

    const message = `📦 *Новый заказ на модерации*
👤 *Заказчик:* ${order.user.lastName} (ID: ${order.userId})
📌 *Название:* ${order.name}
📑 *Тип:* ${this.getOrderTypeLabel(order.type)}
📜 *Описание:* ${order.description}
💰 *Стоимость:* ${order.price} ₽
🎁 *Вознаграждение:* ${order.reward} ₽
📅 *Доставка:* ${new Date(order.deliveryStart).toLocaleDateString()} – ${new Date(order.deliveryEnd).toLocaleDateString()}
📍 *Маршрут:* ${order.departure} → ${order.arrival}
🔄 *Статус:* ${this.getOrderStatusLabel(order.status)}`;

    await this.bot.telegram.sendMessage(
      this.moderatorChatId,
      message,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Подтвердить',
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

    if (order.mediaUrls.length > 0) {
      const media: (InputMediaPhoto | InputMediaVideo)[] = order.mediaUrls.map(
        (url) => ({
          type: url.endsWith('.mp4') ? 'video' : 'photo',
          media: url,
        }),
      );
      await this.bot.telegram.sendMediaGroup(this.moderatorChatId, media);
    }
  }

  async sendFlightForModeration(
    flightId: number,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const flight = await db.flight.findUnique({
      where: { id: flightId },
      include: { user: true },
    });
    if (!flight) return;

    const message = `✈️ *Новый рейс на модерации*
👤 Перевозчик: ${flight.user.lastName} (ID: ${flight.userId})
📍 Откуда: ${flight.departure}
📍 Куда: ${flight.arrival}
📅 Дата: ${new Date(flight.date).toLocaleString()}
💬 Описание: ${flight.description}
🔄 *Статус:* ${this.getFlightStatusLabel(flight.status)}`;

    await this.bot.telegram.sendMessage(
      this.moderatorChatId,
      message,
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

    if (flight.documentUrl) {
      await this.bot.telegram.sendDocument(
        this.moderatorChatId,
        flight.documentUrl,
      );
    }
  }

  async sendReviewForModeration(
    reviewId: number,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const review = await db.review.findUnique({
      where: { id: reviewId },
      include: { fromUser: true, toUser: true },
    });
    if (!review) return;

    const message = `📝 *Новый отзыв на модерации*
👤 От кого: ${review.fromUser.lastName} (ID: ${review.fromUserId})
👤 Кому: ${review.toUser.lastName} (ID: ${review.toUserId})
⭐ Оценка: ${review.rating}/5
💬 Комментарий: ${review.comment}`;

    await this.bot.telegram.sendMessage(
      this.moderatorChatId,
      message,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Подтвердить',
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

  private getTypeLabel(type: string): string {
    return type === 'order' ? 'Заказ' : type === 'flight' ? 'Рейс' : 'Отзыв';
  }

  private getOrderTypeLabel(type: string): string {
    return (
      {
        DOCUMENTS: '📄 Документы',
        STORE_PURCHASE: '🛍 Покупка из магазина',
        PERSONAL_ITEMS: '🎒 Личные вещи',
      }[type] || 'Неизвестный тип'
    );
  }

  private getOrderStatusLabel(status: string): string {
    return (
      {
        RAW: '🟡 Новый',
        PROCESSED_BY_CUSTOMER: '🟢 Выбран рейс',
        PROCESSED_BY_CARRIER: '🔵 Принят перевозчиком',
        CONFIRMED: '✅ Подтвержден',
      }[status] || 'Неизвестный статус'
    );
  }

  private getFlightStatusLabel(status: string): string {
    return (
      {
        PENDING: '🟡 Ожидает подтверждения',
        CONFIRMED: '🟢 Подтвержден',
        IN_PROGRESS: '🛫 В пути',
        ARRIVED: '🛬 Прилетел',
        COMPLETED: '✅ Завершен',
      }[status] || 'Неизвестный статус'
    );
  }
}
