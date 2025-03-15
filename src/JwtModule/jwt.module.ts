import { Module, Logger } from '@nestjs/common';
import { JwtModule as NestJwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
    NestJwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const jwtSecret = configService.get<string>('JWT_SECRET');

        const logger = new Logger('JwtModule');
        logger.log(
          `🔑 JWT_SECRET (из ConfigService): ${jwtSecret || 'НЕ НАЙДЕН'}`,
        );

        if (!jwtSecret) {
          logger.error('❌ JWT_SECRET отсутствует в .env!');
          throw new Error('❌ JWT_SECRET отсутствует в .env!');
        }

        return {
          secret: jwtSecret, // 🔹 Проверяем, что `secret` передается
          signOptions: { expiresIn: '24h' },
        };
      },
      inject: [ConfigService],
    }),
  ],
  exports: [NestJwtModule],
})
export class JwtModule {}
