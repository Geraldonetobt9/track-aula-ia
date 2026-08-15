import { Module } from '@nestjs/common';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';
import { RuleSchedulerService } from './rule-scheduler.service';
import { RuleEvaluatorService } from './rule-evaluator.service';
import { RuleExecutorService } from './rule-executor.service';
import { RuleNotifierService } from './rule-notifier.service';
import { FacebookModule } from '../facebook/facebook.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';

@Module({
  imports: [FacebookModule, MetricsModule, PlanLimitsModule],
  controllers: [AutomationRulesController],
  providers: [
    AutomationRulesService,
    RuleSchedulerService,
    RuleEvaluatorService,
    RuleExecutorService,
    RuleNotifierService,
  ],
})
export class AutomationRulesModule {}
