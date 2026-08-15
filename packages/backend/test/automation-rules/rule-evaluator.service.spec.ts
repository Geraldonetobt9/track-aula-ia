import { Test, TestingModule } from '@nestjs/testing';
import { RuleEvaluatorService } from '../../src/modules/automation-rules/rule-evaluator.service';
import { LiveMetricsService } from '../../src/modules/metrics/live-metrics.service';

describe('RuleEvaluatorService', () => {
  let service: RuleEvaluatorService;
  let liveMetrics: jest.Mocked<LiveMetricsService>;

  const USER_ID = 'user-uuid-1';
  const WORKSPACE_ID = 'workspace-uuid-1';

  const baseRule = {
    id: 'rule-uuid-1',
    workspace_id: WORKSPACE_ID,
    connection_id: null,
    target_entity: 'campaign',
    target_status: 'any',
    name_filter: null,
    evaluation_period: 'today',
    custom_start_date: null,
  };

  const makeCampaign = (overrides: Record<string, any> = {}): any => ({
    id: 'camp-1',
    name: 'Test Campaign',
    status: 'ACTIVE',
    spend: 100,
    cpa_real: 10,
    roi: 1.5,
    roas: 2.0,
    cpc: 0.5,
    ctr: 3.0,
    cpm: 5.0,
    impressions: 1000,
    clicks: 30,
    conversions: 10,
    revenue: 200,
    sales: 10,
    daily_budget: 50,
    lifetime_budget: 0,
    facebook_connection_id: 'conn-1',
    ...overrides,
  });

  beforeEach(async () => {
    const liveMetricsMock: Partial<jest.Mocked<LiveMetricsService>> = {
      getCampaigns: jest.fn(),
      getAdSets: jest.fn(),
      getAds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuleEvaluatorService,
        { provide: LiveMetricsService, useValue: liveMetricsMock },
      ],
    }).compile();

    service = module.get<RuleEvaluatorService>(RuleEvaluatorService);
    liveMetrics = module.get(LiveMetricsService);
  });

  describe('AND logic — all conditions must match', () => {
    it('returns entities that satisfy all conditions', async () => {
      const campaign = makeCampaign({ spend: 150, ctr: 4.0 });
      liveMetrics.getCampaigns.mockResolvedValue([campaign]);

      const conditions = [
        { metric: 'spend', operator: 'gt', value: 100 },
        { metric: 'ctr', operator: 'gte', value: 4.0 },
      ];

      const result = await service.evaluate(USER_ID, baseRule, conditions);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('camp-1');
      expect(result[0].metricsSnapshot.spend).toBe(150);
      expect(result[0].metricsSnapshot.ctr).toBe(4.0);
    });

    it('excludes entities that fail any single condition', async () => {
      const campaign = makeCampaign({ spend: 150, ctr: 2.0 }); // ctr fails
      liveMetrics.getCampaigns.mockResolvedValue([campaign]);

      const conditions = [
        { metric: 'spend', operator: 'gt', value: 100 },
        { metric: 'ctr', operator: 'gte', value: 4.0 },
      ];

      const result = await service.evaluate(USER_ID, baseRule, conditions);
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no entities match all conditions', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([
        makeCampaign({ spend: 50 }), // spend fails gt 100
        makeCampaign({ id: 'camp-2', spend: 200, ctr: 1.0 }), // ctr fails
      ]);

      const conditions = [
        { metric: 'spend', operator: 'gt', value: 100 },
        { metric: 'ctr', operator: 'gt', value: 3.0 },
      ];

      const result = await service.evaluate(USER_ID, baseRule, conditions);
      expect(result).toHaveLength(0);
    });
  });

  describe('target_status filter', () => {
    it('includes entities whose status matches target_status', async () => {
      const active = makeCampaign({ id: 'camp-active', status: 'ACTIVE', spend: 200 });
      const paused = makeCampaign({ id: 'camp-paused', status: 'PAUSED', spend: 200 });
      liveMetrics.getCampaigns.mockResolvedValue([active, paused]);

      const rule = { ...baseRule, target_status: 'ACTIVE' };
      const result = await service.evaluate(USER_ID, rule, [{ metric: 'spend', operator: 'gt', value: 100 }]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('camp-active');
    });

    it('includes all entities when target_status is "any"', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([
        makeCampaign({ id: 'camp-1', status: 'ACTIVE', spend: 200 }),
        makeCampaign({ id: 'camp-2', status: 'PAUSED', spend: 200 }),
      ]);

      const rule = { ...baseRule, target_status: 'any' };
      const result = await service.evaluate(USER_ID, rule, [{ metric: 'spend', operator: 'gt', value: 100 }]);

      expect(result).toHaveLength(2);
    });

    it('returns empty when no entity has the required status', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([
        makeCampaign({ status: 'PAUSED', spend: 200 }),
      ]);

      const rule = { ...baseRule, target_status: 'ACTIVE' };
      const result = await service.evaluate(USER_ID, rule, [{ metric: 'spend', operator: 'gt', value: 100 }]);

      expect(result).toHaveLength(0);
    });
  });

  describe('name_filter (case-insensitive contains)', () => {
    it('matches entities whose name contains the filter string (case-insensitive)', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([
        makeCampaign({ id: 'camp-1', name: 'Black Friday Sale', spend: 200 }),
        makeCampaign({ id: 'camp-2', name: 'Summer Promo', spend: 200 }),
      ]);

      const rule = { ...baseRule, name_filter: 'black friday' };
      const result = await service.evaluate(USER_ID, rule, [{ metric: 'spend', operator: 'gt', value: 100 }]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('camp-1');
    });

    it('is case-insensitive for both entity name and filter', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([
        makeCampaign({ name: 'RETARGETING SUMMER', spend: 200 }),
      ]);

      const rule = { ...baseRule, name_filter: 'retargeting' };
      const result = await service.evaluate(USER_ID, rule, [{ metric: 'spend', operator: 'gt', value: 100 }]);

      expect(result).toHaveLength(1);
    });

    it('excludes entities whose name does not contain the filter', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([
        makeCampaign({ name: 'Summer Promo', spend: 200 }),
      ]);

      const rule = { ...baseRule, name_filter: 'winter' };
      const result = await service.evaluate(USER_ID, rule, [{ metric: 'spend', operator: 'gt', value: 100 }]);

      expect(result).toHaveLength(0);
    });

    it('skips name filtering when name_filter is null', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([
        makeCampaign({ name: 'Anything', spend: 200 }),
      ]);

      const rule = { ...baseRule, name_filter: null };
      const result = await service.evaluate(USER_ID, rule, [{ metric: 'spend', operator: 'gt', value: 100 }]);

      expect(result).toHaveLength(1);
    });
  });

  describe('metrics snapshot', () => {
    it('includes all expected metric keys in the snapshot', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([makeCampaign()]);

      const result = await service.evaluate(USER_ID, baseRule, [{ metric: 'spend', operator: 'gt', value: 50 }]);

      expect(result[0].metricsSnapshot).toMatchObject({
        spend: 100,
        cpa: 10,
        roi: 1.5,
        roas: 2.0,
        cpc: 0.5,
        ctr: 3.0,
        cpm: 5.0,
        impressions: 1000,
        clicks: 30,
        conversions: 10,
        revenue: 200,
        sales: 10,
        daily_budget: 50,
        lifetime_budget: 0,
      });
    });

    it('defaults missing numeric fields to 0 in the snapshot', async () => {
      const campaign = makeCampaign({ roi: undefined, profit: undefined });
      liveMetrics.getCampaigns.mockResolvedValue([campaign]);

      const result = await service.evaluate(USER_ID, baseRule, [{ metric: 'spend', operator: 'gt', value: 50 }]);

      expect(result[0].metricsSnapshot.roi).toBe(0);
    });
  });

  describe('entity type routing', () => {
    it('calls getCampaigns for target_entity = campaign', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([]);
      await service.evaluate(USER_ID, { ...baseRule, target_entity: 'campaign' }, []);
      expect(liveMetrics.getCampaigns).toHaveBeenCalledTimes(1);
      expect(liveMetrics.getAdSets).not.toHaveBeenCalled();
    });

    it('calls getAdSets for target_entity = adset', async () => {
      liveMetrics.getAdSets.mockResolvedValue([]);
      await service.evaluate(USER_ID, { ...baseRule, target_entity: 'adset' }, []);
      expect(liveMetrics.getAdSets).toHaveBeenCalledTimes(1);
    });

    it('calls getAds for target_entity = ad', async () => {
      liveMetrics.getAds.mockResolvedValue([]);
      await service.evaluate(USER_ID, { ...baseRule, target_entity: 'ad' }, []);
      expect(liveMetrics.getAds).toHaveBeenCalledTimes(1);
    });

    it('returns empty array for unknown target_entity', async () => {
      const result = await service.evaluate(USER_ID, { ...baseRule, target_entity: 'unknown' }, []);
      expect(result).toHaveLength(0);
      expect(liveMetrics.getCampaigns).not.toHaveBeenCalled();
    });
  });

  describe('connection_id filter', () => {
    it('passes connection_ids to the live metrics service when connection_id is set', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([]);
      const rule = { ...baseRule, connection_id: 'conn-uuid-1' };
      await service.evaluate(USER_ID, rule, []);
      expect(liveMetrics.getCampaigns).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ connection_ids: ['conn-uuid-1'] }),
      );
    });

    it('does not include connection_ids when connection_id is null', async () => {
      liveMetrics.getCampaigns.mockResolvedValue([]);
      await service.evaluate(USER_ID, { ...baseRule, connection_id: null }, []);
      expect(liveMetrics.getCampaigns).toHaveBeenCalledWith(
        USER_ID,
        expect.not.objectContaining({ connection_ids: expect.anything() }),
      );
    });
  });

  describe('operator comparisons', () => {
    const runOperatorTest = async (operator: string, entityValue: number, threshold: number) => {
      liveMetrics.getCampaigns.mockResolvedValue([makeCampaign({ spend: entityValue })]);
      return service.evaluate(USER_ID, baseRule, [{ metric: 'spend', operator, value: threshold }]);
    };

    it('gt: matches when actual > threshold', async () => {
      expect(await runOperatorTest('gt', 101, 100)).toHaveLength(1);
      expect(await runOperatorTest('gt', 100, 100)).toHaveLength(0);
    });

    it('lt: matches when actual < threshold', async () => {
      expect(await runOperatorTest('lt', 99, 100)).toHaveLength(1);
      expect(await runOperatorTest('lt', 100, 100)).toHaveLength(0);
    });

    it('gte: matches when actual >= threshold', async () => {
      expect(await runOperatorTest('gte', 100, 100)).toHaveLength(1);
      expect(await runOperatorTest('gte', 99, 100)).toHaveLength(0);
    });

    it('lte: matches when actual <= threshold', async () => {
      expect(await runOperatorTest('lte', 100, 100)).toHaveLength(1);
      expect(await runOperatorTest('lte', 101, 100)).toHaveLength(0);
    });

    it('unknown operator always returns false (no match)', async () => {
      expect(await runOperatorTest('eq', 100, 100)).toHaveLength(0);
    });
  });
});
