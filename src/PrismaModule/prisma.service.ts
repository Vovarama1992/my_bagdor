import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DbRegion, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private prismaPending: PrismaClient;
  private prismaRU: PrismaClient;
  private prismaOther: PrismaClient;

  constructor(private configService: ConfigService) {
    this.logger.log('Initializing Prisma clients...');

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

    this.logger.log(
      `DATABASE_URL_PENDING: ${this.configService.get<string>('DATABASE_URL_PENDING')}`,
    );
    this.logger.log(
      `DATABASE_URL_RU: ${this.configService.get<string>('DATABASE_URL_RU')}`,
    );
    this.logger.log(
      `DATABASE_URL_OTHER: ${this.configService.get<string>('DATABASE_URL_OTHER')}`,
    );
  }

  async onModuleInit() {
    this.logger.log('Connecting to databases...');
    await this.prismaPending.$connect();
    await this.prismaRU.$connect();
    await this.prismaOther.$connect();
    this.logger.log('Connected to all databases.');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from databases...');
    await this.prismaPending.$disconnect();
    await this.prismaRU.$disconnect();
    await this.prismaOther.$disconnect();
    this.logger.log('Disconnected from all databases.');
  }

  getDatabase(region: DbRegion): PrismaClient {
    this.logger.log(`Fetching database for region: ${region}`);
    if (region.toUpperCase() === 'RU') {
      return this.prismaRU;
    } else if (region.toUpperCase() === 'OTHER') {
      return this.prismaOther;
    }
    return this.prismaPending;
  }

  getUserModel(region: 'RU' | 'OTHER' | 'PENDING') {
    this.logger.log(`Fetching user model for region: ${region}`);
    if (region === 'PENDING') return this.prismaPending.user;
    if (region === 'RU') return this.prismaRU.user;
    return this.prismaOther.user;
  }
}
