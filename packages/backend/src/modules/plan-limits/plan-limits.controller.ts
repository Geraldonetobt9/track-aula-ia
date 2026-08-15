// packages/backend/src/modules/plan-limits/plan-limits.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlanLimitsService } from './plan-limits.service';

@UseGuards(AuthGuard)
@Controller('plan-limits')
export class PlanLimitsController {
  constructor(private readonly planLimits: PlanLimitsService) {}

  @Get('usage')
  async getUsage(@CurrentUser('id') userId: string) {
    return this.planLimits.getUsageSnapshot(userId);
  }
}
