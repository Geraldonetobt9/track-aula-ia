import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StripeOverageService } from './stripe-overage.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';

const HIGH_PENDING_THRESHOLD = 100;
const PENDING_BATCH_LIMIT = 500;
const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class StripeOverageReconciliationCron {
  private readonly logger = new Logger(StripeOverageReconciliationCron.name);

  constructor(
    private readonly stripeOverage: StripeOverageService,
    private readonly supabase: SupabaseService,
    private readonly discord: DiscordLoggerService,
  ) {}

  @Cron('0 */6 * * *')
  async retryPendingMeterEvents(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS).toISOString();

    const { data: pending, error } = await this.supabase.getClient()
      .from('usage_overage')
      .select('id')
      .is('reported_to_stripe_at', null)
      .is('settled_at', null)
      .lt('created_at', oneHourAgo)
      .limit(PENDING_BATCH_LIMIT);

    if (error) {
      this.logger.error(`Reconciliation query failed: ${error.message}`);
      return;
    }

    const count = pending?.length ?? 0;
    this.logger.log(`Reconciliation: ${count} pending overage events`);

    for (const row of pending ?? []) {
      try {
        await this.stripeOverage.sendMeterEvent({ overageId: row.id });
      } catch (err: any) {
        this.logger.warn(`Retry failed for overage ${row.id}: ${err.message}`);
      }
    }

    if (count > HIGH_PENDING_THRESHOLD) {
      this.discord.logApiError({
        endpoint: 'overage-reconciliation',
        error: `High pending count: ${count} overage events unreported`,
      } as any);
    }
  }
}
