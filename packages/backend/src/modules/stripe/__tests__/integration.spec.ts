// Tier-2 integration: real StripeWebhookService wired to real SubscriptionsService
// and real PlanLimitsService, backed by the in-memory supabaseFake. Exercises
// cross-module invariants (idempotency, no-op detection, out-of-order delivery)
// that the per-service unit specs can't reach on their own.
//
// Scenarios: 76 (Free→Pro unblocks), 80 (subscription.updated no-op),
// 81 (cancel+reactivate flips), 86 (deleted-wins on reverse-order webhooks).
import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookService } from '../stripe-webhook.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { PlanLimitsService } from '../../plan-limits/plan-limits.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { CacheService } from '../../../shared/services/cache.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SupabaseFake } from '../../../../test/helpers/supabaseFake';
import { loadStripeFixture } from '../../../../test/helpers/loadStripeFixture';
import {
  FREE_PLAN_ROW, PRO_PLAN_ROW, STARTER_PLAN_ROW,
  FREE_PLAN_ID, PRO_PLAN_ID, STARTER_PLAN_ID,
} from '../../../../test/helpers/constants';

describe('Stripe integration (Tier-2)', () => {
  let fake: SupabaseFake;
  let webhookService: StripeWebhookService;
  let applyPlanSpy: jest.SpyInstance;

  async function buildModule(): Promise<TestingModule> {
    return Test.createTestingModule({
      providers: [
        StripeWebhookService,
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
    fake.declareUnique('stripe_webhook_events', ['id']);

    // Seed plan_rules.
    fake.seed('plan_rules', [FREE_PLAN_ROW, PRO_PLAN_ROW, STARTER_PLAN_ROW]);

    // Seed a Free user with a subscription that already has Stripe IDs
    // (mid-cycle state, before the plan-change webhook).
    fake.seed('subscriptions', [{
      id: 'sub-user-1',
      user_id: 'user-1',
      plan_id: FREE_PLAN_ID,
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      stripe_customer_id: 'cus_fixture_1',
      stripe_subscription_id: 'sub_fixture_1',
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    }]);
    fake.seed('profiles', [{ user_id: 'user-1', plan_id: FREE_PLAN_ID }]);

    // Seed 50 recent blocked sales (last 30 days).
    const thirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    fake.seed('sales', Array.from({ length: 50 }, (_, i) => ({
      id: `sale-blocked-${i}`,
      user_id: 'user-1',
      status: 'approved',
      blocked_by_limit: true,
      sold_at: thirtyDaysAgo,
      created_at: thirtyDaysAgo,
    })));

    const module = await buildModule();
    webhookService = module.get(StripeWebhookService);
    const subscriptionsService = module.get(SubscriptionsService);
    applyPlanSpy = jest.spyOn(subscriptionsService, 'applyPlanChange');
  });

  // Scenario 76 — Free→Pro via Checkout-generated customer.subscription.created.
  // End-to-end assertion: 50 blocked sales flip, sub+profile plan_id = Pro,
  // zero usage_overage rows created.
  it('Free→Pro via subscription.created unblocks 50 and creates zero overage', async () => {
    const event = loadStripeFixture('customer.subscription.created.pro.json', {
      userId: 'user-1',
      planId: PRO_PLAN_ID,
    });

    await webhookService.handle(event);

    expect(applyPlanSpy).toHaveBeenCalledWith('user-1', PRO_PLAN_ID, expect.objectContaining({
      periodStart: expect.any(String),
      periodEnd: expect.any(String),
    }));
    // 50 blocked sales flipped to blocked_by_limit=false.
    const unblocked = fake.store.sales.filter(
      (s: any) => s.user_id === 'user-1' && s.status === 'approved' && s.blocked_by_limit === false,
    );
    expect(unblocked.length).toBe(50);
    // Zero new usage_overage rows retroactively created.
    expect(fake.store.usage_overage ?? []).toHaveLength(0);
    // Subscription and profile both flipped to Pro.
    expect(fake.store.subscriptions[0].plan_id).toBe(PRO_PLAN_ID);
    expect(fake.store.profiles[0].plan_id).toBe(PRO_PLAN_ID);
  });

  // Scenario 80 — subscription.updated with unchanged plan: applyPlanChange
  // must NOT be called. (The private handler detects no plan change and returns.)
  it('subscription.updated with unchanged plan does not call applyPlanChange', async () => {
    // Move user to Pro first so the fixture's base price matches.
    const subRow = fake.store.subscriptions[0];
    subRow.plan_id = PRO_PLAN_ID;
    fake.store.profiles[0].plan_id = PRO_PLAN_ID;

    const event = loadStripeFixture('customer.subscription.updated.no-change.json');
    await webhookService.handle(event);

    expect(applyPlanSpy).not.toHaveBeenCalled();
  });

  // Scenario 81 — cancel + reactivate: two cancel_at_period_end flips, no
  // applyPlanChange calls. Tests that the cancel_at_period_end branch short-
  // circuits before any plan-resolution logic.
  it('cancel then reactivate in Portal flips cancel_at_period_end twice with no applyPlanChange', async () => {
    const subRow = fake.store.subscriptions[0];
    subRow.plan_id = PRO_PLAN_ID;

    const cancelEvent = loadStripeFixture('customer.subscription.updated.cancel-scheduled.json');
    const reactivateEvent = loadStripeFixture('customer.subscription.updated.reactivation.json', {
      id: 'evt_reactivate_1',
    });

    await webhookService.handle(cancelEvent);
    expect(fake.store.subscriptions[0].cancel_at_period_end).toBe(true);

    await webhookService.handle(reactivateEvent);
    expect(fake.store.subscriptions[0].cancel_at_period_end).toBe(false);

    expect(applyPlanSpy).not.toHaveBeenCalled();
  });

  // Scenario 86 — Two webhooks delivered in reverse order (updated for plan
  // change, then deleted). The deleted handler wins: user ends on Free with
  // cleared stripe_subscription_id.
  it('subscription.updated + subscription.deleted in reverse order: deleted wins', async () => {
    const subRow = fake.store.subscriptions[0];
    subRow.plan_id = PRO_PLAN_ID;
    fake.store.profiles[0].plan_id = PRO_PLAN_ID;

    const updateEvent = loadStripeFixture('customer.subscription.updated.plan-change.pro-to-starter.json');
    const deleteEvent = loadStripeFixture('customer.subscription.deleted.json', {
      id: 'evt_del_after_update_1',
    });

    await webhookService.handle(updateEvent); // plan change → Starter
    await webhookService.handle(deleteEvent); // then delete → Free

    const finalSub = fake.store.subscriptions[0];
    expect(finalSub.plan_id).toBe(FREE_PLAN_ID);
    expect(finalSub.stripe_subscription_id).toBeNull();
    expect(finalSub.cancel_at_period_end).toBe(false);
    expect(fake.store.profiles[0].plan_id).toBe(FREE_PLAN_ID);
  });

  // Scenario 50 (cross-verified at Tier-2): replayed webhook event.id is
  // swallowed by the UNIQUE constraint on stripe_webhook_events.id.
  it('replaying the same webhook event.id is a no-op', async () => {
    const event = loadStripeFixture('customer.subscription.created.pro.json', {
      userId: 'user-1',
      planId: PRO_PLAN_ID,
    });

    await webhookService.handle(event);
    const firstCount = applyPlanSpy.mock.calls.length;

    await webhookService.handle(event);
    // dispatchHandler short-circuits on the 23505 insert conflict — no
    // additional applyPlanChange call.
    expect(applyPlanSpy.mock.calls.length).toBe(firstCount);
  });
});
