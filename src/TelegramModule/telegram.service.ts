import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup, Context } from 'telegraf';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { ModerationService } from './moderation.service';

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

    this.bot.action(
      /^approve_(flight|review|order)_(\d+)_(\w+)$/,
      async (ctx) => {
        const [, type, itemId, dbRegion] = ctx.match;
        this.logger.log(`Approving ${type} ${itemId} in ${dbRegion}`);
        await this.moderationService.approveItem(
          type,
          Number(itemId),
          dbRegion,
        );
        await ctx.editMessageText(
          `✅ ${type.toUpperCase()} ${itemId} подтвержден`,
          {
            parse_mode: 'Markdown',
          },
        );
      },
    );

    this.bot.action(
      /^reject_(flight|review|order)_(\d+)_(\w+)$/,
      async (ctx) => {
        const [, type, itemId, dbRegion] = ctx.match;
        this.logger.log(`Rejecting ${type} ${itemId} in ${dbRegion}`);
        await this.moderationService.rejectItem(type, Number(itemId), dbRegion);
        await ctx.editMessageText(
          `❌ ${type.toUpperCase()} ${itemId} отклонен`,
          {
            parse_mode: 'Markdown',
          },
        );
      },
    );

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
    const flight = await db.flight.findUnique({ where: { id: flightId } });
    if (!flight) return;

    const message = `✈️ *Новый рейс на модерации*\n📍 Откуда: ${flight.departure}\n📍 Куда: ${flight.arrival}\n📅 Дата: ${new Date(flight.date).toLocaleString()}`;
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
  }

  async sendOrderForModeration(
    orderId: number,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) return;

    const message = `📦 *Новый заказ на модерации*\n📜 Описание: ${order.description}\n💰 Стоимость: ${order.price} ₽\n🎁 Вознаграждение: ${order.reward} ₽`;
    await this.bot.telegram.sendMessage(this.moderatorChatId, message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Подтвердить',
            `approve_order_${order.id}_${dbRegion}`,
          ),
        ],
        [
          Markup.button.callback(
            '❌ Отклонить',
            `reject_order_${order.id}_${dbRegion}`,
          ),
        ],
      ]),
    });
  }

  async sendReviewForModeration(
    reviewId: number,
    dbRegion: string,
  ): Promise<void> {
    const db = this.prisma.getDatabase(dbRegion);
    const review = await db.review.findUnique({ where: { id: reviewId } });
    if (!review) return;

    const message = `📝 *Новый отзыв на модерации*\n⭐ Оценка: ${review.rating}/5\n💬 Комментарий: ${review.comment}`;
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
  }
}
