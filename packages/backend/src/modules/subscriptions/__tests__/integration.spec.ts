// Tier-2 integration: real SubscriptionsService + real PlanLimitsService
// backed by the in-memory supabaseFake. Exercises applyPlanChange cross-effects
// that the unit spec's queue-based fake cannot prove deterministically.
//
// Scenarios: 78 (30-day unblock boundary end-to-end), 83 (admin→Unlimited).
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from '../subscriptions.service';
import { PlanLimitsService } from '../../plan-limits/plan-limits.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { CacheService } from '../../../shared/services/cache.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SupabaseFake } from '../../../../test/helpers/supabaseFake';
import {
  FREE_PLAN_ROW, PRO_PLAN_ROW, UNLIMITED_PLAN_ROW,
  FREE_PLAN_ID, PRO_PLAN_ID, UNLIMITED_PLAN_ID,
} from '../../../../test/helpers/constants';

describe('Subscriptions integration (Tier-2)', () => {
  let fake: SupabaseFake;
  let subscriptionsService: SubscriptionsService;

  async function buildModule(): Promise<TestingModule> {
    return Test.createTestingModule({
      providers: [
        SubscriptionsService,
        PlanLimitsService,
        CacheService,
        { provide: SupabaseService, useValue: fake },
        { provide: DiscordLoggerService, useValue: { logApiError: jest.fn() } },
      ],
    }).compile();
  }

  beforeEach(async () => {
    fake = new SupabaseFake();
    fake.seed('plan_rules', [FREE_PLAN_ROW, PRO_PLAN_ROW, UNLIMITED_PLAN_ROW]);
    fake.seed('profiles', [{ user_id: 'user-1', plan_id: FREE_PLAN_ID }]);
  });

  // Scenario 78: upgrade unblocks ONLY sales with sold_at >= now()-30d; older
  // blocked sales remain blocked. Verified end-to-end via the supabaseFake's
  // real .gte filter semantics.
  it('Free→Pro unblocks only last-30d blocked sales; older ones stay blocked', async () => {
    fake.seed('subscriptions', [{
      id: 'sub-user-1', user_id: 'user-1', plan_id: FREE_PLAN_ID,
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      stripe_customer_id: null, stripe_subscription_id: null,
      scheduled_plan_id: null, scheduled_changes_at: null,
    }]);

    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const old    = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

    const salesRows = [
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `sale-recent-${i}`,
        user_id: 'user-1',
        status: 'approved',
        blocked_by_limit: true,
        sold_at: recent,
      })),
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `sale-old-${i}`,
        user_id: 'user-1',
        status: 'approved',
        blocked_by_limit: true,
        sold_at: old,
      })),
    ];
    fake.seed('sales', salesRows);

    const module = await buildModule();
    subscriptionsService = module.get(SubscriptionsService);

    const result = await subscriptionsService.applyPlanChange('user-1', PRO_PLAN_ID);

    expect(result.unblocked_sales).toBe(40);
    const stillBlocked = fake.store.sales.filter((s: any) => s.blocked_by_limit === true);
    expect(stillBlocked.length).toBe(60);
    expect(stillBlocked.every((s: any) => s.sold_at === old)).toBe(true);
  });

  // Scenario 83: admin sets user to Unlimited directly (no Stripe). The call
  // must succeed without a stripe_subscription_id set on the subscription row.
  it('admin applyPlanChange to Unlimited works without Stripe IDs', async () => {
    fake.seed('subscriptions', [{
      id: 'sub-user-1', user_id: 'user-1', plan_id: FREE_PLAN_ID,
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      stripe_customer_id: null, stripe_subscription_id: null,
      scheduled_plan_id: null, scheduled_changes_at: null,
    }]);

    const module = await buildModule();
    subscriptionsService = module.get(SubscriptionsService);

    const result = await subscriptionsService.applyPlanChange('user-1', UNLIMITED_PLAN_ID);

    expect(result.old_plan).toBe('free');
    expect(result.new_plan).toBe('unlimited');
    expect(fake.store.subscriptions[0].plan_id).toBe(UNLIMITED_PLAN_ID);
    expect(fake.store.profiles[0].plan_id).toBe(UNLIMITED_PLAN_ID);
    // Stripe IDs remain null — admin path is independent of Stripe state.
    expect(fake.store.subscriptions[0].stripe_subscription_id).toBeNull();
    expect(fake.store.subscriptions[0].stripe_customer_id).toBeNull();
  });
});
