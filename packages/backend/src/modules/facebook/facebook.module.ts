import { Module } from '@nestjs/common';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';
import { FacebookOAuthService } from './facebook-oauth.service';
import { InsightsService } from './insights.service';
import { SaleMatcherService } from './sale-matcher.service';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';

@Module({
  imports: [PlanLimitsModule],
  controllers: [FacebookController],
  providers: [FacebookService, FacebookOAuthService, InsightsService, SaleMatcherService],
  exports: [FacebookService, InsightsService, SaleMatcherService],
})
export class FacebookModule {}
