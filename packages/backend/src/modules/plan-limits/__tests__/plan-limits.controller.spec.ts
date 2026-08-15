// packages/backend/src/modules/plan-limits/__tests__/plan-limits.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PlanLimitsController } from '../plan-limits.controller';
import { PlanLimitsService } from '../plan-limits.service';
import { AuthGuard } from '../../../common/guards/auth.guard';

describe('PlanLimitsController', () => {
  let controller: PlanLimitsController;
  let service: { getUsageSnapshot: jest.Mock };

  beforeEach(async () => {
    service = { getUsageSnapshot: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanLimitsController],
      providers: [{ provide: PlanLimitsService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PlanLimitsController);
  });

  it('GET /plan-limits/usage returns snapshot', async () => {
    const snap = { plan: 'pro' } as any;
    service.getUsageSnapshot.mockResolvedValue(snap);
    const result = await controller.getUsage('user-1');
    expect(service.getUsageSnapshot).toHaveBeenCalledWith('user-1');
    expect(result).toBe(snap);
  });
});
