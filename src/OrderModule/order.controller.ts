import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  Headers,
  Get,
  Delete,
  Res,
  BadRequestException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto, AcceptOrderDto } from './dto/order.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';

const MEDIA_STORAGE_PATH = path.join(process.cwd(), 'storage', 'order_media');

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @ApiOperation({ summary: 'Создать заказ' })
  @ApiResponse({
    status: 201,
    description: 'Заказ создан',
  })
  @ApiBody({ type: CreateOrderDto })
  @Post()
  async createOrder(
    @Headers('authorization') authHeader: string,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.orderService.createOrder(authHeader, createOrderDto);
  }

  @ApiOperation({ summary: 'Загрузить медиафайлы для заказа' })
  @ApiParam({ name: 'orderId', example: 1, description: 'ID заказа' })
  @ApiResponse({ status: 200, description: 'Файлы загружены' })
  @Post(':orderId/upload-media')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const orderId = req.params.orderId;
          const orderPath = path.join(MEDIA_STORAGE_PATH, `order_${orderId}`);

          if (!fs.existsSync(orderPath)) {
            fs.mkdirSync(orderPath, { recursive: true });
          }

          cb(null, orderPath);
        },
        filename: (req, file, cb) => {
          const orderId = req.params.orderId;
          const timestamp = Date.now();
          const random = Math.round(Math.random() * 1e9);
          const extension = path.extname(file.originalname);
          cb(null, `order_${orderId}_${timestamp}_${random}${extension}`);
        },
      }),
    }),
  )
  @ApiOperation({ summary: 'Обновить заказ (добавить flightId)' })
  @ApiParam({ name: 'orderId', example: 1, description: 'ID заказа' })
  @ApiResponse({ status: 200, description: 'Заказ обновлён' })
  @Patch(':orderId')
  async updateOrder(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
    @Body() updateData: { flightId: number },
  ) {
    return this.orderService.updateOrder(
      authHeader,
      Number(orderId),
      updateData,
    );
  }

  async uploadMedia(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Файлы не загружены');
    }

    return this.orderService.uploadMedia(
      authHeader,
      orderId,
      files.map((file) => file.filename),
    );
  }

  @ApiOperation({ summary: 'Получить медиафайл заказа' })
  @ApiParam({ name: 'orderId', example: 1, description: 'ID заказа' })
  @ApiParam({
    name: 'fileName',
    example: 'order_1_12345678.jpg',
    description: 'Имя файла',
  })
  @ApiResponse({ status: 200, description: 'Медиафайл отправлен' })
  @Get(':orderId/media/:fileName')
  async getMedia(
    @Param('orderId') orderId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const orderPath = path.join(MEDIA_STORAGE_PATH, `order_${orderId}`);
    const filePath = path.join(orderPath, fileName);

    if (!fs.existsSync(filePath)) {
      throw new BadRequestException('Файл не найден');
    }

    return res.sendFile(filePath);
  }

  @ApiOperation({ summary: 'Подтвердить заказ' })
  @ApiParam({ name: 'orderId', example: 1, description: 'ID заказа' })
  @ApiResponse({
    status: 200,
    description: 'Заказ подтвержден',
  })
  @ApiBody({ type: AcceptOrderDto })
  @Patch(':orderId/accept')
  async acceptOrder(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
    @Body() acceptOrderDto: AcceptOrderDto,
  ) {
    return this.orderService.acceptOrder(authHeader, orderId, acceptOrderDto);
  }

  @ApiOperation({
    summary: 'Получить заказы, ожидающие подтверждения заказчиком',
  })
  @ApiResponse({
    status: 200,
    description: 'Список заказов со статусом PROCESSED_BY_CARRIER',
  })
  @Get('customer/pending')
  async getOrdersForCustomer(@Headers('authorization') authHeader: string) {
    return this.orderService.getOrdersForCustomer(authHeader);
  }

  @ApiOperation({
    summary: 'Получить заказы, ожидающие подтверждения перевозчиком',
  })
  @ApiResponse({
    status: 200,
    description: 'Список заказов со статусом PROCESSED_BY_CUSTOMER',
  })
  @Get('carrier/pending')
  async getOrdersForCarrier(@Headers('authorization') authHeader: string) {
    return this.orderService.getOrdersForCarrier(authHeader);
  }

  @ApiOperation({ summary: 'Отметить заказ как доставленный' })
  @ApiParam({ name: 'orderId', example: '25', description: 'ID заказа' })
  @ApiResponse({
    status: 200,
    description:
      'Заказ отмечен как доставленный. Если это последний заказ, рейс завершён.',
  })
  @Patch(':orderId/delivered')
  async markOrderDelivered(
    @Param('orderId') orderId: string,
    @Headers('authorization') authHeader: string,
  ) {
    return this.orderService.markOrderAsDelivered(authHeader, orderId);
  }

  @ApiOperation({ summary: 'Получить список немодерированных заказов' })
  @ApiResponse({ status: 200, description: 'Список заказов без модерации' })
  @Get('pending-moderation')
  async getUnmoderatedOrders(@Headers('authorization') authHeader: string) {
    return this.orderService.getUnmoderatedOrders(authHeader);
  }

  @ApiOperation({ summary: 'Подтвердить заказ (модерация)' })
  @ApiParam({ name: 'orderId', example: 1, description: 'ID заказа' })
  @ApiResponse({ status: 200, description: 'Заказ подтвержден' })
  @Patch(':orderId/approve')
  async approveOrderModeration(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
  ) {
    return this.orderService.approveOrderModeration(authHeader, orderId);
  }

  @ApiOperation({ summary: 'Отклонить заказ (модерация)' })
  @ApiParam({ name: 'orderId', example: 1, description: 'ID заказа' })
  @ApiResponse({ status: 200, description: 'Заказ удален' })
  @Delete(':orderId/reject')
  async rejectOrderModeration(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
  ) {
    return this.orderService.rejectOrderModeration(authHeader, orderId);
  }
}
