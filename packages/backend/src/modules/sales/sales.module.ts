import { forwardRef, Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesImportController } from './sales-import.controller';
import { SalesService } from './sales.service';
import { SalesImportService } from './sales-import.service';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { StripeModule } from '../stripe/stripe.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [PlanLimitsModule, StripeModule, TrackingModule, forwardRef(() => WebhooksModule)],
  controllers: [SalesController, SalesImportController],
  providers: [SalesService, SalesImportService],
  exports: [SalesService],
})
export class SalesModule {}
