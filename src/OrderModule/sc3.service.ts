import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
  HttpException,
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

  async processAndUpload(
    authHeader: string,
    orderId: number,
    file: Express.Multer.File,
  ): Promise<string> {
    try {
      this.logger.log(
        `Загрузка файла ${file.originalname} для заказа #${orderId}`,
      );

      const user = await this.usersService.authenticate(authHeader);
      const db = this.prismaService.getDatabase(user.dbRegion);

      const order = await db.order.findUnique({ where: { id: orderId } });
      if (!order) {
        this.logger.warn(`Заказ #${orderId} не найден`);
        throw new NotFoundException('Заказ не найден');
      }

      if (order.userId !== user.id) {
        this.logger.warn(
          `Пользователь ${user.id} не имеет доступа к заказу #${orderId}`,
        );
        throw new ForbiddenException('Нет доступа');
      }

      const ext = path.extname(file.originalname).toLowerCase();
      this.logger.log(`Расширение файла: ${ext}`);

      const baseName = path.basename(file.originalname, ext);
      const finalExt = ['.jpg', '.jpeg', '.png'].includes(ext)
        ? '.webp'
        : ['.mp4', '.mov', '.avi'].includes(ext)
          ? '.webm'
          : ext;

      const fileName = `${Date.now()}_${baseName}${finalExt}`;
      const key = `${user.dbRegion}/orders/${orderId}/${fileName}`;

      this.logger.log(`Итоговый путь (key): ${key}`);

      let buffer = file.buffer;

      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        this.logger.log(
          'Обработка изображения с ресайзом до 1200px и конвертацией в WEBP',
        );
        const metadata = await sharp(file.buffer).metadata();
        const resizeOptions =
          metadata.width >= metadata.height
            ? { width: 1200 }
            : { height: 1200 };

        buffer = await sharp(file.buffer)
          .resize(resizeOptions)
          .toFormat('webp')
          .toBuffer();
      } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
        this.logger.log('Обработка видео с ресайзом и fps=30');
        buffer = await this.convertVideoToWebm(file.path);
      }

      const url = await this.uploadToS3(buffer, key);
      this.logger.log(`Файл загружен в S3: ${url}`);

      await db.order.update({
        where: { id: orderId },
        data: {
          mediaUrls: { push: [url] },
        },
      });

      this.logger.log(`URL добавлен в order.mediaUrls`);

      return url;
    } catch (error) {
      this.logger.error(
        `Ошибка при загрузке файла ${file.originalname} для заказа #${orderId}`,
        error.stack,
      );
      this.handleException(error);
    }
  }

  private async convertVideoToWebm(filePath: string): Promise<Buffer> {
    const outputPath = filePath.replace(path.extname(filePath), '.webm');

    const probeCommand = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 ${filePath}`;
    const { stdout } = await execPromise(probeCommand);
    const [widthStr, heightStr] = stdout.trim().split(',');
    const width = parseInt(widthStr, 10);
    const height = parseInt(heightStr, 10);
    const maxSize = 1200;

    let scaleOption = '';
    if (width >= height) {
      scaleOption = `scale=${maxSize}:-2`; // ширина фикс, высота пропорционально
    } else {
      scaleOption = `scale=-2:${maxSize}`; // высота фикс, ширина пропорционально
    }

    const command = `ffmpeg -i ${filePath} -vf "${scaleOption},fps=30" -c:v libvpx -b:v 1M -c:a libvorbis ${outputPath}`;
    await execPromise(command);

    const buffer = await fs.readFile(outputPath);
    await fs.unlink(outputPath);
    return buffer;
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
            const key =
              url.split(`/${this.bucketName}/`)[1] ?? url.split('.com/')[1];

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
