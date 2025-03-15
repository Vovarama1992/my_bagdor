import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup, Context } from 'telegraf';
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
  private ctx: Context;

  constructor(
    private configService: ConfigService,
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
      this.ctx = ctx;
      await this.showMainMenu(this.ctx);
    });

    this.bot.action('moderate_reviews', async () => {
      await this.showPendingReviews();
    });

    this.bot.action('moderate_orders', async () => {
      await this.showPendingOrders();
    });

    this.bot.action('moderate_flights', async () => {
      await this.showPendingFlights();
    });

    this.bot.action(/^approve_(\w+)_(\d+)_(\w+)$/, async (ctx) => {
      const [, type, id, dbRegion] = ctx.match;

      await this.moderationService.approveItem(
        dbRegion as DbRegion,
        type,
        parseInt(id),
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
        parseInt(id),
      );

      await ctx.answerCbQuery(`❌ ${this.getTypeLabel(type)} #${id} отклонен`);
      await ctx.deleteMessage();
    });

    this.bot.launch();
  }

  private async showMainMenu(ctx: Context) {
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

  // Метод для делегирования сущности на модерацию
  async delegateToModeration(
    entityType: 'order' | 'flight' | 'review',
    id: number,
    dbRegion: DbRegion,
  ) {
    let entity;

    // В зависимости от типа сущности, получаем данные
    if (entityType === 'order') {
      entity = await this.moderationService.findOrderById(dbRegion, id);
      if (!entity || !entity.user) {
        this.logger.warn(`Order ${id} not found or user is missing`);
        return;
      }
      await this.sendOrderForModeration(entity);
    } else if (entityType === 'flight') {
      entity = await this.moderationService.findFlightById(dbRegion, id);
      if (!entity || !entity.user) {
        this.logger.warn(`Flight ${id} not found or user is missing`);
        return;
      }
      await this.sendFlightForModeration(entity);
    } else if (entityType === 'review') {
      entity = await this.moderationService.findReviewById(dbRegion, id);
      if (!entity || !entity.fromUser || !entity.toUser) {
        this.logger.warn(`Review ${id} not found or user data is missing`);
        return;
      }
      await this.sendReviewForModeration(entity);
    }
  }

  async showPendingOrders() {
    const orders = await this.moderationService.getPendingOrders();
    for (const order of orders) {
      await this.sendOrderForModeration(order); // передаем ctx
    }
  }

  async showPendingFlights() {
    const flights = await this.moderationService.getPendingFlights();
    for (const flight of flights) {
      await this.sendFlightForModeration(flight); // передаем ctx
    }
  }

  async showPendingReviews() {
    const reviews = await this.moderationService.getPendingReviews();
    for (const review of reviews) {
      await this.sendReviewForModeration(review); // передаем ctx
    }
  }

  private async sendOrderForModeration(order: Order & { user: User }) {
    const message = `📦 *Новый заказ на модерации*
  🆔 *ID заказа:* ${order.id}
  👤 *Заказчик:* ${order.user.firstName} ${order.user.lastName} (ID: ${order.userId})
  📌 *Название:* ${order.name}
  📜 *Описание:* ${order.description}
  💰 *Стоимость:* ${order.price} ₽
  🎁 *Вознаграждение:* ${order.reward} ₽
  📅 *Доставка:* ${new Date(order.deliveryStart).toLocaleDateString()} – ${new Date(order.deliveryEnd).toLocaleDateString()}
  📍 *Маршрут:* ${order.departure} → ${order.arrival}`;

    if (order.mediaUrls?.length > 0) {
      const mediaGroup: (InputMediaPhoto | InputMediaVideo)[] =
        order.mediaUrls.map((url, index) => {
          if (url.endsWith('.mp4')) {
            return {
              type: 'video',
              media: url,
              caption: index === 0 ? message : undefined,
            } as InputMediaVideo;
          } else {
            return {
              type: 'photo',
              media: url,
              caption: index === 0 ? message : undefined,
            } as InputMediaPhoto;
          }
        });

      await this.bot.telegram.sendMediaGroup(this.moderatorChatId, mediaGroup);
    } else {
      await this.bot.telegram.sendMessage(this.moderatorChatId, message);
    }

    await this.bot.telegram.sendMessage(
      this.moderatorChatId,
      'Выберите действие:',
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Подтвердить',
            `approve_order_${order.id}_${order.dbRegion}`,
          ),
        ],
        [
          Markup.button.callback(
            '❌ Отклонить',
            `reject_order_${order.id}_${order.dbRegion}`,
          ),
        ],
      ]),
    );
  }

  private async sendFlightForModeration(flight: Flight & { user: User }) {
    const message = `✈️ *Новый рейс на модерации*
  🆔 *ID рейса:* ${flight.id}
  👤 *Перевозчик:* ${flight.user.firstName} ${flight.user.lastName} (ID: ${flight.userId})
  📍 *Маршрут:* ${flight.departure} → ${flight.arrival}
  📅 *Дата:* ${new Date(flight.date).toLocaleString()}
  `;

    if (flight.documentUrl) {
      await this.bot.telegram.sendDocument(
        this.moderatorChatId,
        flight.documentUrl,
        { caption: message }, // Прикрепляем файл к сообщению
      );
    } else {
      await this.bot.telegram.sendMessage(this.moderatorChatId, message);
    }

    await this.bot.telegram.sendMessage(
      this.moderatorChatId,
      'Выберите действие:',
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Подтвердить',
            `approve_flight_${flight.id}_${flight.dbRegion}`,
          ),
        ],
        [
          Markup.button.callback(
            '❌ Отклонить',
            `reject_flight_${flight.id}_${flight.dbRegion}`,
          ),
        ],
      ]),
    );
  }

  private async sendReviewForModeration(
    review: Review & { fromUser: User } & { toUser: User },
  ) {
    const message = `📝 *Новый отзыв на модерации*
  👤 *От кого:* ${review.fromUser.firstName} ${review.fromUser.lastName} (ID: ${review.fromUserId})
  👤 *Кому:* ${review.toUser.firstName} ${review.toUser.lastName} (ID: ${review.toUserId})
  ⭐ *Оценка:* ${review.rating}/5
  💬 *Комментарий:* ${review.comment}`;

    await this.bot.telegram.sendMessage(
      this.moderatorChatId,
      message,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Опубликовать',
            `approve_review_${review.id}_${review.dbRegion}`,
          ),
        ],
        [
          Markup.button.callback(
            '❌ Отклонить',
            `reject_review_${review.id}_${review.dbRegion}`,
          ),
        ],
      ]),
    );
  }

  private async sendMedia(mediaUrls: string[]) {
    const mediaGroup: (InputMediaPhoto | InputMediaVideo)[] = mediaUrls.map(
      (url) => {
        if (url.endsWith('.mp4')) {
          return { type: 'video', media: url };
        } else {
          return { type: 'photo', media: url };
        }
      },
    );

    await this.bot.telegram.sendMediaGroup(this.moderatorChatId, mediaGroup);
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
}
