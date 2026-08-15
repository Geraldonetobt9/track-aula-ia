import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { SupabaseService } from '../../shared/services/supabase.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly subscriptions: SubscriptionsService,
    private readonly discord: DiscordLoggerService,
  ) {}

  // Stripe API 2025-02-24.acacia moved current_period_start/end off the
  // subscription root onto each subscription item. Fallback to root for
  // compatibility with older API versions, then now()+30d as a last resort.
  private extractPeriod(sub: Stripe.Subscription): { periodStart: string; periodEnd: string } {
    const item = sub.items?.data?.[0] as any;
    const start =
      item?.current_period_start ??
      (sub as any).current_period_start ??
      Math.floor(Date.now() / 1000);
    const end =
      item?.current_period_end ??
      (sub as any).current_period_end ??
      Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
    return {
      periodStart: new Date(start * 1000).toISOString(),
      periodEnd: new Date(end * 1000).toISOString(),
    };
  }

  async handle(event: Stripe.Event): Promise<void> {
    const { error } = await this.supabase.getClient()
      .from('stripe_webhook_events')
      .insert({
        id: event.id,
        type: event.type,
        data: event.data as any,
      });

    if (error) {
      if (error.code === '23505') {
        this.logger.log(`Duplicate webhook event ${event.id} (${event.type}) — skipping`);
        return;
      }
      throw new Error(error.message);
    }

    await this.dispatchHandler(event);
  }

  private async dispatchHandler(event: Stripe.Event): Promise<void> {
    this.logger.log(`Handling ${event.type} (id: ${event.id})`);
    switch (event.type) {
      case 'checkout.session.completed':
        // Informational — subscription.created handles plan change.
        break;
      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event);
        break;
      case 'invoice.paid':
        this.logger.log(`Invoice paid: ${(event.data.object as any).id}`);
        break;
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        this.logger.warn(`Invoice payment failed: ${invoice.id}`);
        this.discord.logApiError({
          endpoint: 'stripe_payment_failed',
          error: `Invoice ${invoice.id} attempt ${invoice.attempt_count} failed (amount ${invoice.amount_due})`,
          userId: invoice.customer,
        } as any);
        break;
      }
      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    const userId = sub.metadata?.user_id;
    const planId = sub.metadata?.plan_id;

    if (!userId || !planId) {
      this.logger.error(`subscription.created missing metadata: user_id=${userId}, plan_id=${planId}`);
      return;
    }

    await this.supabase.getClient()
      .from('subscriptions')
      .update({
        stripe_subscription_id: sub.id,
        stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    await this.subscriptions.applyPlanChange(userId, planId, this.extractPeriod(sub));
  }

  private async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    const previousAttrs = (event.data as any).previous_attributes ?? {};
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    const client = this.supabase.getClient();

    const { data: subRow } = await client
      .from('subscriptions')
      .select('user_id, plan_id, cancel_at_period_end')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (!subRow) {
      this.logger.warn(`subscription.updated: no user for customer ${customerId}`);
      return;
    }

    const now = new Date().toISOString();

    // Case A: cancel_at_period_end changed
    if ('cancel_at_period_end' in previousAttrs) {
      await client
        .from('subscriptions')
        .update({
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: now,
        })
        .eq('user_id', subRow.user_id);
      return;
    }

    // Case B: plan change (price changed on items)
    const basePriceId = (sub.items.data as any[]).find((i) => i.price?.recurring?.usage_type === 'licensed')?.price.id
                     ?? (sub.items.data as any[])[0]?.price.id;
    if (!basePriceId) {
      this.logger.warn(`subscription.updated: no base price found`);
      return;
    }

    const { data: newPlan } = await client
      .from('plan_rules')
      .select('id, plan')
      .eq('stripe_price_id_base', basePriceId)
      .maybeSingle();

    if (!newPlan) {
      this.logger.warn(`subscription.updated: no plan_rules row for price ${basePriceId}`);
      return;
    }

    if (newPlan.id === subRow.plan_id) {
      this.logger.log(`subscription.updated: no plan change (still ${newPlan.plan})`);
      return;
    }

    await this.subscriptions.applyPlanChange(subRow.user_id, newPlan.id, this.extractPeriod(sub));
  }

  private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    const client = this.supabase.getClient();

    const { data: subRow } = await client
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (!subRow) {
      this.logger.error(`subscription.deleted: no user found for customer ${customerId}`);
      return;
    }

    const { data: freePlan } = await client
      .from('plan_rules')
      .select('id')
      .eq('plan', 'free')
      .maybeSingle();

    if (!freePlan) {
      this.logger.error(`subscription.deleted: free plan not found in plan_rules`);
      return;
    }

    const now = new Date().toISOString();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await this.subscriptions.applyPlanChange(subRow.user_id, freePlan.id, {
      periodStart: now,
      periodEnd: thirtyDaysFromNow,
    });

    await client
      .from('subscriptions')
      .update({
        stripe_subscription_id: null,
        cancel_at_period_end: false,
        updated_at: now,
      })
      .eq('user_id', subRow.user_id);
  }
}
