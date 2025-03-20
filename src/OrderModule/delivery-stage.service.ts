import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { RedisService } from 'src/RedisModule/redis.service';
import { EmailService } from 'src/MessageModule/email.service';
import { UsersService } from 'src/UserModule/users.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class DeliveryStageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly emailService: EmailService,
    private readonly usersService: UsersService,
  ) {}

  private generateConfirmationCode(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  async createConfirmationKey(
    authHeader: string,
    orderId: number,
    newStatus: string,
  ) {
    const confirmationCode = this.generateConfirmationCode();
    const key = `order:${orderId}:statusChange:${newStatus}`;

    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    await this.redisService.set(key, confirmationCode, 3600);

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new BadRequestException('Заказ не найден');
    }

    const userEmail = user.email;

    await this.emailService.sendVerificationEmail(userEmail, confirmationCode);

    return { message: 'Код подтверждения отправлен на почту' };
  }

  async confirmStageChange(
    authHeader: string,
    orderId: number,
    newStatus: OrderStatus,
    enteredCode: string,
  ) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const key = `order:${orderId}:statusChange:${newStatus}`;
    const storedCode = await this.redisService.get(key);

    if (storedCode !== enteredCode) {
      throw new BadRequestException('Неверный код подтверждения');
    }

    // Обновляем статус в базе данных
    await db.order.update({
      where: { id: orderId },
      data: { status: newStatus },
    });

    // Удаляем ключ из Redis после подтверждения
    await this.redisService.del(key);

    return { message: 'Статус успешно изменен' };
  }
}
