import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
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

    this.logger.log(`S3 Config Loaded:
      endpoint: ${endpoint},
      accessKeyId: ${accessKeyId?.slice(0, 4)}****,
      secretAccessKey: ${secretAccessKey ? '***hidden***' : 'not provided'},
      region: ${region},
      bucketName: ${bucketName}
    `);

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
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prismaService.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.userId !== user.id) throw new ForbiddenException('Нет доступа');

    const ext = path.extname(file.originalname).toLowerCase();
    const fileName = `${Date.now()}_${file.originalname}`;
    const key = `${user.dbRegion}/orders/${orderId}/${fileName}`;

    let buffer = file.buffer;

    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      buffer = await sharp(file.buffer).toFormat('webp').toBuffer();
    } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
      buffer = await this.convertVideoToWebm(file.path);
    }

    const url = await this.uploadToS3(buffer, key);

    await db.order.update({
      where: { id: orderId },
      data: {
        mediaUrls: { push: [url] },
      },
    });

    return url;
  }

  private async convertVideoToWebm(filePath: string): Promise<Buffer> {
    const outputPath = filePath.replace(path.extname(filePath), '.webm');
    const command = `ffmpeg -i ${filePath} -c:v libvpx -b:v 1M -c:a libvorbis ${outputPath}`;

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

  async getOrderMediaStream(
    authHeader: string,
    orderId: number,
    fileName: string,
  ): Promise<NodeJS.ReadableStream> {
    const user = await this.usersService.authenticate(authHeader);
    const db = this.prismaService.getDatabase(user.dbRegion);

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.userId !== user.id && order.carrierId !== user.id) {
      throw new ForbiddenException('Нет доступа к файлам этого заказа');
    }

    const key = `${user.dbRegion}/orders/${orderId}/${fileName}`;
    return this.s3
      .getObject({ Bucket: this.bucketName, Key: key })
      .createReadStream();
  }
}
