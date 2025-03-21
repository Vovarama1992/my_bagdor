import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DbRegion } from '@prisma/client';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { UsersService } from 'src/UserModule/users.service';

@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async openDispute(authHeader: string, orderId: number) {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prisma.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    const isParticipant =
      user.id === order.userId || user.id === order.carrierId;
    if (!isParticipant) {
      throw new ForbiddenException('Вы не участник этого заказа');
    }

    await db.order.update({
      where: { id: orderId },
      data: { disputeStatus: 'OPEN' },
    });

    return { message: 'Спор открыт' };
  }

  async closeDispute(orderId: number, dbRegion: DbRegion, result?: string) {
    const db = this.prisma.getDatabase(dbRegion);

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    await db.order.update({
      where: { id: orderId },
      data: {
        disputeStatus: 'RESOLVED',
        disputeResult: result ?? null,
      },
    });

    return { message: 'Спор закрыт' };
  }
}
