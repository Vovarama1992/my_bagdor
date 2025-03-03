import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private prismaPending: PrismaClient;
  private prismaRU: PrismaClient;
  private prismaOther: PrismaClient;

  constructor(private configService: ConfigService) {
    this.prismaPending = new PrismaClient({
      datasources: {
        db: { url: this.configService.get<string>('DATABASE_URL_PENDING') },
      },
    });

    this.prismaRU = new PrismaClient({
      datasources: {
        db: { url: this.configService.get<string>('DATABASE_URL_RU') },
      },
    });

    this.prismaOther = new PrismaClient({
      datasources: {
        db: { url: this.configService.get<string>('DATABASE_URL_OTHER') },
      },
    });
  }

  async onModuleInit() {
    await this.prismaPending.$connect();
    await this.prismaRU.$connect();
    await this.prismaOther.$connect();
  }

  async onModuleDestroy() {
    await this.prismaPending.$disconnect();
    await this.prismaRU.$disconnect();
    await this.prismaOther.$disconnect();
  }

  getDatabase(region: string): PrismaClient {
    if (region.toUpperCase() === 'RU') {
      return this.prismaRU;
    } else if (region) {
      return this.prismaOther;
    }
    return this.prismaPending;
  }
  getUserModel(region: 'RU' | 'OTHER' | 'PENDING') {
    if (region === 'PENDING') return this.prismaPending.user;
    if (region === 'RU') return this.prismaRU.user;
    return this.prismaOther.user;
  }
}
