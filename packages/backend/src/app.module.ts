import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SharedModule } from './shared/shared.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { FacebookModule } from './modules/facebook/facebook.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { FinancialModule } from './modules/financial/financial.module';
import { PlansModule } from './modules/plans/plans.module';
import { AdminModule } from './modules/admin/admin.module';
import { SalesModule } from './modules/sales/sales.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { UtilsModule } from './modules/utils/utils.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { HealthModule } from './modules/health/health.module';
import { AutomationRulesModule } from './modules/automation-rules/automation-rules.module';
import { PlanLimitsModule } from './modules/plan-limits/plan-limits.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { AuthModule } from './modules/auth/auth.module';
import { AccountModule } from './modules/account/account.module';
import { GtmEventsModule } from './modules/gtm-events/gtm-events.module';
import { VturbModule } from './modules/vturb/vturb.module';

const RATE_LIMIT_TTL_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMIT_MAX_REQUESTS }]),
    SharedModule,
    WebhooksModule,
    FacebookModule,
    WorkspacesModule,
    FinancialModule,
    PlansModule,
    AdminModule,
    SalesModule,
    MetricsModule,
    UtilsModule,
    IntegrationsModule,
    HealthModule,
    AutomationRulesModule,
    PlanLimitsModule,
    SubscriptionsModule,
    StripeModule,
    AuthModule,
    AccountModule,
    GtmEventsModule,
    VturbModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
