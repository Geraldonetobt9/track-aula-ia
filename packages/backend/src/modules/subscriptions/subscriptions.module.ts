// packages/backend/src/modules/subscriptions/subscriptions.module.ts
import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';

@Module({
  imports: [PlanLimitsModule],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
