import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Telegraf, Markup } from 'telegraf';
import { CronJob } from 'cron';

@Injectable()
export class PostureReminderService implements OnModuleInit {
  private readonly logger = new Logger(PostureReminderService.name);
  private readonly bot: Telegraf;
  private readonly userChatId = 6789440333;
  private postureResponses = { yes: 0, no: 0 };

  constructor() {
    const botToken = '7761692525:AAEvVhZya13'; // замени на свой токен

    this.bot = new Telegraf(botToken);

    this.bot.action('posture_yes', async (ctx) => {
      this.postureResponses.yes += 1;
      await ctx.answerCbQuery('Отлично! Держи спину ровно 👍');
      await ctx.deleteMessage();
    });

    this.bot.action('posture_no', async (ctx) => {
      this.postureResponses.no += 1;
      await ctx.answerCbQuery('Постарайся держать спину прямо!');
      await ctx.deleteMessage();
    });
  }

  onModuleInit() {
    this.bot.launch();

    const reminderJob = new CronJob(
      '0 10-23 * * *',
      this.sendReminder.bind(this),
      null,
      true,
      'Asia/Barnaul',
    );
    const summaryJob = new CronJob(
      '59 23 * * *',
      this.sendDailySummary.bind(this),
      null,
      true,
      'Asia/Barnaul',
    );

    reminderJob.start();
    summaryJob.start();

    this.logger.log('Posture Reminder Bot started');
  }

  private async sendReminder() {
    const question = 'Вова, ты держишь в текущем моменте спину прямо?';

    await this.bot.telegram.sendMessage(
      this.userChatId,
      question,
      Markup.inlineKeyboard([
        Markup.button.callback('✅ Да', 'posture_yes'),
        Markup.button.callback('❌ Нет', 'posture_no'),
      ]),
    );
  }

  private async sendDailySummary() {
    const total = this.postureResponses.yes + this.postureResponses.no;
    const message = `📊 Итоги дня:\n✅ Да: ${this.postureResponses.yes}\n❌ Нет: ${this.postureResponses.no}\n📌 Процент успеха: ${
      total ? ((this.postureResponses.yes / total) * 100).toFixed(1) : '0'
    }%`;

    await this.bot.telegram.sendMessage(this.userChatId, message);

    this.postureResponses = { yes: 0, no: 0 };
  }
}
