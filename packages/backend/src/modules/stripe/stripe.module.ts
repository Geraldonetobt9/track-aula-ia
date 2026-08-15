// packages/backend/src/modules/stripe/stripe.module.ts
import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeSignatureGuard } from './stripe-signature.guard';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeCheckoutController } from './stripe-checkout.controller';
import { StripeCheckoutService } from './stripe-checkout.service';
import { StripeBillingController } from './stripe-billing.controller';
import { StripeBillingService } from './stripe-billing.service';
import { StripeOverageService } from './stripe-overage.service';
import { StripeOverageReconciliationCron } from './stripe-overage-reconciliation.cron';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';

@Module({
  imports: [SubscriptionsModule, PlanLimitsModule],
  providers: [
    StripeService,
    StripeSignatureGuard,
    StripeWebhookService,
    StripeCheckoutService,
    StripeBillingService,
    StripeOverageService,
    StripeOverageReconciliationCron,
  ],
  controllers: [StripeWebhookController, StripeCheckoutController, StripeBillingController],
  exports: [StripeService, StripeOverageService],
})
export class StripeModule {}
