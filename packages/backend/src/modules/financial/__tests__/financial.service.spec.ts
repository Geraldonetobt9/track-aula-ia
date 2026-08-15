import { Test, TestingModule } from '@nestjs/testing';
import { FinancialService } from '../financial.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { LiveMetricsService } from '../../metrics/live-metrics.service';

type FromCall = { table: string; columns?: string };

describe('FinancialService.getSummary — slim contract', () => {
  let service: FinancialService;
  let fromCalls: FromCall[];
  let liveMetrics: {
    aggregateAdSpend: jest.Mock;
    getAdSpendTaxPercentage: jest.Mock;
    resolveAllTimeStart: jest.Mock;
  };
  let rpcMock: jest.Mock;

  const userId = 'user-1';
  const workspaceId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    fromCalls = [];

    // Minimal query builder: records the table+columns touched and
    // returns a thenable that resolves to the canned data per table.
    const makeBuilder = (table: string) => {
      const builder: any = {
        select: (cols: string) => {
          fromCalls.push({ table, columns: cols });
          return builder;
        },
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === 'workspaces') {
            return { data: { id: workspaceId }, error: null };
          }
          if (table === 'sales') {
            return { data: { sold_at: '2026-01-15T00:00:00.000Z' }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: any) => void) => {
          if (table === 'sales') {
            resolve({ data: [{ amount: '100' }, { amount: '250' }], error: null });
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
      return builder;
    };

    // Revenue comes from the dashboard_metrics RPC, not a row scan.
    rpcMock = jest.fn().mockResolvedValue({
      data: { gross_revenue: 350 },
      error: null,
    });

    const supabaseMock: Partial<SupabaseService> = {
      getClient: () =>
        ({
          from: (table: string) => makeBuilder(table),
          rpc: rpcMock,
        }) as any,
    };

    liveMetrics = {
      aggregateAdSpend: jest.fn().mockResolvedValue({
        total: 125,
        byDate: new Map([['2026-04-01', 50], ['2026-04-02', 75]]),
      }),
      getAdSpendTaxPercentage: jest.fn().mockResolvedValue(10),
      // Lives on LiveMetricsService so /financial and /dashboard answer
      // "todo período" with the same window.
      resolveAllTimeStart: jest.fn().mockResolvedValue('2026-01-15'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: LiveMetricsService, useValue: liveMetrics },
      ],
    }).compile();

    service = module.get(FinancialService);
  });

  // The Meta Ads tax (a percentage over ad spend) is computed here. The tax the
  // user types by hand lives in financial_entries and never reaches this call.
  it('returns revenue, ad spend and the Meta Ads tax derived from it', async () => {
    const result = await service.getSummary(userId, workspaceId);

    expect(Object.keys(result).sort()).toEqual([
      'adSpend',
      'adSpendTax',
      'adSpendTaxPercentage',
      'grossRevenue',
    ]);
    expect(result.grossRevenue).toBe(350);
    expect(result.adSpend).toBe(125);
    expect(result.adSpendTaxPercentage).toBe(10);
    expect(result.adSpendTax).toBe(12.5);
  });

  it('aggregates revenue through the RPC instead of scanning rows', async () => {
    await service.getSummary(userId, workspaceId);

    expect(rpcMock).toHaveBeenCalledWith('dashboard_metrics', expect.objectContaining({
      p_user_id: userId,
      p_workspace_id: workspaceId,
    }));
  });

  it('does not query financial_entries or company_costs', async () => {
    await service.getSummary(userId, workspaceId);

    const tablesTouched = fromCalls.map((c) => c.table);
    expect(tablesTouched).not.toContain('financial_entries');
    expect(tablesTouched).not.toContain('company_costs');
    expect(tablesTouched).toContain('workspaces'); // ownership check
  });

  it('forwards reference_month to sales range and live metrics', async () => {
    await service.getSummary(userId, workspaceId, { referenceMonth: '2026-04-01' });

    expect(liveMetrics.aggregateAdSpend).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        workspace_id: workspaceId,
        from: '2026-04-01',
        to: '2026-04-30',
      }),
    );
  });

  it('forwards an explicit from/to range untouched', async () => {
    await service.getSummary(userId, workspaceId, { from: '2026-01-01', to: '2026-12-31' });

    expect(liveMetrics.aggregateAdSpend).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        workspace_id: workspaceId,
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    );
  });

  it('anchors ad spend on the first sale when the range is unbounded', async () => {
    // Without this, aggregateAdSpend falls back to the last 30 days and gets
    // paired with all-time revenue.
    await service.getSummary(userId, workspaceId);

    expect(liveMetrics.resolveAllTimeStart).toHaveBeenCalledWith(userId, workspaceId);
    expect(liveMetrics.aggregateAdSpend).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        workspace_id: workspaceId,
        from: '2026-01-15',
        to: undefined,
      }),
    );
  });

  it('does not resolve an all-time start when the range is explicit', async () => {
    await service.getSummary(userId, workspaceId, { from: '2026-03-01', to: '2026-03-31' });

    expect(liveMetrics.resolveAllTimeStart).not.toHaveBeenCalled();
  });
});
