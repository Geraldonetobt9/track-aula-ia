import { Test, TestingModule } from '@nestjs/testing';
import { RuleExecutorService } from '../../src/modules/automation-rules/rule-executor.service';
import { FacebookService } from '../../src/modules/facebook/facebook.service';

describe('RuleExecutorService', () => {
  let service: RuleExecutorService;
  let facebook: jest.Mocked<FacebookService>;

  const USER_ID = 'user-uuid-1';

  const makeEntity = (overrides: Record<string, any> = {}) => ({
    id: 'camp-1',
    name: 'Test Campaign',
    ad_account_id: 'act_123',
    metricsSnapshot: {
      spend: 100,
      daily_budget: 100,
      lifetime_budget: 0,
      ctr: 3.0,
      cpa: 10,
      roas: 2.0,
    },
    ...overrides,
  });

  beforeEach(async () => {
    const facebookMock: Partial<jest.Mocked<FacebookService>> = {
      updateStatus: jest.fn().mockResolvedValue({ success: true }),
      updateBudget: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuleExecutorService,
        { provide: FacebookService, useValue: facebookMock },
      ],
    }).compile();

    service = module.get<RuleExecutorService>(RuleExecutorService);
    facebook = module.get(FacebookService);
  });

  describe('pause action', () => {
    it('should call updateStatus with PAUSED for pause action', async () => {
      const entity = makeEntity();

      const results = await service.execute(USER_ID, 'pause', 'campaign', [entity], null);

      expect(facebook.updateStatus).toHaveBeenCalledTimes(1);
      expect(facebook.updateStatus).toHaveBeenCalledWith(USER_ID, {
        facebook_id: 'camp-1',
        status: 'PAUSED',
        type: 'campaign',
        ad_account_id: 'act_123',
      });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(results[0].actionTaken).toBe('paused');
    });
  });

  describe('activate action', () => {
    it('should call updateStatus with ACTIVE for activate action', async () => {
      const entity = makeEntity({ id: 'adset-1', name: 'Test AdSet' });

      const results = await service.execute(USER_ID, 'activate', 'adset', [entity], null);

      expect(facebook.updateStatus).toHaveBeenCalledWith(USER_ID, {
        facebook_id: 'adset-1',
        status: 'ACTIVE',
        type: 'adset',
        ad_account_id: 'act_123',
      });
      expect(results[0].status).toBe('success');
      expect(results[0].actionTaken).toBe('activated');
    });
  });

  describe('increase_budget action', () => {
    it('should calculate percentage budget increase with max cap (100 + 50% = 150, capped at 120 → 12000 cents)', async () => {
      const entity = makeEntity({ metricsSnapshot: { daily_budget: 100 } });
      const budgetAdjustment = {
        mode: 'percentage' as const,
        value: 50,
        budget_type: 'daily' as const,
        max_budget: 120,
      };

      const results = await service.execute(
        USER_ID,
        'increase_budget',
        'campaign',
        [entity],
        budgetAdjustment,
      );

      expect(facebook.updateBudget).toHaveBeenCalledWith(USER_ID, {
        type: 'campaign',
        facebook_id: 'camp-1',
        budget_type: 'daily',
        amount: 12000,
        ad_account_id: 'act_123',
      });
      expect(results[0].status).toBe('success');
      expect(results[0].actionTaken).toContain('budget_increased_50%_to_120.00');
    });
  });

  describe('decrease_budget action', () => {
    it('should calculate percentage budget decrease with min floor (100 - 80% = 20, floored at 50 → 5000 cents)', async () => {
      const entity = makeEntity({ metricsSnapshot: { daily_budget: 100 } });
      const budgetAdjustment = {
        mode: 'percentage' as const,
        value: 80,
        budget_type: 'daily' as const,
        min_budget: 50,
      };

      const results = await service.execute(
        USER_ID,
        'decrease_budget',
        'campaign',
        [entity],
        budgetAdjustment,
      );

      expect(facebook.updateBudget).toHaveBeenCalledWith(USER_ID, {
        type: 'campaign',
        facebook_id: 'camp-1',
        budget_type: 'daily',
        amount: 5000,
        ad_account_id: 'act_123',
      });
      expect(results[0].status).toBe('success');
      expect(results[0].actionTaken).toContain('budget_decreased_80%_to_50.00');
    });
  });

  describe('fixed budget action', () => {
    it('should set fixed budget amount (500 → 50000 cents)', async () => {
      const entity = makeEntity();
      const budgetAdjustment = {
        mode: 'fixed' as const,
        value: 500,
        budget_type: 'daily' as const,
      };

      const results = await service.execute(
        USER_ID,
        'increase_budget',
        'campaign',
        [entity],
        budgetAdjustment,
      );

      expect(facebook.updateBudget).toHaveBeenCalledWith(USER_ID, {
        type: 'campaign',
        facebook_id: 'camp-1',
        budget_type: 'daily',
        amount: 50000,
        ad_account_id: 'act_123',
      });
      expect(results[0].status).toBe('success');
      expect(results[0].actionTaken).toBe('budget_set_to_500.00');
    });
  });

  describe('error handling', () => {
    it('should handle Facebook API errors gracefully via Promise.allSettled', async () => {
      const entities = [
        makeEntity({ id: 'camp-1', name: 'Campaign 1' }),
        makeEntity({ id: 'camp-2', name: 'Campaign 2' }),
      ];

      facebook.updateStatus
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('Facebook API rate limit exceeded'));

      const results = await service.execute(USER_ID, 'pause', 'campaign', entities, null);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[0].entityId).toBe('camp-1');
      expect(results[1].status).toBe('error');
      expect(results[1].entityId).toBe('camp-2');
      expect(results[1].errorMessage).toBe('Facebook API rate limit exceeded');
    });
  });

  describe('unknown action', () => {
    it('should return error result for unknown action type', async () => {
      const entity = makeEntity();

      const results = await service.execute(USER_ID, 'teleport', 'campaign', [entity], null);

      expect(results[0].status).toBe('error');
      expect(results[0].errorMessage).toBe('Unknown action: teleport');
      expect(facebook.updateStatus).not.toHaveBeenCalled();
      expect(facebook.updateBudget).not.toHaveBeenCalled();
    });
  });

  describe('multiple entities', () => {
    it('should execute action on all provided entities', async () => {
      const entities = [
        makeEntity({ id: 'camp-1', name: 'Campaign 1' }),
        makeEntity({ id: 'camp-2', name: 'Campaign 2' }),
        makeEntity({ id: 'camp-3', name: 'Campaign 3' }),
      ];

      const results = await service.execute(USER_ID, 'pause', 'campaign', entities, null);

      expect(facebook.updateStatus).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
      results.forEach((result) => expect(result.status).toBe('success'));
    });
  });
});
