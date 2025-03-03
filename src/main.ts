import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const isIOS = req.headers['x-client-type'] === 'iOS';
    const origin = req.headers.origin;

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, Authorization, X-Client-Type',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (isIOS && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (
      ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin)
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  app.setGlobalPrefix('api');

  console.log('Приложение запущено. Версия: 1.0.0');

  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('The API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/api/docs', app, document);

  await app.listen(3001);
}
bootstrap();
