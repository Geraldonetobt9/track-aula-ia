import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlansService } from '../plans.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { CacheService } from '../../../shared/services/cache.service';

const FREE_RULE = {
  id: 'uuid-free',
  plan: 'free',
  max_sales_monthly: 50,
  max_active_ad_accounts: 1,
  max_checkout_integrations: 1,
  max_workspaces: 1,
  max_active_rules: 0,
  overage_price_cents: 0,
  updated_at: '2026-01-01T00:00:00Z',
};

const PRO_RULE = {
  id: 'uuid-pro',
  plan: 'pro',
  max_sales_monthly: -1,
  max_active_ad_accounts: -1,
  max_checkout_integrations: -1,
  max_workspaces: -1,
  max_active_rules: -1,
  overage_price_cents: 0,
  updated_at: '2026-01-01T00:00:00Z',
};

function makeQueryBuilder(resolvedValue: { data: any; error: any }) {
  const builder: any = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    update: () => builder,
    single: async () => resolvedValue,
    then: (resolve: (v: any) => void) => resolve(resolvedValue),
  };
  return builder;
}

describe('PlansService', () => {
  let service: PlansService;
  let cache: CacheService;
  let fromMock: jest.Mock;

  beforeEach(async () => {
    fromMock = jest.fn();

    const supabaseMock: Partial<SupabaseService> = {
      getClient: () => ({ from: fromMock }) as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: SupabaseService, useValue: supabaseMock },
        CacheService,
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
    cache = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('returns plan rules from DB on cache miss', async () => {
      fromMock.mockReturnValue(makeQueryBuilder({ data: [FREE_RULE, PRO_RULE], error: null }));

      const result = await service.list();

      expect(result).toEqual([FREE_RULE, PRO_RULE]);
      expect(fromMock).toHaveBeenCalledWith('plan_rules');
    });

    it('returns cached result without hitting DB on cache hit', async () => {
      cache.set('plan_rules:list', [FREE_RULE], 60_000);

      const result = await service.list();

      expect(result).toEqual([FREE_RULE]);
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('throws when DB returns an error', async () => {
      fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: new Error('db error') }));

      await expect(service.list()).rejects.toThrow('db error');
    });
  });

  describe('getRulesForPlan', () => {
    it('returns the correct plan rules from DB', async () => {
      fromMock.mockReturnValue(makeQueryBuilder({ data: FREE_RULE, error: null }));

      const result = await service.getRulesForPlan('free');

      expect(result).toEqual(FREE_RULE);
      expect(fromMock).toHaveBeenCalledWith('plan_rules');
    });

    it('returns cached result without hitting DB', async () => {
      cache.set('plan_rules:plan:pro', PRO_RULE, 60_000);

      const result = await service.getRulesForPlan('pro');

      expect(result).toEqual(PRO_RULE);
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  describe('getRulesForPlanId', () => {
    it('returns plan rules by UUID from DB', async () => {
      fromMock.mockReturnValue(makeQueryBuilder({ data: FREE_RULE, error: null }));

      const result = await service.getRulesForPlanId('uuid-free');

      expect(result).toEqual(FREE_RULE);
      expect(fromMock).toHaveBeenCalledWith('plan_rules');
    });

    it('returns cached result without hitting DB', async () => {
      cache.set('plan_rules:id:uuid-pro', PRO_RULE, 60_000);

      const result = await service.getRulesForPlanId('uuid-pro');

      expect(result).toEqual(PRO_RULE);
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('throws when DB returns an error', async () => {
      fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: new Error('not found') }));

      await expect(service.getRulesForPlanId('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('updates plan rules and invalidates cache', async () => {
      fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
      cache.set('plan_rules:list', [FREE_RULE], 60_000);
      cache.set('plan_rules:plan:free', FREE_RULE, 60_000);

      const result = await service.update('free', { max_sales_monthly: 100, overage_price_cents: 50 });

      expect(result).toEqual({ success: true });
      expect(fromMock).toHaveBeenCalledWith('plan_rules');
      // Cache should be invalidated
      expect(cache.get('plan_rules:list')).toBeNull();
      expect(cache.get('plan_rules:plan:free')).toBeNull();
    });

    it('strips disallowed fields from the update payload', async () => {
      let capturedUpdate: any = null;
      const builder: any = {
        select: () => builder,
        update: (payload: any) => {
          capturedUpdate = payload;
          return builder;
        },
        eq: async () => ({ error: null }),
      };
      fromMock.mockReturnValue(builder);

      await service.update('free', {
        max_sales_monthly: 200,
        // disallowed fields (not in ALLOWED_FIELDS whitelist)
        max_sales: 999,
        max_ad_accounts: 5,
        some_unknown_field: true,
      } as any);

      expect(capturedUpdate).not.toHaveProperty('max_sales');
      expect(capturedUpdate).not.toHaveProperty('max_ad_accounts');
      expect(capturedUpdate).not.toHaveProperty('some_unknown_field');
      expect(capturedUpdate).toHaveProperty('max_sales_monthly', 200);
      expect(capturedUpdate).toHaveProperty('updated_at');
    });

    it('throws BadRequestException when plan is missing', async () => {
      await expect(service.update('', { max_sales_monthly: 10 })).rejects.toThrow(BadRequestException);
    });

    it('throws when DB returns an error', async () => {
      fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: new Error('db write error') }));

      await expect(service.update('free', { max_sales_monthly: 10 })).rejects.toThrow('db write error');
    });
  });
});
