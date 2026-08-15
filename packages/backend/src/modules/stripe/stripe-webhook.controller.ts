import { Controller, Post, Req, UseGuards, HttpCode } from '@nestjs/common';
import { StripeSignatureGuard } from './stripe-signature.guard';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('stripe')
export class StripeWebhookController {
  constructor(private readonly webhookService: StripeWebhookService) {}

  @Post('webhook')
  @UseGuards(StripeSignatureGuard)
  @HttpCode(200)
  async handle(@Req() req: any): Promise<{ received: true }> {
    await this.webhookService.handle(req.stripeEvent);
    return { received: true };
  }
}
