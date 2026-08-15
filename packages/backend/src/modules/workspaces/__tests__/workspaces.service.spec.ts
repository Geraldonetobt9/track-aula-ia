import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WorkspacesService } from '../workspaces.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { PlanLimitsService } from '../../plan-limits/plan-limits.service';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let planLimitsMock: jest.Mocked<Pick<PlanLimitsService, 'assertCanCreateWorkspace' | 'invalidate'>>;

  const buildChain = (result: any) => {
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue(result),
      maybeSingle: jest.fn().mockResolvedValue(result),
    };
    return chain;
  };

  beforeEach(async () => {
    planLimitsMock = {
      assertCanCreateWorkspace: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    const supabaseMock = {
      getClient: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue(buildChain({ data: null, error: null })),
      }),
      isAdmin: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PlanLimitsService, useValue: planLimitsMock },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
  });

  describe('create', () => {
    it('throws BadRequestException when name is empty', async () => {
      await expect(service.create('user-1', '')).rejects.toThrow(BadRequestException);
    });

    it('calls assertCanCreateWorkspace before inserting', async () => {
      const workspace = { id: 'ws-1', user_id: 'user-1', name: 'Test WS' };
      const chain = buildChain({ data: workspace, error: null });
      const supabaseMock = {
        getClient: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue(chain) }),
        isAdmin: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WorkspacesService,
          { provide: SupabaseService, useValue: supabaseMock },
          { provide: PlanLimitsService, useValue: planLimitsMock },
        ],
      }).compile();
      const svc = module.get<WorkspacesService>(WorkspacesService);

      const callOrder: string[] = [];
      planLimitsMock.assertCanCreateWorkspace.mockImplementation(async () => { callOrder.push('assert'); });
      planLimitsMock.invalidate.mockImplementation(async () => { callOrder.push('invalidate'); });

      await svc.create('user-1', 'Test WS');

      expect(callOrder[0]).toBe('assert');
      expect(callOrder[1]).toBe('invalidate');
    });

    it('calls invalidate after successful insert', async () => {
      const workspace = { id: 'ws-1', user_id: 'user-1', name: 'Test WS' };
      const chain = buildChain({ data: workspace, error: null });
      const supabaseMock = {
        getClient: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue(chain) }),
        isAdmin: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WorkspacesService,
          { provide: SupabaseService, useValue: supabaseMock },
          { provide: PlanLimitsService, useValue: planLimitsMock },
        ],
      }).compile();
      const svc = module.get<WorkspacesService>(WorkspacesService);

      await svc.create('user-1', 'Test WS');
      expect(planLimitsMock.invalidate).toHaveBeenCalledWith('user-1');
    });

    it('does not call invalidate when assertCanCreateWorkspace throws', async () => {
      planLimitsMock.assertCanCreateWorkspace.mockRejectedValue(new Error('Limit exceeded'));

      await expect(service.create('user-1', 'Test WS')).rejects.toThrow('Limit exceeded');
      expect(planLimitsMock.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('includes archived_at IS NULL filter', async () => {
      const isMock = jest.fn().mockReturnThis();
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: isMock,
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      const supabaseMock = {
        getClient: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue(chain) }),
        isAdmin: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WorkspacesService,
          { provide: SupabaseService, useValue: supabaseMock },
          { provide: PlanLimitsService, useValue: planLimitsMock },
        ],
      }).compile();
      const svc = module.get<WorkspacesService>(WorkspacesService);

      await svc.list('user-1');
      expect(isMock).toHaveBeenCalledWith('archived_at', null);
    });
  });

  describe('listArchived', () => {
    it('returns workspaces where archived_at IS NOT NULL', async () => {
      const archived = [{ id: 'ws-2', archived_at: '2026-04-01T00:00:00Z' }];
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: archived, error: null }),
      };
      const supabaseMock = {
        getClient: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue(chain) }),
        isAdmin: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WorkspacesService,
          { provide: SupabaseService, useValue: supabaseMock },
          { provide: PlanLimitsService, useValue: planLimitsMock },
        ],
      }).compile();
      const svc = module.get<WorkspacesService>(WorkspacesService);

      const result = await svc.listArchived('user-1');
      expect(result).toEqual(archived);
      expect(chain.not).toHaveBeenCalledWith('archived_at', 'is', null);
    });
  });
});
