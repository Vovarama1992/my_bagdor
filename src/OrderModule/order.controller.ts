import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  Headers,
  Get,
  Delete,
  BadRequestException,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
  Logger,
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
import { ResponseService } from './response.service';
import { DisputeService } from './dispute.service';
import { DbRegion } from '@prisma/client';
import { AdminGuard } from 'guards/admin.guard';
import { S3Service } from './sc3.service';

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);
  constructor(
    private readonly orderService: OrderService,
    private readonly responseService: ResponseService,
    private readonly disputeService: DisputeService,
    private readonly s3Service: S3Service,
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

  @Post(':orderId/upload-media')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMediaFiles(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    this.logger.log(`Начало загрузки медиа для заказа #${orderId}`);
    return this.uploadMediaAutoType(authHeader, orderId, files);
  }

  private async uploadMediaAutoType(
    authHeader: string,
    orderId: string,
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Файлы не загружены');
    }

    const uploadedFiles = await Promise.all(
      files.map(async (file) => {
        const mimetype = file.mimetype;
        const type: 'photo' | 'video' = mimetype.startsWith('image/')
          ? 'photo'
          : mimetype.startsWith('video/')
            ? 'video'
            : null;

        if (!type) {
          this.logger.warn(
            `Неизвестный тип файла: ${file.originalname} (${mimetype})`,
          );
          throw new BadRequestException(
            `Недопустимый тип файла: ${file.originalname}`,
          );
        }

        this.logger.log(`[${type}] Обработка файла: ${file.originalname}`);

        const url =
          type === 'photo'
            ? await this.s3Service.processAndUploadPhoto(
                authHeader,
                Number(orderId),
                file,
              )
            : await this.s3Service.processAndUploadVideo(
                authHeader,
                Number(orderId),
                file,
              );

        this.logger.log(`[${type}] Файл загружен: ${url}`);
        return url;
      }),
    );

    this.logger.log(`Все файлы загружены для заказа #${orderId}`);
    return { message: 'Файлы загружены', files: uploadedFiles };
  }

  @Get(':orderId/media-files')
  async getOrderMediaFiles(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
  ) {
    return this.s3Service.getOrderMediaFiles(authHeader, +orderId);
  }

  @ApiOperation({ summary: 'Получить все заказы' })
  @Get()
  async getAllOrders(@Headers('authorization') authHeader: string) {
    return this.orderService.getAllOrdersAcrossRegions(authHeader);
  }

  @Post(':region/:orderId/response')
  async createResponse(
    @Headers('authorization') authHeader: string,
    @Param('region') region: DbRegion,
    @Param('orderId') orderId: number,
    @Body() dto: { flightId: number; message?: string; priceOffer?: number },
  ) {
    return this.responseService.createResponse(
      authHeader,
      region,
      orderId,
      dto.flightId,
      dto.message,
      dto.priceOffer,
    );
  }

  @Patch(':orderId/set-flight')
  @ApiOperation({ summary: 'Привязать заказ к рейсу (от заказчика)' })
  @ApiResponse({ status: 200, description: 'Рейс успешно назначен' })
  async attachOrderToFlight(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: string,
    @Body() body: { flightId: number },
  ) {
    return this.orderService.editOrder(authHeader, +orderId, {
      flightId: body.flightId,
    });
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
