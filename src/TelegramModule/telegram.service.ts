import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { ModerationService } from './moderation.service';
import { DbRegion, Order, Flight, Review, User } from '@prisma/client';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Telegraf;
  private readonly moderatorChatId: string;

  private readonly queues = {
    order: [] as (Order & { user: User })[],
    flight: [] as (Flight & { user: User })[],
    review: [] as (Review & { fromUser: User; toUser: User })[],
  };
  private readonly positions = new Map<
    number,
    { type: string; index: number }
  >();

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

    this.bot.action('moderate_orders', async (ctx) => {
      await this.loadQueue('order');
      await this.showNext(ctx.chat.id, 'order');
    });

    this.bot.action('moderate_flights', async (ctx) => {
      await this.loadQueue('flight');
      await this.showNext(ctx.chat.id, 'flight');
    });

    this.bot.action('moderate_reviews', async (ctx) => {
      await this.loadQueue('review');
      await this.showNext(ctx.chat.id, 'review');
    });

    this.bot.action(/^approve_(\w+)_([0-9]+)_(\w+)$/, async (ctx) => {
      const [, type, id, dbRegion] = ctx.match;
      await this.moderationService.approveItem(
        dbRegion as DbRegion,
        type,
        Number(id),
      );
      await ctx.deleteMessage();
      await this.showNext(ctx.chat.id, type);
    });

    this.bot.action(/^reject_(\w+)_([0-9]+)_(\w+)$/, async (ctx) => {
      const [, type, id, dbRegion] = ctx.match;
      await this.moderationService.rejectItem(
        dbRegion as DbRegion,
        type,
        Number(id),
      );
      await ctx.deleteMessage();
      await this.showNext(ctx.chat.id, type);
    });

    this.bot.action(/^prev_(\w+)$/, async (ctx) => {
      const [, type] = ctx.match;
      this.adjustIndex(ctx.chat.id, type, -1);
      await ctx.deleteMessage();
      await this.showCurrent(ctx.chat.id, type);
    });

    this.bot.action(/^next_(\w+)$/, async (ctx) => {
      const [, type] = ctx.match;
      this.adjustIndex(ctx.chat.id, type, 1);
      await ctx.deleteMessage();
      await this.showCurrent(ctx.chat.id, type);
    });

    this.bot.action('back_to_menu', async (ctx) => {
      await ctx.deleteMessage();
      await this.showMainMenu(ctx.chat.id);
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
    const chatId = Number(this.moderatorChatId);
    await this.bot.telegram.sendMessage(
      chatId,
      `🔔 Новый ${this.getTypeLabel(entityType)} ожидает модерации. Откройте меню.`,
    );

    if (entityType === 'order') {
      const order = await this.moderationService.findOrderById(dbRegion, id);
      if (order && order.user)
        await this.sendOrder(chatId, order, mediaBuffers);
    } else if (entityType === 'flight') {
      const flight = await this.moderationService.findFlightById(dbRegion, id);
      if (flight && flight.user) await this.sendFlight(chatId, flight);
    } else if (entityType === 'review') {
      const review = await this.moderationService.findReviewById(dbRegion, id);
      if (review && review.fromUser && review.toUser)
        await this.sendReview(chatId, review);
    }
  }

  private async sendOrder(
    chatId: number,
    order: Order & { user: User },
    mediaBuffers?: { buffer: Buffer; type: 'photo' | 'video' }[],
  ) {
    const caption = `📦 *Заказ #${order.id}*\n👤 ${order.user.firstName} ${order.user.lastName} (ID: ${order.userId})\n📌 ${order.name}\n📜 ${order.description}\n💰 ${order.price} ₽ | 🎁 ${order.reward} ₽\n📍 ${order.departure} → ${order.arrival}`;

    if (mediaBuffers?.length) {
      const file = mediaBuffers[0];
      if (file.type === 'video') {
        await this.bot.telegram.sendVideo(
          chatId,
          { source: file.buffer },
          {
            caption,
            parse_mode: 'Markdown',
            ...this.getNavigationButtons('order', order.id, order.dbRegion),
          },
        );
      } else {
        await this.bot.telegram.sendPhoto(
          chatId,
          { source: file.buffer },
          {
            caption,
            parse_mode: 'Markdown',
            ...this.getNavigationButtons('order', order.id, order.dbRegion),
          },
        );
      }
    } else if (order.mediaUrls?.length) {
      const media = order.mediaUrls[0];
      if (media.endsWith('.mp4') || media.endsWith('.webm')) {
        await this.bot.telegram.sendVideo(chatId, media, {
          caption,
          parse_mode: 'Markdown',
          ...this.getNavigationButtons('order', order.id, order.dbRegion),
        });
      } else {
        await this.bot.telegram.sendPhoto(chatId, media, {
          caption,
          parse_mode: 'Markdown',
          ...this.getNavigationButtons('order', order.id, order.dbRegion),
        });
      }
    } else {
      await this.bot.telegram.sendMessage(chatId, caption, {
        parse_mode: 'Markdown',
        ...this.getNavigationButtons('order', order.id, order.dbRegion),
      });
    }
  }

  private async loadQueue(type: 'order' | 'flight' | 'review') {
    if (type === 'order') {
      this.queues.order = await this.moderationService.getPendingOrders();
    } else if (type === 'flight') {
      this.queues.flight = await this.moderationService.getPendingFlights();
    } else {
      this.queues.review = await this.moderationService.getPendingReviews();
    }
  }

  private adjustIndex(chatId: number, type: string, delta: number) {
    const pos = this.positions.get(chatId) || { type, index: 0 };
    pos.index += delta;
    if (pos.index < 0) pos.index = 0;
    const list = this.queues[type];
    if (pos.index >= list.length) pos.index = list.length - 1;
    this.positions.set(chatId, pos);
  }

  private async showNext(chatId: number, type: string) {
    this.positions.set(chatId, { type, index: 0 });
    await this.showCurrent(chatId, type);
  }

  private async showCurrent(chatId: number, type: string) {
    const pos = this.positions.get(chatId);
    const list = this.queues[type];
    if (!pos || !list.length) {
      await this.bot.telegram.sendMessage(
        chatId,
        'Нет объектов для модерации.',
      );
      return;
    }
    const item = list[pos.index];
    if (type === 'order') await this.sendOrder(chatId, item);
    if (type === 'flight') await this.sendFlight(chatId, item);
    if (type === 'review') await this.sendReview(chatId, item);
  }

  private getNavigationButtons(type: string, id: number, dbRegion: DbRegion) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '✅ Подтвердить',
          `approve_${type}_${id}_${dbRegion}`,
        ),
        Markup.button.callback(
          '❌ Отклонить',
          `reject_${type}_${id}_${dbRegion}`,
        ),
      ],
      [
        Markup.button.callback('⬅️', `prev_${type}`),
        Markup.button.callback('➡️', `next_${type}`),
        Markup.button.callback('↩️ Меню', 'back_to_menu'),
      ],
    ]);
  }

  private async sendFlight(chatId: number, flight: Flight & { user: User }) {
    const caption = `✈️ *Рейс #${flight.id}*\n👤 ${flight.user.firstName} ${flight.user.lastName} (ID: ${flight.userId})\n📍 ${flight.departure} → ${flight.arrival}\n📅 ${new Date(flight.date).toLocaleString()}`;

    if (flight.documentUrl) {
      await this.bot.telegram.sendDocument(chatId, flight.documentUrl, {
        caption,
        parse_mode: 'Markdown',
        ...this.getNavigationButtons('flight', flight.id, flight.dbRegion),
      });
    } else {
      await this.bot.telegram.sendMessage(chatId, caption, {
        parse_mode: 'Markdown',
        ...this.getNavigationButtons('flight', flight.id, flight.dbRegion),
      });
    }
  }

  private async sendReview(
    chatId: number,
    review: Review & { fromUser: User; toUser: User },
  ) {
    const caption = `📝 *Отзыв*\n👤 От: ${review.fromUser.firstName} ${review.fromUser.lastName}\n👤 Кому: ${review.toUser.firstName} ${review.toUser.lastName}\n⭐ ${review.rating}/5\n💬 ${review.comment}`;

    await this.bot.telegram.sendMessage(chatId, caption, {
      parse_mode: 'Markdown',
      ...this.getNavigationButtons('review', review.id, review.dbRegion),
    });
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
