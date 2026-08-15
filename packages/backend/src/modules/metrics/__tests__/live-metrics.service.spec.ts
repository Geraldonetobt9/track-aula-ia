import { Test, TestingModule } from '@nestjs/testing';
import { LiveMetricsService } from '../live-metrics.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { SaleMatcherService } from '../../facebook/sale-matcher.service';

type FromCall = { table: string; filters: string[] };

describe('LiveMetricsService.getDashboardData — consolidated contract', () => {
  let service: LiveMetricsService;
  let fromCalls: FromCall[];
  let rpcMock: jest.Mock;

  const userId = 'user-1';
  const workspaceId = '00000000-0000-0000-0000-000000000001';

  // Fixture: 3 approved sales + 1 refunded in period.
  // Pre-sorted DESC by sold_at (then id) to match the production query's ORDER BY —
  // the mock builder's `.order()` is a no-op, so the fixture order is authoritative.
  const salesInPeriod = [
    { id: 's4', amount: '30',  status: 'refunded', sold_at: '2026-04-11T11:00:00Z', product_name: 'A', customer_state: 'SP' },
    { id: 's3', amount: '200', status: 'approved', sold_at: '2026-04-11T10:00:00Z', product_name: 'B', customer_state: 'RJ' },
    { id: 's2', amount: '50',  status: 'approved', sold_at: '2026-04-10T15:00:00Z', product_name: 'A', customer_state: 'SP' },
    { id: 's1', amount: '100', status: 'approved', sold_at: '2026-04-10T12:00:00Z', product_name: 'A', customer_state: 'SP' },
  ];
  const lifetimeSales = [
    { amount: '100' }, { amount: '50' }, { amount: '200' }, { amount: '999' },
  ];

  beforeEach(async () => {
    fromCalls = [];

    // Track which query is being built. The service calls .from('sales') twice:
    // once for period (with gte/lt date filters) and once for lifetime (with status=approved, no date).
    // Use the presence of date filters to distinguish.
    const makeBuilder = (table: string) => {
      const filters: string[] = [];
      const record = () => fromCalls.push({ table, filters });
      let recorded = false;
      const recordOnce = () => { if (!recorded) { record(); recorded = true; } };

      const builder: any = {
        select: () => { recordOnce(); return builder; },
        eq: (col: string, _val: any) => { filters.push(`eq:${col}`); return builder; },
        in: (col: string, _vals: any) => { filters.push(`in:${col}`); return builder; },
        gte: (col: string) => { filters.push(`gte:${col}`); return builder; },
        lt: (col: string) => { filters.push(`lt:${col}`); return builder; },
        lte: (col: string) => { filters.push(`lte:${col}`); return builder; },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: { id: workspaceId }, error: null }),
        then: (resolve: (v: any) => void) => {
          if (table === 'sales') {
            const hasDate = filters.some((f) => f.startsWith('gte:') || f.startsWith('lt:'));
            resolve({ data: hasDate ? salesInPeriod : lifetimeSales, error: null });
          } else if (table === 'daily_ad_spend') {
            resolve({ data: [], error: null });   // Task 2 may or may not use this table
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
      return builder;
    };

    // Aggregation moved into the dashboard_metrics RPC, so the canned response
    // mirrors what Postgres would return for the fixtures above.
    rpcMock = jest.fn().mockResolvedValue({
      data: {
        gross_revenue: 350,
        sales_count: 3,
        lifetime_revenue: 1349,
        chart_data: [
          { date: '2026-04-10', revenue: 150 },
          { date: '2026-04-11', revenue: 200 },
        ],
        regions: [
          { state: 'SP', sales: 2, revenue: 150 },
          { state: 'RJ', sales: 1, revenue: 200 },
        ],
        recent_sales: salesInPeriod
          .filter((s) => s.status === 'approved')
          .map((s) => ({
            id: s.id,
            product_name: s.product_name,
            sold_at: s.sold_at,
            amount: Number(s.amount),
          })),
      },
      error: null,
    });

    const supabaseMock: Partial<SupabaseService> = {
      getClient: () =>
        ({ from: (t: string) => makeBuilder(t), rpc: rpcMock }) as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveMetricsService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: EncryptionService, useValue: { decrypt: jest.fn(), encrypt: jest.fn(), decryptIfNeeded: jest.fn((v: string) => v) } },
        { provide: SaleMatcherService, useValue: { rematchSales: jest.fn() } },
      ],
    }).compile();

    service = module.get(LiveMetricsService);

    // Bypass Facebook path: no active connections.
    // This makes fetchAllConnectionsDailyInsights not be called; adSpend = 0.
    jest.spyOn(service as any, 'getActiveConnections').mockResolvedValue([]);
  });

  it('returns exactly the 5 top-level keys of the consolidated shape', async () => {
    // Cast to any so TS does not block Jest from running the assertion against
    // the real runtime shape (which currently returns { sales, daily_spend }).
    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);

    expect(Object.keys(r).sort()).toEqual([
      'chartData', 'lifetimeRevenue', 'metrics', 'recentSales', 'regions',
    ]);
  });

  it('metrics has exactly 8 number fields (no *Change, no dead fields)', async () => {
    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);

    expect(Object.keys(r.metrics).sort()).toEqual([
      'adSpend', 'adSpendTax', 'adSpendTaxPercentage',
      'cpa', 'grossRevenue', 'netRevenue', 'roas', 'salesCount',
    ]);
    for (const v of Object.values(r.metrics)) expect(typeof v).toBe('number');
  });

  it('aggregates metrics correctly (no refunded sales leak in)', async () => {
    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);

    // With no connections, adSpend must be 0 in the empty-connections path.
    expect(r.metrics.grossRevenue).toBe(350);          // 100 + 50 + 200
    expect(r.metrics.salesCount).toBe(3);
    expect(r.metrics.adSpend).toBe(0);
    expect(r.metrics.netRevenue).toBe(350);            // 350 - 0
    expect(r.metrics.roas).toBe(0);                    // div by zero → 0
    expect(r.metrics.cpa).toBe(0);                     // adSpend 0 / salesCount 3
  });

  it('chartData is sorted asc by date, approved-only revenue per day', async () => {
    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);

    expect(r.chartData).toEqual([
      { date: '2026-04-10', revenue: 150, spend: 0 },
      { date: '2026-04-11', revenue: 200, spend: 0 },
    ]);
  });

  it('regions groups approved by customer_state with percentage summing to 100', async () => {
    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);

    const sp = r.regions.find((x: any) => x.state === 'SP');
    const rj = r.regions.find((x: any) => x.state === 'RJ');
    expect(sp).toMatchObject({ state: 'SP', sales: 2, revenue: 150 });
    expect(rj).toMatchObject({ state: 'RJ', sales: 1, revenue: 200 });
    expect(sp!.percentage + rj!.percentage).toBeCloseTo(100, 1);
  });

  it('lifetimeRevenue aggregates approved sales across all time (no date filter)', async () => {
    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);
    expect(r.lifetimeRevenue).toBe(1349);  // 100 + 50 + 200 + 999
  });

  it('recentSales returns up to 9 approved sales with exactly 4 fields, sorted desc by sold_at', async () => {
    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);
    expect(r.recentSales.length).toBeLessThanOrEqual(9);
    expect(r.recentSales.length).toBe(3);  // 3 approved in fixture
    for (const s of r.recentSales) {
      expect(Object.keys(s).sort()).toEqual(['amount', 'id', 'product_name', 'sold_at']);
    }
    // Ordered by sold_at desc: s3 (04-11), s2 (04-10 15:00), s1 (04-10 12:00)
    expect(r.recentSales.map((s: any) => s.id)).toEqual(['s3', 's2', 's1']);
    // Refunded s4 must not appear
    expect(r.recentSales.map((s: any) => s.id)).not.toContain('s4');
  });

  // Period and lifetime totals used to be two row-scanning queries against
  // `sales`; both now come back from a single RPC round trip.
  it('aggregates through the dashboard_metrics RPC instead of scanning sales', async () => {
    await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      'dashboard_metrics',
      expect.objectContaining({ p_user_id: userId, p_workspace_id: workspaceId }),
    );
    expect(fromCalls.filter((c) => c.table === 'sales')).toHaveLength(0);
  });

  // Regression: a broken/revoked Facebook connection used to throw from the
  // Graph API call, which blew up the whole Promise.all in getDashboardData
  // and forced the frontend into EMPTY_RESPONSE — showing R$ 0,00 across the
  // board (including sales that don't depend on the FB integration at all).
  it('getDashboardData still returns sales when the Facebook spend fetch fails', async () => {
    jest.spyOn(service as any, 'getActiveConnections').mockResolvedValue([
      { id: 'conn-broken', access_token: 'tok', ad_account_id: 'act_broken' },
    ]);
    jest.spyOn(service as any, 'fetchDailyInsightsFromFacebook').mockRejectedValue(
      new Error('OAuthException: Cannot call API on behalf of user'),
    );

    const r = await (service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    }) as Promise<any>);

    expect(r.metrics.grossRevenue).toBe(350);
    expect(r.metrics.salesCount).toBe(3);
    expect(r.metrics.adSpend).toBe(0);
    expect(r.recentSales).toHaveLength(3);
    expect(r.lifetimeRevenue).toBe(1349);
  });

  it('fetchAllConnectionsDailyInsights keeps results from healthy connections and skips the broken ones', async () => {
    const fetchSpy = jest
      .spyOn(service as any, 'fetchDailyInsightsFromFacebook')
      .mockImplementationOnce(() =>
        Promise.resolve([{ date: '2026-04-10', spend: 100, campaign_id: 'c1' }]),
      )
      .mockImplementationOnce(() => Promise.reject(new Error('OAuthException')));

    const connections = [
      { id: 'conn-good', access_token: 'tok-a', ad_account_id: 'act_good' },
      { id: 'conn-bad', access_token: 'tok-b', ad_account_id: 'act_bad' },
    ];
    const result = await (service as any).fetchAllConnectionsDailyInsights(
      connections,
      '2026-04-10',
      '2026-04-10',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].spend).toBe(100);
  });
});
