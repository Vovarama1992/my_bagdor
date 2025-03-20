import { Controller, Patch, Param, Body, Headers } from '@nestjs/common';
import { DeliveryStageService } from './delivery-stage.service';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

@ApiTags('Delivery')
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryStageService: DeliveryStageService) {}

  @ApiOperation({ summary: 'Начать изменение статуса доставки' })
  @ApiResponse({
    status: 200,
    description: 'Код подтверждения отправлен на почту',
  })
  @ApiParam({ name: 'orderId', description: 'ID заказа', example: 1 })
  @ApiParam({
    name: 'status',
    description: 'Новый статус для заказа',
    example: 'IN_TRANSIT',
  })
  @Patch(':orderId/:status')
  async changeStatus(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: number,
    @Param('status') status: string,
  ) {
    return this.deliveryStageService.createConfirmationKey(
      authHeader,
      orderId,
      status,
    );
  }

  @ApiOperation({ summary: 'Подтвердить изменение статуса доставки' })
  @ApiResponse({
    status: 200,
    description: 'Статус успешно изменен',
  })
  @ApiParam({ name: 'orderId', description: 'ID заказа', example: 1 })
  @ApiParam({
    name: 'status',
    description: 'Новый статус для заказа',
    example: 'IN_TRANSIT',
  })
  @ApiBody({
    type: Object,
    description: 'Объект с кодом подтверждения',
    examples: {
      example: {
        value: {
          enteredCode: '1234', // Пример кода
        },
      },
    },
  })
  @Patch(':orderId/confirm/:status')
  async confirmStatus(
    @Headers('authorization') authHeader: string,
    @Param('orderId') orderId: number,
    @Param('status') status: OrderStatus,
    @Body() body: { enteredCode: string },
  ) {
    return this.deliveryStageService.confirmStageChange(
      authHeader,
      orderId,
      status,
      body.enteredCode,
    );
  }
}
