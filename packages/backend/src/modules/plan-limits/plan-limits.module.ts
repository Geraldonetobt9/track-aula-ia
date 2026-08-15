// packages/backend/src/modules/plan-limits/plan-limits.module.ts
import { Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';
import { PlanLimitsController } from './plan-limits.controller';

@Module({
  controllers: [PlanLimitsController],
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}
