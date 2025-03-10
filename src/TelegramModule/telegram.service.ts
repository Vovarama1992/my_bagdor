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
💬 Описание: ${flight.description}`;

    if (flight.documentUrl) {
      await this.bot.telegram.sendDocument(
        this.moderatorChatId,
        flight.documentUrl,
        { caption: message },
      );
    } else {
      await this.bot.telegram.sendMessage(this.moderatorChatId, message);
    }
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
  👤 Пользователь: ${order.user.lastName} (ID: ${order.userId})
  📜 Описание: ${order.description}
  💰 Стоимость: ${order.price ? `${order.price} ₽` : 'Не указано'}
  🎁 Вознаграждение: ${order.reward ? `${order.reward} ₽` : 'Не указано'}
  📅 Доставка: ${order.deliveryStart ? new Date(order.deliveryStart).toLocaleDateString() : 'Не указано'} – ${order.deliveryEnd ? new Date(order.deliveryEnd).toLocaleDateString() : 'Не указано'}
  📍 Маршрут: ${order.departure || 'Не указано'} → ${order.arrival || 'Не указано'}
  🔄 Статус: ${order.status}
  🚚 Доставлен: ${order.isDone ? 'Да' : 'Нет'}`;

    await this.bot.telegram.sendMessage(this.moderatorChatId, message);

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

    await this.bot.telegram.sendMessage(this.moderatorChatId, message);
  }
}
