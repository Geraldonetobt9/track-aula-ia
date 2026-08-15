import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../shared/services/supabase.service';
import { RuleEvaluatorService } from './rule-evaluator.service';
import { RuleExecutorService } from './rule-executor.service';
import { RuleNotifierService } from './rule-notifier.service';

const RULE_COLUMNS = 'id, workspace_id, name, is_active, connection_id, target_entity, target_status, name_filter, action_type, budget_adjustment, evaluation_period, custom_start_date, frequency_minutes, daily_run_time, last_executed_at';
const CONDITION_COLUMNS = 'id, rule_id, metric, operator, value';

@Injectable()
export class RuleSchedulerService {
  private readonly logger = new Logger(RuleSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly evaluator: RuleEvaluatorService,
    private readonly executor: RuleExecutorService,
    private readonly notifier: RuleNotifierService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    if (this.isRunning) {
      this.logger.debug('[scheduler] Previous cycle still running — skipping');
      return;
    }
    this.isRunning = true;
    const t0 = Date.now();

    try {
      const rules = await this.getDueRules();
      if (rules.length === 0) {
        this.logger.debug(`[scheduler] No rules due — done in ${Date.now() - t0}ms`);
        return;
      }
      this.logger.log(`[scheduler] ${rules.length} rule(s) due for evaluation`);

      for (const rule of rules) {
        await this.processRule(rule);
      }
      this.logger.log(`[scheduler] Cycle complete in ${Date.now() - t0}ms | ${rules.length} rule(s) processed`);
    } catch (error) {
      this.logger.error(`[scheduler] Cycle failed: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async getDueRules(): Promise<any[]> {
    const client = this.supabase.getClient();
    const now = new Date();
    const { data: rules, error } = await client.from('automation_rules').select(RULE_COLUMNS).eq('is_active', true);
    if (error) throw error;
    if (!rules || rules.length === 0) return [];
    return rules.filter((rule) => this.isRuleDue(rule, now));
  }

  private isRuleDue(rule: any, now: Date): boolean {
    if (!rule.last_executed_at) return true;
    if (rule.frequency_minutes === 1440) return this.isDailyRuleDue(rule, now);
    const lastExec = new Date(rule.last_executed_at);
    const elapsedMs = now.getTime() - lastExec.getTime();
    return elapsedMs >= rule.frequency_minutes * 60 * 1000;
  }

  private isDailyRuleDue(rule: any, now: Date): boolean {
    if (!rule.daily_run_time) return false;
    const spNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const [hours, minutes] = rule.daily_run_time.split(':').map(Number);
    const scheduledToday = new Date(spNow);
    scheduledToday.setHours(hours, minutes, 0, 0);
    if (spNow < scheduledToday) return false;
    const lastExec = new Date(rule.last_executed_at);
    const spLastExec = new Date(lastExec.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return spNow.toDateString() !== spLastExec.toDateString();
  }

  private async processRule(rule: any): Promise<void> {
    const t0 = Date.now();
    const client = this.supabase.getClient();

    try {
      const { data: conditions, error: condError } = await client.from('automation_rule_conditions').select(CONDITION_COLUMNS).eq('rule_id', rule.id);
      if (condError) throw condError;
      if (!conditions || conditions.length === 0) {
        this.logger.warn(`[scheduler] Rule ${rule.name} has no conditions — skipping`);
        await this.updateLastExecuted(rule.id);
        return;
      }

      const { data: workspace, error: wsError } = await client.from('workspaces').select('user_id').eq('id', rule.workspace_id).single();
      if (wsError || !workspace) {
        this.logger.error(`[scheduler] Workspace not found for rule ${rule.name}`);
        return;
      }

      const matchedEntities = await this.evaluator.evaluate(workspace.user_id, rule, conditions);
      if (matchedEntities.length === 0) {
        this.logger.log(`[scheduler] Rule "${rule.name}" — no matching entities (${Date.now() - t0}ms)`);
        await this.updateLastExecuted(rule.id);
        return;
      }

      const results = await this.executor.execute(workspace.user_id, rule.action_type, rule.target_entity, matchedEntities, rule.budget_adjustment);

      const metricsMap = new Map<string, Record<string, number>>();
      for (const entity of matchedEntities) metricsMap.set(entity.id, entity.metricsSnapshot);

      await this.notifier.notify(rule.id, rule.name, rule.workspace_id, results, metricsMap, {
        targetEntity: rule.target_entity,
        targetStatus: rule.target_status,
        evaluationPeriod: rule.evaluation_period,
      });
      await this.updateLastExecuted(rule.id);

      const successCount = results.filter((r) => r.status === 'success').length;
      this.logger.log(`[scheduler] Rule "${rule.name}" — ${matchedEntities.length} matched, ${successCount} actions succeeded (${Date.now() - t0}ms)`);
    } catch (error) {
      this.logger.error(`[scheduler] Rule "${rule.name}" failed: ${(error as Error).message}`);
      await this.updateLastExecuted(rule.id);
    }
  }

  private async updateLastExecuted(ruleId: string): Promise<void> {
    const client = this.supabase.getClient();
    await client.from('automation_rules').update({ last_executed_at: new Date().toISOString() }).eq('id', ruleId);
  }
}
