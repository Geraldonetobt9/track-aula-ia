// packages/backend/src/modules/stripe/stripe-billing.controller.ts
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  InvoiceDto,
  PaymentMethodsResponse,
  StripeBillingService,
} from './stripe-billing.service';

class AttachPaymentMethodDto {
  @IsString() paymentMethodId!: string;
  @IsOptional() @IsBoolean() setAsDefault?: boolean;
}

@UseGuards(AuthGuard)
@Controller('stripe')
export class StripeBillingController {
  constructor(private readonly billing: StripeBillingService) {}

  @Get('invoices')
  async listInvoices(@CurrentUser('id') userId: string): Promise<InvoiceDto[]> {
    return this.billing.listInvoices(userId);
  }

  @Get('payment-methods')
  async listPaymentMethods(@CurrentUser('id') userId: string): Promise<PaymentMethodsResponse> {
    return this.billing.listPaymentMethods(userId);
  }

  @Post('payment-methods/attach')
  async attach(
    @CurrentUser('id') userId: string,
    @Body() dto: AttachPaymentMethodDto,
  ): Promise<{ success: true; is_default: boolean }> {
    return this.billing.attachPaymentMethod(userId, dto.paymentMethodId, {
      setAsDefault: dto.setAsDefault ?? false,
    });
  }

  @Post('payment-methods/:id/default')
  async setDefault(
    @CurrentUser('id') userId: string,
    @Param('id') paymentMethodId: string,
  ): Promise<{ success: true }> {
    await this.billing.setDefaultPaymentMethod(userId, paymentMethodId);
    return { success: true };
  }

  @Post('setup-intent')
  async createSetupIntent(@CurrentUser('id') userId: string): Promise<{ clientSecret: string }> {
    return this.billing.createSetupIntent(userId);
  }

  @Delete('payment-methods/:id')
  async detach(
    @CurrentUser('id') userId: string,
    @Param('id') paymentMethodId: string,
  ): Promise<{ success: true }> {
    await this.billing.detachPaymentMethod(userId, paymentMethodId);
    return { success: true };
  }
}
