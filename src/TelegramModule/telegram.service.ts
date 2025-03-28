import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { ModerationService } from './moderation.service';
import { DbRegion, Flight, Order, Review, User } from '@prisma/client';
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
    private moderationService: ModerationService,
  ) {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.moderatorChatId = this.configService.get<string>('TELEGRAM_CHAT_ID');

    if (!botToken || !this.moderatorChatId) {
      this.logger.warn('Telegram bot credentials are missing');
      return;
    }

    this.bot = new Telegraf(botToken);

    this.bot.start(async (ctx) => {
      await this.showMainMenu(ctx.chat.id);
    });

    this.bot.action('moderate_orders', async () => {
      await this.showPendingOrders();
    });

    this.bot.action('moderate_flights', async () => {
      await this.showPendingFlights();
    });

    this.bot.action('moderate_reviews', async () => {
      await this.showPendingReviews();
    });

    this.bot.action(/^approve_(\w+)_(\d+)_(\w+)$/, async (ctx) => {
      const [, type, id, dbRegion] = ctx.match;
      await this.moderationService.approveItem(
        dbRegion as DbRegion,
        type,
        Number(id),
      );
      await ctx.answerCbQuery(
        `✅ ${this.getTypeLabel(type)} #${id} подтвержден`,
      );
      await ctx.deleteMessage();
    });

    this.bot.action(/^reject_(\w+)_(\d+)_(\w+)$/, async (ctx) => {
      const [, type, id, dbRegion] = ctx.match;
      await this.moderationService.rejectItem(
        dbRegion as DbRegion,
        type,
        Number(id),
      );
      await ctx.answerCbQuery(`❌ ${this.getTypeLabel(type)} #${id} отклонен`);
      await ctx.deleteMessage();
    });

    this.bot.launch();
  }

  private async showMainMenu(chatId: number | string) {
    const pending = await this.moderationService.getPendingCounts();
    await this.bot.telegram.sendMessage(
      chatId,
      '📌 Главное меню модерации',
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `📦 Заказы (${pending.orders})`,
            'moderate_orders',
          ),
        ],
        [
          Markup.button.callback(
            `✈️ Рейсы (${pending.flights})`,
            'moderate_flights',
          ),
        ],
        [
          Markup.button.callback(
            `📝 Отзывы (${pending.reviews})`,
            'moderate_reviews',
          ),
        ],
      ]),
    );
  }

  async delegateToModeration(
    entityType: 'order' | 'flight' | 'review',
    id: number,
    dbRegion: DbRegion,
    mediaBuffers?: { buffer: Buffer; type: 'photo' | 'video' }[],
  ) {
    const chatId = this.moderatorChatId;

    await this.bot.telegram.sendMessage(
      chatId,
      `🔔 Новый ${this.getTypeLabel(entityType)} ожидает модерации. Откройте меню.`,
    );

    if (entityType === 'order') {
      const order = await this.moderationService.findOrderById(dbRegion, id);
      if (order && order.user) await this.sendOrder(order, mediaBuffers);
    } else if (entityType === 'flight') {
      const flight = await this.moderationService.findFlightById(dbRegion, id);
      if (flight && flight.user) await this.sendFlight(flight);
    } else if (entityType === 'review') {
      const review = await this.moderationService.findReviewById(dbRegion, id);
      if (review && review.fromUser && review.toUser)
        await this.sendReview(review);
    }
  }

  private async showPendingOrders() {
    const orders = await this.moderationService.getPendingOrders();
    for (const order of orders) await this.sendOrder(order);
  }

  private async showPendingFlights() {
    const flights = await this.moderationService.getPendingFlights();
    for (const flight of flights) await this.sendFlight(flight);
  }

  private async showPendingReviews() {
    const reviews = await this.moderationService.getPendingReviews();
    for (const review of reviews) await this.sendReview(review);
  }

  private async sendOrder(
    order: Order & { user: User },
    mediaBuffers?: { buffer: Buffer; type: 'photo' | 'video' }[],
  ) {
    const caption = `📦 *Новый заказ на модерации*
  🆔 ID: ${order.id}
  👤 ${order.user.firstName} ${order.user.lastName} (ID: ${order.userId})
  📌 ${order.name}
  📜 ${order.description}
  💰 ${order.price} ₽
  🎁 ${order.reward} ₽
  📍 ${order.departure} → ${order.arrival}`;

    if (mediaBuffers?.length) {
      await this.sendOrderMediaDirectly(
        this.moderatorChatId,
        caption,
        mediaBuffers,
      );
    } else if (order.mediaUrls?.length) {
      // Это fallback вариант, если нет буферов, отправляем по ссылке (фото)
      const media = order.mediaUrls.map((url, i) =>
        url.endsWith('.mp4') || url.endsWith('.webm')
          ? ({
              type: 'video',
              media: url,
              caption: i === 0 ? caption : undefined,
            } as InputMediaVideo)
          : ({
              type: 'photo',
              media: url,
              caption: i === 0 ? caption : undefined,
            } as InputMediaPhoto),
      );

      await this.bot.telegram.sendMediaGroup(this.moderatorChatId, media);
    } else {
      await this.bot.telegram.sendMessage(this.moderatorChatId, caption, {
        parse_mode: 'Markdown',
      });
    }

    await this.sendModerationActions('order', order.id, order.dbRegion);
  }

  async sendOrderMediaDirectly(
    chatId: string,
    caption: string,
    buffers: { buffer: Buffer; type: 'photo' | 'video' }[],
  ) {
    const media = buffers.map((file, i) => {
      if (file.type === 'photo') {
        return {
          type: 'photo',
          media: { source: file.buffer },
          caption: i === 0 ? caption : undefined,
          parse_mode: 'Markdown',
        } as InputMediaPhoto;
      } else {
        return {
          type: 'video',
          media: { source: file.buffer },
          caption: i === 0 ? caption : undefined,
          parse_mode: 'Markdown',
        } as InputMediaVideo;
      }
    });

    await this.bot.telegram.sendMediaGroup(chatId, media);
  }

  private async sendFlight(flight: Flight & { user: User }) {
    const caption = `✈️ *Новый рейс на модерации*
🆔 ID: ${flight.id}
👤 ${flight.user.firstName} ${flight.user.lastName} (ID: ${flight.userId})
📍 ${flight.departure} → ${flight.arrival}
📅 ${new Date(flight.date).toLocaleString()}`;

    if (flight.documentUrl) {
      await this.bot.telegram.sendDocument(
        this.moderatorChatId,
        flight.documentUrl,
        {
          caption,
          parse_mode: 'Markdown',
        },
      );
    } else {
      await this.bot.telegram.sendMessage(this.moderatorChatId, caption, {
        parse_mode: 'Markdown',
      });
    }

    await this.sendModerationActions('flight', flight.id, flight.dbRegion);
  }

  private async sendReview(review: Review & { fromUser: User; toUser: User }) {
    const caption = `📝 *Новый отзыв*
👤 От: ${review.fromUser.firstName} ${review.fromUser.lastName}
👤 Кому: ${review.toUser.firstName} ${review.toUser.lastName}
⭐ ${review.rating}/5
💬 ${review.comment}`;

    await this.bot.telegram.sendMessage(this.moderatorChatId, caption, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Опубликовать',
            `approve_review_${review.id}_${review.dbRegion}`,
          ),
          Markup.button.callback(
            '❌ Отклонить',
            `reject_review_${review.id}_${review.dbRegion}`,
          ),
        ],
      ]),
    });
  }

  private async sendModerationActions(
    type: string,
    id: number,
    dbRegion: DbRegion,
  ) {
    await this.bot.telegram.sendMessage(
      this.moderatorChatId,
      'Выберите действие:',
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `✅ Подтвердить`,
            `approve_${type}_${id}_${dbRegion}`,
          ),
          Markup.button.callback(
            `❌ Отклонить`,
            `reject_${type}_${id}_${dbRegion}`,
          ),
        ],
      ]),
    );
  }

  private getTypeLabel(type: string) {
    return (
      {
        order: 'Заказ',
        flight: 'Рейс',
        review: 'Отзыв',
      }[type] ?? 'Объект'
    );
  }
}
