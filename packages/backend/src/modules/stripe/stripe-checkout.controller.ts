// packages/backend/src/modules/stripe/stripe-checkout.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsString, IsUUID } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StripeCheckoutService, CheckoutResult, PlanChangePreview } from './stripe-checkout.service';

class CheckoutDto {
  @IsString() @IsUUID()
  planId!: string;
}

class PreviewChangeDto {
  @IsString() @IsUUID()
  planId!: string;
}

@UseGuards(AuthGuard)
@Controller('stripe')
export class StripeCheckoutController {
  constructor(private readonly checkout: StripeCheckoutService) {}

  @Post('checkout')
  async createCheckout(
    @CurrentUser('id') userId: string,
    @Body() dto: CheckoutDto,
  ): Promise<CheckoutResult> {
    return this.checkout.createCheckoutSession(userId, dto.planId);
  }

  @Post('portal')
  async createPortal(@CurrentUser('id') userId: string): Promise<{ url: string }> {
    return this.checkout.createPortalSession(userId);
  }

  @Post('reactivate')
  async reactivate(@CurrentUser('id') userId: string): Promise<{ success: true }> {
    return this.checkout.reactivateSubscription(userId);
  }

  @Post('cancel')
  async cancel(@CurrentUser('id') userId: string): Promise<{
    canceled_at: string;
    ends_at: string;
    already_scheduled: boolean;
  }> {
    return this.checkout.cancelSubscription(userId);
  }

  @Post('preview-change')
  async previewChange(
    @CurrentUser('id') userId: string,
    @Body() dto: PreviewChangeDto,
  ): Promise<PlanChangePreview> {
    return this.checkout.previewPlanChange(userId, dto.planId);
  }
}
