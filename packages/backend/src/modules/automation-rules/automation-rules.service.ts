import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { PlanLimitsService } from '../plan-limits/plan-limits.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';

const RULE_COLUMNS = 'id, name, is_active, connection_id, target_entity, target_status, name_filter, action_type, budget_adjustment, evaluation_period, custom_start_date, frequency_minutes, daily_run_time, last_executed_at';
const CONDITION_COLUMNS = 'id, rule_id, metric, operator, value';

@Injectable()
export class AutomationRulesService {
  private readonly logger = new Logger(AutomationRulesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async getRules(userId: string, workspaceId: string) {
    const client = this.supabase.getClient();
    const { data: rules, error } = await client
      .from('automation_rules')
      .select(RULE_COLUMNS)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (!rules || rules.length === 0) return [];

    const ruleIds = rules.map((r) => r.id);
    const { data: conditions, error: condError } = await client
      .from('automation_rule_conditions')
      .select(CONDITION_COLUMNS)
      .in('rule_id', ruleIds);
    if (condError) throw condError;

    const conditionsByRule = new Map<string, typeof conditions>();
    for (const cond of conditions || []) {
      const existing = conditionsByRule.get(cond.rule_id) || [];
      existing.push(cond);
      conditionsByRule.set(cond.rule_id, existing);
    }

    return rules.map((rule) => ({
      ...rule,
      conditions: conditionsByRule.get(rule.id) || [],
    }));
  }

  async createRule(userId: string, dto: CreateRuleDto) {
    const client = this.supabase.getClient();
    this.validateBudgetAction(dto.action_type, dto.budget_adjustment);
    this.validateDailyRunTime(dto.frequency_minutes, dto.daily_run_time);
    this.validateCustomPeriod(dto.evaluation_period, dto.custom_start_date);

    const { conditions, ...ruleData } = dto;
    const { data: rule, error } = await client
      .from('automation_rules')
      .insert({
        workspace_id: ruleData.workspace_id,
        name: ruleData.name,
        is_active: false,
        connection_id: ruleData.connection_id || null,
        target_entity: ruleData.target_entity,
        target_status: ruleData.target_status,
        name_filter: ruleData.name_filter || null,
        action_type: ruleData.action_type,
        budget_adjustment: ruleData.budget_adjustment || null,
        evaluation_period: ruleData.evaluation_period,
        custom_start_date: ruleData.custom_start_date || null,
        frequency_minutes: ruleData.frequency_minutes,
        daily_run_time: ruleData.daily_run_time || null,
      })
      .select(RULE_COLUMNS)
      .single();
    if (error) throw error;

    let savedConditions: any[] = [];
    if (conditions.length > 0) {
      const condRows = conditions.map((c) => ({ rule_id: rule.id, metric: c.metric, operator: c.operator, value: c.value }));
      const { data: conds, error: condError } = await client.from('automation_rule_conditions').insert(condRows).select(CONDITION_COLUMNS);
      if (condError) throw condError;
      savedConditions = conds || [];
    }
    return { ...rule, conditions: savedConditions };
  }

  async updateRule(userId: string, ruleId: string, dto: UpdateRuleDto) {
    const client = this.supabase.getClient();
    await this.verifyRuleOwnership(client, ruleId, userId);
    if (dto.action_type) this.validateBudgetAction(dto.action_type, dto.budget_adjustment);
    if (dto.frequency_minutes !== undefined) this.validateDailyRunTime(dto.frequency_minutes, dto.daily_run_time);
    if (dto.evaluation_period) this.validateCustomPeriod(dto.evaluation_period, dto.custom_start_date);

    const { conditions, ...updates } = dto;
    const updatePayload: Record<string, any> = { ...updates, updated_at: new Date().toISOString() };
    const { data: rule, error } = await client.from('automation_rules').update(updatePayload).eq('id', ruleId).select(RULE_COLUMNS).single();
    if (error) throw error;
    if (!rule) throw new NotFoundException('Rule not found');

    if (conditions !== undefined) {
      await client.from('automation_rule_conditions').delete().eq('rule_id', ruleId);
      let savedConditions: any[] = [];
      if (conditions.length > 0) {
        const condRows = conditions.map((c) => ({ rule_id: ruleId, metric: c.metric, operator: c.operator, value: c.value }));
        const { data: conds, error: condError } = await client.from('automation_rule_conditions').insert(condRows).select(CONDITION_COLUMNS);
        if (condError) throw condError;
        savedConditions = conds || [];
      }
      return { ...rule, conditions: savedConditions };
    }
    return rule;
  }

  async deleteRule(userId: string, ruleId: string) {
    const client = this.supabase.getClient();
    await this.verifyRuleOwnership(client, ruleId, userId);
    const { error } = await client.from('automation_rules').delete().eq('id', ruleId);
    if (error) throw error;
    return { success: true };
  }

  async toggleRule(userId: string, ruleId: string) {
    const client = this.supabase.getClient();
    await this.verifyRuleOwnership(client, ruleId, userId);
    const { data: rule, error } = await client.from('automation_rules').select('id, is_active, workspace_id').eq('id', ruleId).single();
    if (error || !rule) throw new NotFoundException('Rule not found');

    const newState = !rule.is_active;
    if (newState) {
      await this.planLimits.assertCanActivateRule(userId, ruleId);
    }

    const { data: updated, error: updateError } = await client.from('automation_rules').update({ is_active: newState, updated_at: new Date().toISOString() }).eq('id', ruleId).select(RULE_COLUMNS).single();
    if (updateError) throw updateError;

    await this.planLimits.invalidate(userId);
    return updated;
  }

  private validateBudgetAction(actionType: string, budgetAdjustment?: any) {
    if ((actionType === 'increase_budget' || actionType === 'decrease_budget') && !budgetAdjustment) {
      throw new BadRequestException('budget_adjustment is required for budget actions');
    }
  }

  private validateDailyRunTime(frequencyMinutes: number, dailyRunTime?: string | null) {
    if (frequencyMinutes === 1440 && !dailyRunTime) {
      throw new BadRequestException('daily_run_time is required when frequency is once per day');
    }
  }

  private validateCustomPeriod(evaluationPeriod: string, customStartDate?: string | null) {
    if (evaluationPeriod === 'custom' && !customStartDate) {
      throw new BadRequestException('custom_start_date is required when evaluation_period is custom');
    }
  }

  private async verifyRuleOwnership(client: any, ruleId: string, userId: string): Promise<void> {
    const { data, error } = await client
      .from('automation_rules')
      .select('id, workspace_id')
      .eq('id', ruleId)
      .single();

    if (error || !data) throw new NotFoundException('Rule not found');

    const { data: workspace } = await client
      .from('workspaces')
      .select('id')
      .eq('id', data.workspace_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!workspace) throw new ForbiddenException('Access denied');
  }
}
