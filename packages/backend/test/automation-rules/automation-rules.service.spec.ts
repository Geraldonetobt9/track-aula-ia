import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AutomationRulesService } from '../../src/modules/automation-rules/automation-rules.service';
import { SupabaseService } from '../../src/shared/services/supabase.service';
import { PlanLimitsService } from '../../src/modules/plan-limits/plan-limits.service';
import { PlanLimitExceededException } from '../../src/modules/plan-limits/plan-limit-exceeded.exception';

describe('AutomationRulesService - toggleRule plan limit enforcement', () => {
  let service: AutomationRulesService;
  let mockClient: any;
  let planLimitsMock: jest.Mocked<Pick<PlanLimitsService, 'assertCanActivateRule' | 'invalidate'>>;

  const RULE_ID = 'rule-uuid-1';
  const USER_ID = 'user-uuid-1';
  const WORKSPACE_ID = 'workspace-uuid-1';

  beforeEach(async () => {
    mockClient = { from: jest.fn() };

    planLimitsMock = {
      assertCanActivateRule: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    const supabaseServiceMock = {
      getClient: jest.fn().mockReturnValue(mockClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationRulesService,
        { provide: SupabaseService, useValue: supabaseServiceMock },
        { provide: PlanLimitsService, useValue: planLimitsMock },
      ],
    }).compile();

    service = module.get<AutomationRulesService>(AutomationRulesService);
  });

  it('should activate a rule when under the plan limit', async () => {
    const inactiveRule = { id: RULE_ID, is_active: false, workspace_id: WORKSPACE_ID };
    const updatedRule = { id: RULE_ID, is_active: true, workspace_id: WORKSPACE_ID, name: 'Test Rule' };

    mockClient.from.mockImplementation((table: string) => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: WORKSPACE_ID }, error: null }),
      };
      chain.select.mockReturnValue(chain);
      if (table === 'automation_rules') {
        chain.single
          .mockResolvedValueOnce({ data: inactiveRule, error: null })
          .mockResolvedValueOnce({ data: inactiveRule, error: null });
        chain.update.mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: updatedRule, error: null }),
            }),
          }),
        });
      }
      return chain;
    });

    const result = await service.toggleRule(USER_ID, RULE_ID);
    expect(result).toEqual(updatedRule);
    expect(planLimitsMock.assertCanActivateRule).toHaveBeenCalledWith(USER_ID, RULE_ID);
    expect(planLimitsMock.invalidate).toHaveBeenCalledWith(USER_ID);
  });

  it('should throw PlanLimitExceededException when active rule count meets plan limit', async () => {
    const inactiveRule = { id: RULE_ID, is_active: false, workspace_id: WORKSPACE_ID };

    mockClient.from.mockImplementation(() => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: inactiveRule, error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: WORKSPACE_ID }, error: null }),
      };
      chain.select.mockReturnValue(chain);
      return chain;
    });

    planLimitsMock.assertCanActivateRule.mockRejectedValue(
      new PlanLimitExceededException({ resource: 'active_rule', current: 3, limit: 3, plan: 'starter' }),
    );

    await expect(service.toggleRule(USER_ID, RULE_ID)).rejects.toThrow(PlanLimitExceededException);
  });

  it('should skip limit check when deactivating a rule', async () => {
    const activeRule = { id: RULE_ID, is_active: true, workspace_id: WORKSPACE_ID };
    const updatedRule = { id: RULE_ID, is_active: false, workspace_id: WORKSPACE_ID, name: 'Test Rule' };

    mockClient.from.mockImplementation((table: string) => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: WORKSPACE_ID }, error: null }),
      };
      chain.select.mockReturnValue(chain);
      if (table === 'automation_rules') {
        chain.single
          .mockResolvedValueOnce({ data: activeRule, error: null })
          .mockResolvedValueOnce({ data: activeRule, error: null });
        chain.update.mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: updatedRule, error: null }),
            }),
          }),
        });
      }
      return chain;
    });

    const result = await service.toggleRule(USER_ID, RULE_ID);

    expect(planLimitsMock.assertCanActivateRule).not.toHaveBeenCalled();
    expect(planLimitsMock.invalidate).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual(updatedRule);
  });

  it('should throw NotFoundException when rule does not exist', async () => {
    mockClient.from.mockImplementation(() => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      };
      chain.select.mockReturnValue(chain);
      return chain;
    });

    await expect(service.toggleRule(USER_ID, RULE_ID)).rejects.toThrow(NotFoundException);
  });

  it('should allow activation when plan has no limit (assertCanActivateRule resolves)', async () => {
    const inactiveRule = { id: RULE_ID, is_active: false, workspace_id: WORKSPACE_ID };
    const updatedRule = { id: RULE_ID, is_active: true, workspace_id: WORKSPACE_ID };

    mockClient.from.mockImplementation(() => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: inactiveRule, error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: WORKSPACE_ID }, error: null }),
      };
      chain.select.mockReturnValue(chain);
      chain.update.mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: updatedRule, error: null }),
          }),
        }),
      });
      return chain;
    });

    planLimitsMock.assertCanActivateRule.mockResolvedValue(undefined);

    const result = await service.toggleRule(USER_ID, RULE_ID);
    expect(result).toEqual(updatedRule);
  });

  it('should invalidate plan limits cache after deactivation', async () => {
    const activeRule = { id: RULE_ID, is_active: true, workspace_id: WORKSPACE_ID };
    const updatedRule = { id: RULE_ID, is_active: false, workspace_id: WORKSPACE_ID };

    mockClient.from.mockImplementation((table: string) => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: WORKSPACE_ID }, error: null }),
      };
      chain.select.mockReturnValue(chain);
      if (table === 'automation_rules') {
        chain.single
          .mockResolvedValueOnce({ data: activeRule, error: null })
          .mockResolvedValueOnce({ data: activeRule, error: null });
        chain.update.mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: updatedRule, error: null }),
            }),
          }),
        });
      }
      return chain;
    });

    await service.toggleRule(USER_ID, RULE_ID);
    expect(planLimitsMock.invalidate).toHaveBeenCalledWith(USER_ID);
  });
});
