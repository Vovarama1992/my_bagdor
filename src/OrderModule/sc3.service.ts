import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { S3 } from 'aws-sdk';
import * as sharp from 'sharp';
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';
import * as fs from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/UserModule/users.service';
import { PrismaService } from 'src/PrismaModule/prisma.service';
import { TelegramService } from 'src/TelegramModule/telegram.service';

const execPromise = util.promisify(exec);

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private s3: S3;
  private bucketName: string;
  private endpoint: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly prismaService: PrismaService,
    private readonly telegramService: TelegramService,
  ) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('S3_SECRET_KEY');
    const region = this.configService.get<string>('S3_REGION');
    const bucketName = this.configService.get<string>('S3_BUCKET_NAME');

    this.s3 = new S3({
      endpoint,
      accessKeyId,
      secretAccessKey,
      region,
    });

    this.bucketName = bucketName;
    this.endpoint = endpoint;
  }

  async processAndUploadPhoto(
    authHeader: string,
    orderId: number,
    file: Express.Multer.File,
  ): Promise<string> {
    return this.processAndUploadGeneral(authHeader, orderId, file, 'photo');
  }

  async processAndUploadVideo(
    authHeader: string,
    orderId: number,
    file: Express.Multer.File,
  ): Promise<string> {
    return this.processAndUploadGeneral(authHeader, orderId, file, 'video');
  }

  private async processAndUploadGeneral(
    authHeader: string,
    orderId: number,
    file: Express.Multer.File,
    type: 'photo' | 'video',
  ): Promise<string> {
    try {
      const user = await this.usersService.authenticate(authHeader);
      const db = this.prismaService.getDatabase(user.dbRegion);
      const order = await db.order.findUnique({ where: { id: orderId } });
      if (order.type === 'STORE_PURCHASE' && type === 'video') {
        throw new BadRequestException(
          'Для заказов из магазина видео недоступно',
        );
      }

      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.userId !== user.id) throw new ForbiddenException('Нет доступа');

      const ext = path.extname(file.originalname).toLowerCase();
      const baseName = path.basename(file.originalname, ext);
      const finalExt = type === 'photo' ? '.webp' : '.mp4';
      const fileName = `${Date.now()}_${baseName}${finalExt}`;
      const key = `${user.dbRegion}/orders/${orderId}/${fileName}`;

      let buffer: Buffer;

      if (type === 'photo') {
        const metadata = await sharp(file.buffer).metadata();
        const resizeOptions =
          metadata.width >= metadata.height
            ? { width: 1200 }
            : { height: 1200 };

        buffer = await sharp(file.buffer)
          .resize(resizeOptions)
          .toFormat('webp')
          .toBuffer();
      } else if (type === 'video') {
        const tmpPath = `/tmp/${Date.now()}_${file.originalname}`;
        await fs.writeFile(tmpPath, file.buffer);
        buffer = await this.convertVideoToMp4(tmpPath);
        await fs.unlink(tmpPath);
      } else {
        buffer = file.buffer;
      }

      const cleanedEndpoint = this.endpoint.replace(/^https?:\/\//, '');
      const url = `https://${this.bucketName}.${cleanedEndpoint}/${key}`;

      await this.uploadToS3(buffer, key);

      await db.order.update({
        where: { id: orderId },
        data: {
          mediaUrls: { push: [url] },
        },
      });

      const isStore = order.type === 'STORE_PURCHASE';
      const isUnmoderated = order.moderationStatus === 'PENDING';

      const shouldTrigger =
        !isUnmoderated &&
        ((isStore && type === 'photo') || (!isStore && type === 'video'));

      if (shouldTrigger) {
        if (type === 'video') {
          // видео отправляем через буфер
          await this.telegramService.delegateToModeration(
            'order',
            order.id,
            user.dbRegion,
            [{ buffer, type: 'video' }],
          );
        } else {
          // фото отправляем ссылкой, без буфера
          await this.telegramService.delegateToModeration(
            'order',
            order.id,
            user.dbRegion,
          );
        }
      }

      return url;
    } catch (error) {
      this.logger.error(
        `Ошибка при загрузке файла ${file.originalname} для заказа #${orderId}`,
        error.stack,
      );
      this.handleException(error);
    }
  }
  private async convertVideoToMp4(filePath: string): Promise<Buffer> {
    try {
      if (!filePath) throw new Error('filePath is undefined');

      const outputPath = filePath.replace(path.extname(filePath), '.mp4');

      const command = `ffmpeg -i "${filePath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;

      this.logger.log(`FFmpeg command: ${command}`);

      await execPromise(command);

      const buffer = await fs.readFile(outputPath);
      await fs.unlink(outputPath);
      return buffer;
    } catch (err) {
      this.logger.error('Ошибка в convertVideoToMp4', err.stack);
      throw err;
    }
  }

  private async uploadToS3(buffer: Buffer, key: string): Promise<string> {
    await this.s3
      .upload({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ACL: 'public-read',
        ContentType: this.getContentType(key),
      })
      .promise();

    return `https://${this.bucketName}.${this.endpoint}/${key}`;
  }

  private getContentType(key: string): string {
    const ext = path.extname(key).toLowerCase();
    return ext === '.webp'
      ? 'image/webp'
      : ext === '.webm'
        ? 'video/webm'
        : 'application/octet-stream';
  }

  async getOrderMediaFiles(
    authHeader: string,
    orderId: number,
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }[]> {
    try {
      this.logger.log(`Получение медиафайлов для заказа #${orderId}`);

      const user = await this.usersService.authenticate(authHeader);
      const db = this.prismaService.getDatabase(user.dbRegion);

      const order = await db.order.findUnique({ where: { id: orderId } });
      if (!order) {
        this.logger.warn(`Заказ #${orderId} не найден`);
        throw new NotFoundException('Заказ не найден');
      }

      if (order.userId !== user.id && order.carrierId !== user.id) {
        this.logger.warn(
          `Пользователь ${user.id} не имеет доступа к заказу #${orderId}`,
        );
        throw new ForbiddenException('Нет доступа к файлам этого заказа');
      }

      const files = await Promise.all(
        (order.mediaUrls ?? []).map(async (url) => {
          try {
            const key = url.replace(/^https?:\/\/[^/]+\//, '');

            this.logger.log(`Загрузка файла из S3: ${key}`);

            const { Body, ContentType } = await this.s3
              .getObject({ Bucket: this.bucketName, Key: key })
              .promise();

            return {
              buffer: Body as Buffer,
              contentType: ContentType || 'application/octet-stream',
              fileName: key.split('/').pop()!,
            };
          } catch (err) {
            this.logger.error(
              `Ошибка при получении файла из S3: ${url}`,
              err.stack,
            );
            throw err;
          }
        }),
      );

      this.logger.log(`Медиафайлы для заказа #${orderId} успешно получены`);
      return files;
    } catch (error) {
      this.logger.error(
        `Ошибка при получении медиафайлов заказа #${orderId}`,
        error.stack,
      );
      this.handleException(error);
    }
  }

  handleException(error: any) {
    const status = error?.status || 500;
    throw new HttpException(
      {
        code: status,
        status: 'error',
        stack: error.stack || 'no stack trace',
      },
      status,
    );
  }
}
