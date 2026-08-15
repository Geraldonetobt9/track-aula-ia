// packages/backend/src/modules/subscriptions/__tests__/subscriptions.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from '../subscriptions.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { PlanLimitsService } from '../../plan-limits/plan-limits.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';

// ---------------------------------------------------------------------------
// Fluent-builder mock factory
//
// Each call to `from(table)` pops the next queued response for that table from
// the queue. A response can be a single-row result (maybeSingle) or a rows
// result (default resolution). Write operations resolve with { error: null }.
// ---------------------------------------------------------------------------

interface TableResponse {
  rows?: any[];
  singleRow?: any | null;
  writeError?: any;
  /**
   * When true, the builder's `.select('id')` after `.update()` returns `rows`
   * as data (for the "unblock sales" step).
   */
  updateWithSelect?: boolean;
}

function makeClient(tableQueues: Record<string, TableResponse[]>) {
  const callCounters: Record<string, number> = {};

  return {
    from: (table: string) => {
      const index = callCounters[table] ?? 0;
      callCounters[table] = index + 1;

      const queue = tableQueues[table] ?? [];
      const response: TableResponse = queue[index] ?? {};

      let pendingUpdate = false;
      let pendingUpdateWithSelect = false;

      const builder: any = {
        select: (..._args: any[]) => {
          if (pendingUpdate && response.updateWithSelect) {
            pendingUpdateWithSelect = true;
          }
          return builder;
        },
        update: (_payload: any) => {
          pendingUpdate = true;
          return builder;
        },
        eq: (_col: string, _val: any) => builder,
        in: (_col: string, _vals: any[]) => builder,
        is: (_col: string, _val: any) => builder,
        gte: (_col: string, _val: any) => builder,
        order: (_col: string, _opts?: any) => builder,
        maybeSingle: async () => ({
          data: response.singleRow !== undefined ? response.singleRow : null,
          error: null,
        }),
        then: (resolve: (v: any) => void, reject?: (e: any) => void) => {
          if (pendingUpdate) {
            if (pendingUpdateWithSelect) {
              return Promise.resolve({ data: response.rows ?? [], error: response.writeError ?? null }).then(resolve, reject);
            }
            return Promise.resolve({ data: response.rows ?? null, error: response.writeError ?? null }).then(resolve, reject);
          }
          return Promise.resolve({ data: response.rows ?? [], error: null }).then(resolve, reject);
        },
      };

      // Make the builder thenable for direct await without .maybeSingle()
      builder[Symbol.toStringTag] = 'Promise';

      return builder;
    },
  };
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const FREE_PLAN = {
  id: 'plan-free-id',
  plan: 'free',
  max_sales_monthly: 30,
  max_active_ad_accounts: 1,
  max_checkout_integrations: 1,
  max_workspaces: 1,
  max_active_rules: 0,
};

const PRO_PLAN = {
  id: 'plan-pro-id',
  plan: 'pro',
  max_sales_monthly: 1000,
  max_active_ad_accounts: 5,
  max_checkout_integrations: 5,
  max_workspaces: 5,
  max_active_rules: 10,
};

const OLD_PRO_PLAN_ROW = {
  id: 'plan-pro-id',
  plan: 'pro',
  max_sales_monthly: 1000,
};

const OLD_FREE_PLAN_ROW = {
  id: 'plan-free-id',
  plan: 'free',
  max_sales_monthly: 30,
};

const SUBSCRIPTION_PRO = {
  id: 'sub-1',
  plan_id: 'plan-pro-id',
  user_id: 'user-1',
};

const SUBSCRIPTION_FREE = {
  id: 'sub-1',
  plan_id: 'plan-free-id',
  user_id: 'user-1',
};

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('SubscriptionsService', () => {
  let planLimits: { invalidate: jest.Mock };
  let discord: { logApiError: jest.Mock };

  async function buildService(tableQueues: Record<string, TableResponse[]>) {
    planLimits = { invalidate: jest.fn().mockResolvedValue(undefined) };
    discord = { logApiError: jest.fn() };

    const client = makeClient(tableQueues);
    const supabaseMock = { getClient: () => client };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PlanLimitsService, useValue: planLimits },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();

    return module.get(SubscriptionsService);
  }

  // -------------------------------------------------------------------------
  // Test 1: Downgrade Pro → Free trims resources
  // -------------------------------------------------------------------------
  it('downgrade Pro → Free trims workspaces, ad accounts, integrations and rules', async () => {
    const now = new Date().toISOString();
    const oldDate = new Date(Date.now() - 10_000).toISOString();
    const olderDate = new Date(Date.now() - 20_000).toISOString();

    // Workspaces: 3 active. Workspace A has most revenue, B middle, C least.
    const ws = [
      { id: 'ws-a', created_at: now },
      { id: 'ws-b', created_at: oldDate },
      { id: 'ws-c', created_at: olderDate },
    ];

    // Sales: ws-a has 200, ws-b has 100, ws-c has 0.
    const salesForWorkspaces = [
      { workspace_id: 'ws-a', amount: 100 },
      { workspace_id: 'ws-a', amount: 100 },
      { workspace_id: 'ws-b', amount: 100 },
    ];

    // Ad accounts: 2 active (ordered by created_at desc already).
    const adAccounts = [
      { id: 'fb-1' },
      { id: 'fb-2' },
    ];

    // Active workspace IDs (after trim, but service fetches them fresh — same 3 since archived_at
    // filter is applied BEFORE the archive UPDATE, so all 3 come back for steps 5 & 6).
    const activeWsForSteps5and6 = [
      { id: 'ws-a' },
      { id: 'ws-b' },
      { id: 'ws-c' },
    ];

    // Integrations: 2 active.
    const integrations = [
      { id: 'int-1', created_at: now, workspace_id: 'ws-a' },
      { id: 'int-2', created_at: oldDate, workspace_id: 'ws-b' },
    ];

    // Sales for integration counting: int-1 has 2 sales, int-2 has 1.
    const salesForIntegrations = [
      { integration_id: 'int-1' },
      { integration_id: 'int-1' },
      { integration_id: 'int-2' },
    ];

    // Rules: 2 active.
    const rules = [
      { id: 'rule-1', last_executed_at: now, created_at: now },
      { id: 'rule-2', last_executed_at: oldDate, created_at: oldDate },
    ];

    const service = await buildService({
      // Step 1 — parallel: subscriptions[0], plan_rules[0] (new plan)
      subscriptions: [
        { singleRow: SUBSCRIPTION_PRO },   // [0] maybeSingle for user subscription
        { writeError: null },               // [1] update subscription (step 7)
      ],
      plan_rules: [
        { singleRow: FREE_PLAN },           // [0] new plan lookup (parallel)
        { singleRow: OLD_PRO_PLAN_ROW },    // [1] old plan lookup
      ],
      // Step 2 — no unblock (downgrade: new.max_sales_monthly < old.max_sales_monthly)
      // Step 3 — workspace trim
      workspaces: [
        { rows: ws },                       // [0] fetch active workspaces
        { writeError: null },               // [1] archive excess workspaces
        { rows: activeWsForSteps5and6 },    // [2] fetch active workspace IDs for steps 5/6
      ],
      sales: [
        { rows: salesForWorkspaces },       // [0] workspace revenue aggregation
        { rows: salesForIntegrations },     // [1] integration sales count
      ],
      // Step 4 — ad account trim
      facebook_connections: [
        { rows: adAccounts },               // [0] fetch active ad accounts
        { writeError: null },               // [1] deactivate excess
      ],
      // Step 5 — integration trim
      checkout_integrations: [
        { rows: integrations },             // [0] fetch integrations
        { writeError: null },               // [1] deactivate excess
      ],
      // Step 6 — rule trim
      automation_rules: [
        { rows: rules },                    // [0] fetch active rules
        { writeError: null },               // [1] deactivate excess
      ],
      // Step 7 — profile update
      profiles: [
        { writeError: null },               // [0] update profile
      ],
    });

    const result = await service.applyPlanChange('user-1', 'plan-free-id');

    expect(result.trimmed.workspaces).toBe(2);
    expect(result.trimmed.ad_accounts).toBe(1);
    expect(result.trimmed.integrations).toBe(1);
    expect(result.trimmed.rules).toBe(2); // max_active_rules = 0, both rules deactivated
    expect(result.unblocked_sales).toBe(0);
    expect(result.old_plan).toBe('pro');
    expect(result.new_plan).toBe('free');
  });

  // -------------------------------------------------------------------------
  // Test 2: Upgrade Free → Pro unblocks recent blocked sales
  // -------------------------------------------------------------------------
  it('upgrade Free → Pro unblocks recent blocked sales, no trimming', async () => {
    const blockedSales = [
      { id: 'sale-1' },
      { id: 'sale-2' },
      { id: 'sale-3' },
      { id: 'sale-4' },
      { id: 'sale-5' },
    ];

    const service = await buildService({
      subscriptions: [
        { singleRow: SUBSCRIPTION_FREE },  // [0] user subscription
        { writeError: null },              // [1] update subscription (step 7)
      ],
      plan_rules: [
        { singleRow: PRO_PLAN },           // [0] new plan
        { singleRow: OLD_FREE_PLAN_ROW },  // [1] old plan
      ],
      sales: [
        {
          rows: blockedSales,
          updateWithSelect: true,          // update().eq()...select('id') returns rows
        },
        { rows: [] },                      // workspace revenue (no trim needed, max=5 > 0)
        { rows: [] },                      // integration sales count
      ],
      workspaces: [
        { rows: [] },                      // fetch workspaces (0 < 5, no trim)
        { rows: [] },                      // fetch active workspace IDs for steps 5/6
      ],
      facebook_connections: [
        { rows: [] },                      // fetch ad accounts (0 < 5, no trim)
      ],
      checkout_integrations: [
        { rows: [] },                      // fetch integrations (0 < 5, no trim)
      ],
      automation_rules: [
        { rows: [] },                      // fetch rules (0 < 10, no trim)
      ],
      profiles: [
        { writeError: null },              // update profile
      ],
    });

    const result = await service.applyPlanChange('user-1', 'plan-pro-id');

    expect(result.unblocked_sales).toBe(5);
    expect(result.trimmed.workspaces).toBe(0);
    expect(result.trimmed.ad_accounts).toBe(0);
    expect(result.trimmed.integrations).toBe(0);
    expect(result.trimmed.rules).toBe(0);
    expect(result.new_plan).toBe('pro');
    expect(result.old_plan).toBe('free');
    expect(planLimits.invalidate).toHaveBeenCalledWith('user-1');
  });

  // -------------------------------------------------------------------------
  // Test 3: Plan not found throws and logs to Discord
  // -------------------------------------------------------------------------
  it('throws "Plan X not found" when new plan does not exist', async () => {
    const service = await buildService({
      subscriptions: [
        { singleRow: SUBSCRIPTION_FREE },
      ],
      plan_rules: [
        { singleRow: null },               // new plan not found
      ],
    });

    await expect(service.applyPlanChange('user-1', 'bad-plan')).rejects.toThrow(
      'Plan bad-plan not found',
    );
    expect(discord.logApiError).toHaveBeenCalled();
    const callArg = discord.logApiError.mock.calls[0][0];
    expect(callArg.endpoint).toBe('applyPlanChange');
    expect(callArg.userId).toBe('user-1');
    expect(callArg.newPlanId).toBe('bad-plan');
  });

  // -------------------------------------------------------------------------
  // Test 4: Subscription not found throws and logs to Discord
  // -------------------------------------------------------------------------
  it('throws "Subscription not found" when user has no subscription', async () => {
    const service = await buildService({
      subscriptions: [
        { singleRow: null },               // no subscription
      ],
      plan_rules: [
        { singleRow: FREE_PLAN },          // new plan found
      ],
    });

    await expect(service.applyPlanChange('user-no-sub', 'plan-free-id')).rejects.toThrow(
      'Subscription not found for user user-no-sub',
    );
    expect(discord.logApiError).toHaveBeenCalled();
    const callArg = discord.logApiError.mock.calls[0][0];
    expect(callArg.endpoint).toBe('applyPlanChange');
    expect(callArg.userId).toBe('user-no-sub');
  });

  // -------------------------------------------------------------------------
  // Test 5: applyPlanChange uses provided periodStart/periodEnd
  // -------------------------------------------------------------------------
  it('uses provided periodStart/periodEnd when given', async () => {
    const customStart = '2026-05-15T00:00:00.000Z';
    const customEnd   = '2026-06-15T00:00:00.000Z';

    let capturedSubUpdate: any = null;

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: { id: 'sub-1', user_id: 'user-1', plan_id: 'old-plan' },
                error: null,
              }) }) }),
              update: (payload: any) => {
                capturedSubUpdate = payload;
                return { eq: async () => ({ error: null }) };
              },
            };
          }
          if (table === 'plan_rules') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: { id: 'new-plan-id', plan: 'free', max_sales_monthly: 30,
                     max_workspaces: 1, max_active_ad_accounts: 1,
                     max_checkout_integrations: 1, max_active_rules: 0 },
              error: null,
            }) }) }) };
          }
          if (table === 'profiles') {
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          }
          // default no-op resource fetchers — full fluent chain
          const noopBuilder: any = {
            select: (..._a: any[]) => noopBuilder,
            update: (..._a: any[]) => noopBuilder,
            eq: (..._a: any[]) => noopBuilder,
            in: (..._a: any[]) => noopBuilder,
            is: (..._a: any[]) => noopBuilder,
            gte: (..._a: any[]) => noopBuilder,
            order: (..._a: any[]) => noopBuilder,
            maybeSingle: async () => ({ data: null, error: null }),
            then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
          };
          return noopBuilder;
        },
      }),
    };

    const planLimitsMock = { invalidate: jest.fn().mockResolvedValue(undefined) };
    const discordMock = { logApiError: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: PlanLimitsService, useValue: planLimitsMock },
        { provide: DiscordLoggerService, useValue: discordMock },
      ],
    }).compile();

    const svc = module.get(SubscriptionsService);

    await svc.applyPlanChange('user-1', 'new-plan-id', {
      periodStart: customStart,
      periodEnd: customEnd,
    });

    expect(capturedSubUpdate.current_period_start).toBe(customStart);
    expect(capturedSubUpdate.current_period_end).toBe(customEnd);
  });

  // -------------------------------------------------------------------------
  // Scenario 18: Upgrade unblocks only blocked sales within the last 30 days.
  // The service passes a 30-day floor to the WHERE clause; sales older than
  // that are never returned by the update...select('id'), so unblocked_sales
  // reflects only the filter-matching rows.
  // -------------------------------------------------------------------------
  it('upgrade unblocks only blocked sales from the last 30 days', async () => {
    // Queue exactly 30 rows returned by the filtered update — these represent
    // what survived the .gte('sold_at', thirtyDaysAgo) clause.
    const recentBlocked = Array.from({ length: 30 }, (_, i) => ({ id: `sale-recent-${i}` }));

    const service = await buildService({
      subscriptions: [
        { singleRow: SUBSCRIPTION_FREE },
        { writeError: null },
      ],
      plan_rules: [
        { singleRow: PRO_PLAN },
        { singleRow: OLD_FREE_PLAN_ROW },
      ],
      sales: [
        { rows: recentBlocked, updateWithSelect: true },
        { rows: [] },
        { rows: [] },
      ],
      workspaces: [{ rows: [] }, { rows: [] }],
      facebook_connections: [{ rows: [] }],
      checkout_integrations: [{ rows: [] }],
      automation_rules: [{ rows: [] }],
      profiles: [{ writeError: null }],
    });

    const result = await service.applyPlanChange('user-1', 'plan-pro-id');
    expect(result.unblocked_sales).toBe(30);
  });

  // -------------------------------------------------------------------------
  // Scenario 20: Pro→Free with zero-revenue workspaces falls back to the
  // created_at DESC tiebreaker; the newest workspace survives.
  // -------------------------------------------------------------------------
  it('downgrade with zero-revenue workspaces archives by created_at-desc tiebreak', async () => {
    const ws = [
      { id: 'ws-old',    created_at: '2026-01-01T00:00:00Z' },
      { id: 'ws-middle', created_at: '2026-02-01T00:00:00Z' },
      { id: 'ws-new',    created_at: '2026-03-01T00:00:00Z' },
    ];

    let capturedArchiveIds: string[] | null = null;

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            const subCalls: any[] = [{ singleRow: SUBSCRIPTION_PRO }];
            let idx = 0;
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: subCalls[idx++]?.singleRow ?? null, error: null,
              }) }) }),
              update: () => ({ eq: async () => ({ error: null }) }),
            };
          }
          if (table === 'plan_rules') {
            const queue = [{ singleRow: FREE_PLAN }, { singleRow: OLD_PRO_PLAN_ROW }];
            let idx = 0;
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: queue[idx++]?.singleRow ?? null, error: null,
              }) }) }),
            };
          }
          if (table === 'workspaces') {
            let wsFetch = 0;
            return {
              select: () => ({
                eq: () => ({
                  is: () => ({
                    then: (resolve: any) => {
                      const rows = wsFetch++ === 0 ? ws : [{ id: 'ws-new' }];
                      return Promise.resolve({ data: rows, error: null }).then(resolve);
                    },
                  }),
                }),
              }),
              update: () => ({
                in: async (_col: string, ids: string[]) => {
                  capturedArchiveIds = ids;
                  return { error: null };
                },
              }),
            };
          }
          if (table === 'sales') {
            // Empty revenue (zero-revenue scenario)
            const noopBuilder: any = {
              select: () => noopBuilder,
              eq: () => noopBuilder,
              gte: () => noopBuilder,
              then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
            };
            return noopBuilder;
          }
          const noop: any = {
            select: () => noop, update: () => noop, eq: () => noop, in: () => noop,
            is: () => noop, gte: () => noop, order: () => noop,
            maybeSingle: async () => ({ data: null, error: null }),
            then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
          };
          return noop;
        },
      }),
    };

    const planLimitsMock = { invalidate: jest.fn() };
    const discordMock = { logApiError: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: PlanLimitsService, useValue: planLimitsMock },
        { provide: DiscordLoggerService, useValue: discordMock },
      ],
    }).compile();

    const svc = module.get(SubscriptionsService);
    await svc.applyPlanChange('user-1', 'plan-free-id');

    // With zero revenue, sort order is created_at DESC — ws-new survives,
    // ws-old and ws-middle are archived.
    expect(capturedArchiveIds).toEqual(['ws-middle', 'ws-old']);
  });

  // -------------------------------------------------------------------------
  // Scenario 24: Pro→Enterprise upgrade skips every trim step but still
  // unblocks recent blocked sales (max_sales_monthly -1 unblocks everything).
  // -------------------------------------------------------------------------
  it('Pro→Enterprise upgrade skips trims and unblocks blocked sales', async () => {
    const ENTERPRISE_PLAN = {
      id: 'plan-enterprise-id', plan: 'enterprise',
      max_sales_monthly: -1,
      max_active_ad_accounts: -1, max_checkout_integrations: -1,
      max_workspaces: -1, max_active_rules: -1,
    };
    const blockedSales = Array.from({ length: 10 }, (_, i) => ({ id: `sale-${i}` }));

    const service = await buildService({
      subscriptions: [
        { singleRow: SUBSCRIPTION_PRO },
        { writeError: null },
      ],
      plan_rules: [
        { singleRow: ENTERPRISE_PLAN },
        { singleRow: OLD_PRO_PLAN_ROW },
      ],
      sales: [
        { rows: blockedSales, updateWithSelect: true },
      ],
      workspaces: [{ rows: [] }, { rows: [] }],
      facebook_connections: [{ rows: [] }],
      checkout_integrations: [{ rows: [] }],
      automation_rules: [{ rows: [] }],
      profiles: [{ writeError: null }],
    });

    const result = await service.applyPlanChange('user-1', 'plan-enterprise-id');
    expect(result.unblocked_sales).toBe(10);
    expect(result.trimmed).toEqual({ workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0 });
    expect(result.old_plan).toBe('pro');
    expect(result.new_plan).toBe('enterprise');
  });

  // -------------------------------------------------------------------------
  // Scenario 25: Pro→Pro same plan — no unblock (new max is not > old max),
  // no trims (counts equal limits), but step 7 still restarts the period
  // and clears any scheduled change.
  // -------------------------------------------------------------------------
  it('Pro→Pro same plan runs all steps with zero effect but restarts period', async () => {
    let capturedSubUpdate: any = null;

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: SUBSCRIPTION_PRO, error: null,
              }) }) }),
              update: (payload: any) => {
                capturedSubUpdate = payload;
                return { eq: async () => ({ error: null }) };
              },
            };
          }
          if (table === 'plan_rules') {
            const queue = [{ singleRow: PRO_PLAN }, { singleRow: OLD_PRO_PLAN_ROW }];
            let idx = 0;
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: queue[idx++]?.singleRow ?? null, error: null,
              }) }) }),
            };
          }
          if (table === 'profiles') {
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          }
          const noop: any = {
            select: () => noop, update: () => noop, eq: () => noop, in: () => noop,
            is: () => noop, gte: () => noop, order: () => noop,
            maybeSingle: async () => ({ data: null, error: null }),
            then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
          };
          return noop;
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: PlanLimitsService, useValue: { invalidate: jest.fn() } },
        { provide: DiscordLoggerService, useValue: { logApiError: jest.fn() } },
      ],
    }).compile();

    const svc = module.get(SubscriptionsService);
    const result = await svc.applyPlanChange('user-1', 'plan-pro-id');

    expect(result.unblocked_sales).toBe(0);
    expect(result.trimmed).toEqual({ workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0 });
    expect(capturedSubUpdate).toMatchObject({
      plan_id: 'plan-pro-id',
      current_period_start: expect.any(String),
      current_period_end: expect.any(String),
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 28: Step-3 failure (archiveExcessWorkspaces writeError) leaves
  // the subscription.plan_id untouched — the ordering invariant.
  // -------------------------------------------------------------------------
  it('step 3 failure does not flip subscription.plan_id', async () => {
    let subscriptionUpdateCalled = false;

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: SUBSCRIPTION_PRO, error: null,
              }) }) }),
              update: () => {
                subscriptionUpdateCalled = true;
                return { eq: async () => ({ error: null }) };
              },
            };
          }
          if (table === 'plan_rules') {
            const queue = [{ singleRow: FREE_PLAN }, { singleRow: OLD_PRO_PLAN_ROW }];
            let idx = 0;
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: queue[idx++]?.singleRow ?? null, error: null,
              }) }) }),
            };
          }
          if (table === 'workspaces') {
            return {
              select: () => ({ eq: () => ({ is: () => ({
                then: (r: any) => Promise.resolve({
                  data: [{ id: 'ws-1', created_at: '2026-01-01' }, { id: 'ws-2', created_at: '2026-02-01' }],
                  error: null,
                }).then(r),
              }) }) }),
              update: () => ({
                in: async () => ({ error: { message: 'archive failed' } }),
              }),
            };
          }
          if (table === 'sales') {
            const noop: any = {
              select: () => noop, eq: () => noop, gte: () => noop,
              then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
            };
            return noop;
          }
          if (table === 'profiles') {
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          }
          const noop: any = {
            select: () => noop, update: () => noop, eq: () => noop, in: () => noop,
            is: () => noop, gte: () => noop, order: () => noop,
            maybeSingle: async () => ({ data: null, error: null }),
            then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
          };
          return noop;
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: PlanLimitsService, useValue: { invalidate: jest.fn() } },
        { provide: DiscordLoggerService, useValue: { logApiError: jest.fn() } },
      ],
    }).compile();

    const svc = module.get(SubscriptionsService);
    await expect(svc.applyPlanChange('user-1', 'plan-free-id')).rejects.toMatchObject({
      message: 'archive failed',
    });
    // Subscription update (step 7) must not have run.
    expect(subscriptionUpdateCalled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Scenario 30: scheduled_plan_id and scheduled_changes_at are cleared
  // on every successful plan change (regardless of whether they were set).
  // -------------------------------------------------------------------------
  it('clears scheduled_plan_id and scheduled_changes_at on success', async () => {
    let capturedSubUpdate: any = null;

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: SUBSCRIPTION_FREE, error: null,
              }) }) }),
              update: (payload: any) => {
                capturedSubUpdate = payload;
                return { eq: async () => ({ error: null }) };
              },
            };
          }
          if (table === 'plan_rules') {
            const queue = [{ singleRow: PRO_PLAN }, { singleRow: OLD_FREE_PLAN_ROW }];
            let idx = 0;
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: queue[idx++]?.singleRow ?? null, error: null,
              }) }) }),
            };
          }
          if (table === 'profiles') {
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          }
          const noop: any = {
            select: () => noop, update: () => noop, eq: () => noop, in: () => noop,
            is: () => noop, gte: () => noop, order: () => noop,
            maybeSingle: async () => ({ data: null, error: null }),
            then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
          };
          return noop;
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: PlanLimitsService, useValue: { invalidate: jest.fn() } },
        { provide: DiscordLoggerService, useValue: { logApiError: jest.fn() } },
      ],
    }).compile();

    const svc = module.get(SubscriptionsService);
    await svc.applyPlanChange('user-1', 'plan-pro-id');
    expect(capturedSubUpdate).toMatchObject({
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Invalidates planLimits cache on success
  // -------------------------------------------------------------------------
  it('invalidates planLimits cache after successful plan change', async () => {
    const service = await buildService({
      subscriptions: [
        { singleRow: SUBSCRIPTION_FREE },
        { writeError: null },
      ],
      plan_rules: [
        { singleRow: PRO_PLAN },
        { singleRow: OLD_FREE_PLAN_ROW },
      ],
      sales: [
        { rows: [], updateWithSelect: true },
        { rows: [] },
        { rows: [] },
      ],
      workspaces: [
        { rows: [] },
        { rows: [] },
      ],
      facebook_connections: [{ rows: [] }],
      checkout_integrations: [{ rows: [] }],
      automation_rules: [{ rows: [] }],
      profiles: [{ writeError: null }],
    });

    await service.applyPlanChange('user-1', 'plan-pro-id');
    expect(planLimits.invalidate).toHaveBeenCalledTimes(1);
    expect(planLimits.invalidate).toHaveBeenCalledWith('user-1');
  });
});
