import { Injectable, Logger } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class StripeOverageService {
  private readonly logger = new Logger(StripeOverageService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
  ) {}

  async sendMeterEvent(params: { overageId: string }): Promise<void> {
    const client = this.supabase.getClient();

    const { data: ctx, error } = await client
      .from('usage_overage')
      .select(`
        id, user_id, sale_id, price_cents,
        subscription:subscriptions!inner(
          stripe_customer_id,
          plan:plan_rules!plan_id(stripe_meter_event_name)
        )
      `)
      .eq('id', params.overageId)
      .maybeSingle();

    if (error) throw error;
    if (!ctx) throw new Error(`Overage ${params.overageId} not found`);

    const stripeCustomerId = (ctx as any).subscription?.stripe_customer_id;
    const eventName = (ctx as any).subscription?.plan?.stripe_meter_event_name;

    if (!stripeCustomerId) {
      throw new Error(`No stripe_customer_id for user ${(ctx as any).user_id} (overage ${params.overageId})`);
    }
    if (!eventName) {
      throw new Error(`No meter_event_name for user's plan (overage ${params.overageId})`);
    }

    await this.stripe.getClient().billing.meterEvents.create({
      event_name: eventName,
      identifier: params.overageId,
      timestamp: Math.floor(Date.now() / 1000),
      payload: {
        value: '1',
        stripe_customer_id: stripeCustomerId,
      },
    });

    await client.from('usage_overage').update({
      reported_to_stripe_at: new Date().toISOString(),
      stripe_usage_record_id: params.overageId,
    }).eq('id', params.overageId);
  }
}
