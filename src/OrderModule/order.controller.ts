import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  Headers,
  Get,
  Delete,
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
