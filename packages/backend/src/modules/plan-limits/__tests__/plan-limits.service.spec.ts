// packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PlanLimitsService } from '../plan-limits.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { CacheService } from '../../../shared/services/cache.service';

describe('PlanLimitsService', () => {
  let service: PlanLimitsService;
  let supabaseMock: any;

  beforeEach(async () => {
    const plan = {
      id: 'plan-pro-id', plan: 'pro',
      max_sales_monthly: 1000, max_active_ad_accounts: 3,
      max_checkout_integrations: 3, max_workspaces: 3,
      max_active_rules: 3, overage_price_cents: 14,
    };
    const subscription = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end: '2026-05-01T00:00:00Z',
    };

    supabaseMock = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: subscription, error: null }),
                }),
              }),
            };
          }
          if (table === 'plan_rules') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({ data: plan, error: null }),
                }),
              }),
            };
          }
          return {};
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanLimitsService,
        { provide: SupabaseService, useValue: supabaseMock },
        CacheService,
      ],
    }).compile();

    service = module.get(PlanLimitsService);
  });

  it('resolves plan and subscription for a user', async () => {
    const resolved = await (service as any).resolveUserPlan('user-1');
    expect(resolved.plan.plan).toBe('pro');
    expect(resolved.subscription.id).toBe('sub-1');
  });

  it('countActive returns counts per resource for the user', async () => {
    supabaseMock.getClient = () => ({
      from: (table: string) => {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          gte: () => builder,
          lt: () => builder,
          then: async (resolve: any) => {
            const countsByTable: Record<string, number> = {
              workspaces: 2,
              facebook_connections: 3,
              checkout_integrations: 1,
              automation_rules: 0,
              sales: 42,
            };
            resolve({ count: countsByTable[table] ?? 0, error: null });
          },
        };
        return builder;
      },
    });

    const counts = await (service as any).countActive('user-1', {
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
    });

    expect(counts).toEqual({
      workspaces: 2,
      ad_accounts: 3,
      integrations: 1,
      rules: 0,
      sales: 42,
    });
  });

  it('assertCanCreateWorkspace throws 402 when limit reached', async () => {
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: { id: 'sub-1' },
      plan: { plan: 'pro', max_workspaces: 3 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 3, ad_accounts: 0, integrations: 0, rules: 0, sales: 0,
    });

    await expect(service.assertCanCreateWorkspace('user-1')).rejects.toMatchObject({
      detail: { resource: 'workspace', current: 3, limit: 3, plan: 'pro' },
    });
  });

  it('assertCanCreateWorkspace passes when plan is unlimited (-1)', async () => {
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: { id: 'sub-1' },
      plan: { plan: 'unlimited', max_workspaces: -1 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 99, ad_accounts: 0, integrations: 0, rules: 0, sales: 0,
    });

    await expect(service.assertCanCreateWorkspace('user-1')).resolves.toBeUndefined();
  });

  describe('checkSaleAcceptance', () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
    };

    it('allowed without overage when within limit', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'pro', max_sales_monthly: 1000, overage_price_cents: 14 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 500,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: false, overage: false,
        subscriptionId: 'sub-1',
      });
    });

    it('overage when paid plan exceeds limit', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'pro', max_sales_monthly: 1000, overage_price_cents: 14 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 1000,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: false, overage: true, pricePerSaleCents: 14,
      });
    });

    it('blocked_by_limit when Free exceeds', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'free', max_sales_monthly: 30, overage_price_cents: 0 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 30,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: true, overage: false,
      });
    });

    it('allowed when plan is unlimited (-1)', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'unlimited', max_sales_monthly: -1, overage_price_cents: 0 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 99_999,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: false, overage: false,
      });
    });
  });

  it('getUsageSnapshot returns used/limit/blocked/overage', async () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    };
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: sub,
      plan: {
        plan: 'pro',
        max_sales_monthly: 1000, max_active_ad_accounts: 3,
        max_checkout_integrations: 3, max_workspaces: 3,
        max_active_rules: 3, overage_price_cents: 14,
      },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 2, ad_accounts: 3, integrations: 1, rules: 0, sales: 500,
    });
    jest.spyOn(service as any, 'countBlockedSales').mockResolvedValue(0);
    jest.spyOn(service as any, 'getOverageTotals').mockResolvedValue({ count: 12, totalCents: 168 });
    jest.spyOn(service as any, 'resolveScheduledPlan').mockResolvedValue(null);

    const snap = await service.getUsageSnapshot('user-1');
    expect(snap).toEqual({
      plan: 'pro',
      period: { start: '2026-04-01T00:00:00Z', end: '2026-05-01T00:00:00Z' },
      sales:        { used: 500, limit: 1000, blocked: 0 },
      workspaces:   { used: 2, limit: 3 },
      adAccounts:   { used: 3, limit: 3 },
      integrations: { used: 1, limit: 3 },
      activeRules:  { used: 0, limit: 3 },
      overage:      { count: 12, totalCents: 168 },
      subscription: {
        status: null,
        next_billing_date: '2026-05-01T00:00:00Z',
        cancel_at_period_end: false,
        scheduled_plan: null,
        has_stripe_customer: false,
      },
    });
  });

  it('includes subscription status fields', async () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: true,
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_456',
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    };
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: sub,
      plan: { plan: 'pro', max_sales_monthly: 1000, max_active_ad_accounts: 3, max_checkout_integrations: 3, max_workspaces: 3, max_active_rules: 3, overage_price_cents: 14 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 1, ad_accounts: 1, integrations: 1, rules: 0, sales: 100,
    });
    jest.spyOn(service as any, 'countBlockedSales').mockResolvedValue(0);
    jest.spyOn(service as any, 'getOverageTotals').mockResolvedValue({ count: 0, totalCents: 0 });
    jest.spyOn(service as any, 'resolveScheduledPlan').mockResolvedValue(null);

    const snap = await service.getUsageSnapshot('user-1');
    expect(snap.subscription).toEqual({
      status: 'active',
      next_billing_date: '2026-05-01T00:00:00Z',
      cancel_at_period_end: true,
      scheduled_plan: null,
      has_stripe_customer: true,
    });
  });

  // Scenario 5: Refunded sales do not count toward the Free limit.
  // countActive filters status='approved' AND blocked_by_limit=false — refunded
  // rows are excluded before the decision runs, so the 31st approved still blocks.
  it('Free at limit blocks 31st approved sale regardless of refunded rows in table', async () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-free-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
    };
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: sub,
      plan: { plan: 'free', max_sales_monthly: 30, overage_price_cents: 0 },
    });
    const countSpy = jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 30,
    });

    const result = await service.checkSaleAcceptance('user-1');
    expect(result).toMatchObject({ blocked_by_limit: true, overage: false });
    // Sanity: countActive is the filter boundary that enforces 'approved' only.
    expect(countSpy).toHaveBeenCalledWith('user-1', sub);
  });

  // Scenario 14: assertCanCreateIntegration / AdAccount / ActivateRule guards.
  // One sub-case at the limit (throws 402) and one below the limit (passes).
  describe('assertCan* guards (Scenario 14)', () => {
    function stubPlanAndCounts(plan: any, counts: any) {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: { id: 'sub-1' },
        plan,
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue(counts);
    }

    it('assertCanCreateIntegration throws 402 at the limit', async () => {
      stubPlanAndCounts(
        { plan: 'pro', max_checkout_integrations: 3 },
        { workspaces: 0, ad_accounts: 0, integrations: 3, rules: 0, sales: 0 },
      );
      await expect(service.assertCanCreateIntegration('user-1')).rejects.toMatchObject({
        detail: { resource: 'integration', current: 3, limit: 3, plan: 'pro' },
      });
    });

    it('assertCanCreateIntegration passes below the limit', async () => {
      stubPlanAndCounts(
        { plan: 'pro', max_checkout_integrations: 3 },
        { workspaces: 0, ad_accounts: 0, integrations: 2, rules: 0, sales: 0 },
      );
      await expect(service.assertCanCreateIntegration('user-1')).resolves.toBeUndefined();
    });

    it('assertCanActivateAdAccount throws 402 at the limit', async () => {
      stubPlanAndCounts(
        { plan: 'pro', max_active_ad_accounts: 3 },
        { workspaces: 0, ad_accounts: 3, integrations: 0, rules: 0, sales: 0 },
      );
      await expect(service.assertCanActivateAdAccount('user-1', 'fb-1')).rejects.toMatchObject({
        detail: { resource: 'ad_account', current: 3, limit: 3, plan: 'pro' },
      });
    });

    it('assertCanActivateAdAccount passes below the limit', async () => {
      stubPlanAndCounts(
        { plan: 'pro', max_active_ad_accounts: 3 },
        { workspaces: 0, ad_accounts: 2, integrations: 0, rules: 0, sales: 0 },
      );
      await expect(service.assertCanActivateAdAccount('user-1', 'fb-1')).resolves.toBeUndefined();
    });

    it('assertCanActivateRule throws 402 at the limit', async () => {
      stubPlanAndCounts(
        { plan: 'pro', max_active_rules: 3 },
        { workspaces: 0, ad_accounts: 0, integrations: 0, rules: 3, sales: 0 },
      );
      await expect(service.assertCanActivateRule('user-1', 'rule-1')).rejects.toMatchObject({
        detail: { resource: 'active_rule', current: 3, limit: 3, plan: 'pro' },
      });
    });

    it('assertCanActivateRule passes below the limit', async () => {
      stubPlanAndCounts(
        { plan: 'pro', max_active_rules: 3 },
        { workspaces: 0, ad_accounts: 0, integrations: 0, rules: 2, sales: 0 },
      );
      await expect(service.assertCanActivateRule('user-1', 'rule-1')).resolves.toBeUndefined();
    });
  });

  // Scenario 15: Free plan has max_active_rules=0, so assertCanActivateRule
  // must throw immediately — 0 >= 0 is the triggering boundary.
  it('assertCanActivateRule throws immediately on Free (max_active_rules=0, current=0)', async () => {
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: { id: 'sub-1' },
      plan: { plan: 'free', max_active_rules: 0 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 0,
    });
    await expect(service.assertCanActivateRule('user-1', 'rule-new')).rejects.toMatchObject({
      detail: { resource: 'active_rule', current: 0, limit: 0, plan: 'free' },
    });
  });

  it('reports status=null when no stripe subscription', async () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-free-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    };
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: sub,
      plan: { plan: 'free', max_sales_monthly: 30, max_active_ad_accounts: 1, max_checkout_integrations: 1, max_workspaces: 1, max_active_rules: 0, overage_price_cents: 0 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 1, ad_accounts: 0, integrations: 1, rules: 0, sales: 10,
    });
    jest.spyOn(service as any, 'countBlockedSales').mockResolvedValue(0);
    jest.spyOn(service as any, 'getOverageTotals').mockResolvedValue({ count: 0, totalCents: 0 });
    jest.spyOn(service as any, 'resolveScheduledPlan').mockResolvedValue(null);

    const snap = await service.getUsageSnapshot('user-1');
    expect(snap.subscription).toEqual({
      status: null,
      next_billing_date: '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      scheduled_plan: null,
      has_stripe_customer: false,
    });
  });

  describe('countActive sales (plan-limits BR-03)', () => {
    it('filters sales count by source=webhook so imports are excluded', async () => {
      const eqCalls: Array<[string, any]> = [];
      const fakeBuilder: any = {
        select: () => fakeBuilder,
        eq: (col: string, val: any) => { eqCalls.push([col, val]); return fakeBuilder; },
        is: () => fakeBuilder,
        gte: () => fakeBuilder,
        lt: () => fakeBuilder,
        then: (resolve: any) => resolve({ count: 0 }),
      };
      const fakeClient = { from: () => fakeBuilder };

      (service as any).supabase = { getClient: () => fakeClient };
      (service as any).cache = { get: () => null, set: () => {}, invalidateByPrefix: () => {} };

      await (service as any).countActive('user-1', {
        current_period_start: '2026-04-01T00:00:00Z',
        current_period_end: '2026-05-01T00:00:00Z',
      });

      const salesEqCalls = eqCalls.filter(([col]) =>
        ['status', 'blocked_by_limit', 'source'].includes(col),
      );
      expect(salesEqCalls).toContainEqual(['source', 'webhook']);
    });
  });
});
