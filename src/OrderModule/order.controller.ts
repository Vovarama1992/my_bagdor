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
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/order.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';
import { ResponseService } from './response.service';
import { DisputeService } from './dispute.service';
import { DbRegion } from '@prisma/client';
import { AdminGuard } from 'guards/admin.guard';

const MEDIA_STORAGE_PATH = path.join(process.cwd(), 'storage', 'order_media');

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly responseService: ResponseService,
    private readonly disputeService: DisputeService,
  ) {}

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
  @Patch(':orderId/attach-to-flight')
  @ApiOperation({ summary: 'Добавить заказ к рейсу' })
  @ApiParam({ name: 'orderId', example: 1 })
  @ApiBody({ schema: { example: { flightId: 42 } } })
  @ApiResponse({ status: 200, description: 'Заказ привязан к рейсу' })
  async attachOrderToFlight(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
    @Body() updateData: { flightId: number },
  ) {
    return this.orderService.attachOrderToFlight(
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

  @ApiOperation({ summary: 'Перевозчик оставляет отклик на заказ' })
  @Post(':orderId/response')
  async createResponse(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: number,
    @Body() dto: { flightId: number; message?: string; priceOffer?: number },
  ) {
    return this.responseService.createResponse(
      authHeader,
      orderId,
      dto.flightId,
      dto.message,
      dto.priceOffer,
    );
  }

  @ApiOperation({ summary: 'Заказчик принимает отклик' })
  @Post('responses/:responseId/accept')
  async acceptResponse(
    @Headers('authorization') authHeader: string,
    @Param('responseId') responseId: number,
  ) {
    return this.responseService.acceptResponse(authHeader, responseId);
  }

  @ApiOperation({ summary: 'Перевозчик принимает предложение заказчика' })
  @Patch(':orderId/accept-customer-order')
  async acceptCustomerOrder(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: number,
  ) {
    return this.orderService.acceptOrderByCarrier(authHeader, orderId);
  }

  @ApiOperation({ summary: 'Заказчик отклоняет отклик' })
  @Delete('responses/:responseId/reject')
  async rejectResponse(
    @Headers('authorization') authHeader: string,
    @Param('responseId') responseId: number,
  ) {
    return this.responseService.rejectResponse(authHeader, responseId);
  }

  @ApiOperation({ summary: 'Получить отклики на заказ' })
  @ApiParam({ name: 'orderId', example: 42, description: 'ID заказа' })
  @ApiResponse({
    status: 200,
    description: 'Список откликов на указанный заказ',
  })
  @Get(':orderId/responses')
  async getResponsesForOrder(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
  ) {
    return this.responseService.getResponsesForOrder(
      authHeader,
      Number(orderId),
    );
  }

  @ApiOperation({ summary: 'Получить мои заказы (как заказчик)' })
  @ApiResponse({ status: 200, description: 'Список заказов, где я заказчик' })
  @Get('my/customer')
  async getMyCustomerOrders(@Headers('authorization') authHeader: string) {
    return this.orderService.getOrdersByCustomer(authHeader);
  }

  @ApiOperation({ summary: 'Получить мои заказы (как перевозчик)' })
  @ApiResponse({ status: 200, description: 'Список заказов, где я перевозчик' })
  @Get('my/carrier')
  async getMyCarrierOrders(@Headers('authorization') authHeader: string) {
    return this.orderService.getOrdersByCarrier(authHeader);
  }

  @ApiOperation({
    summary: 'Получить заказы, ожидающие подтверждения заказчиком(мною)',
  })
  @ApiResponse({
    status: 200,
    description: 'Список заказов со статусом PROCESSED_BY_CARRIER',
  })
  @Get('customer/pending')
  async getOrdersForCustomer(@Headers('authorization') authHeader: string) {
    return this.orderService.getOrdersWaitingForCustomer(authHeader);
  }

  @ApiOperation({
    summary: 'Получить заказы, ожидающие подтверждения перевозчиком(мною)',
  })
  @ApiResponse({
    status: 200,
    description: 'Список заказов со статусом PROCESSED_BY_CUSTOMER',
  })
  @Get('carrier/pending')
  async getOrdersForCarrier(@Headers('authorization') authHeader: string) {
    return this.orderService.getOrdersWaitingForCarrier(authHeader);
  }

  @ApiOperation({ summary: 'Получить избранные заказы' })
  @ApiResponse({ status: 200, description: 'Список избранных заказов' })
  @Get('favorites')
  async getFavoriteOrders(@Headers('authorization') authHeader: string) {
    return this.orderService.getFavoriteOrders(authHeader);
  }

  @ApiOperation({ summary: 'Получить архивные заказы (доставленные)' })
  @ApiResponse({
    status: 200,
    description: 'Список заказов, завершённых или доставленных',
  })
  @Get('archived')
  async getArchivedOrders(@Headers('authorization') authHeader: string) {
    return this.orderService.getArchivedOrders(authHeader);
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

  @ApiOperation({ summary: 'Добавить заказ в избранное' })
  @ApiResponse({
    status: 200,
    description: 'Заказ добавлен в избранное',
  })
  @Patch(':orderId/favorite')
  async addFavoriteOrder(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
  ) {
    return this.orderService.addFavoriteOrder(authHeader, Number(orderId));
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

  @ApiOperation({ summary: 'Редактировать заказ' })
  @ApiResponse({
    status: 200,
    description: 'Заказ успешно отредактирован',
  })
  @ApiBody({ type: CreateOrderDto })
  @Patch(':orderId/edit')
  async editOrder(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
    @Body() updateData: CreateOrderDto,
  ) {
    return this.orderService.editOrder(authHeader, Number(orderId), updateData);
  }

  @Patch(':orderId/dispute')
  @ApiOperation({ summary: 'Открыть спор по заказу' })
  @ApiResponse({ status: 200, description: 'Спор открыт' })
  async openDispute(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
  ) {
    return this.disputeService.openDispute(authHeader, Number(orderId));
  }

  @Delete(':orderId/dispute')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Закрыть спор по заказу (только для админов)' })
  @ApiResponse({ status: 200, description: 'Спор закрыт' })
  async closeDispute(
    @Param('orderId') orderId: string,
    @Body() body: { result?: string; dbRegion: DbRegion },
  ) {
    return this.disputeService.closeDispute(
      Number(orderId),
      body.dbRegion,
      body.result,
    );
  }
}
