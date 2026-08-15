# Automation Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement workspace-scoped automated rules that execute actions (activate, pause, increase/decrease budget) on Facebook Ads campaigns/adsets/ads based on live metric conditions.

**Architecture:** NestJS scheduler module with 5 services (CRUD, scheduler, evaluator, executor, notifier), 3 new database tables, and a React frontend page with rule management UI. The scheduler runs every minute, evaluates rules via live Facebook API metrics, and executes actions through existing FacebookService methods.

**Tech Stack:** NestJS 10 + @nestjs/schedule, Supabase PostgreSQL, React 18 + TanStack Query + shadcn/ui + Lucide icons

**Spec:** `docs/superpowers/specs/2026-04-01-automation-rules-design.md`

---

## File Structure

### Database
- **Create:** `supabase/migrations/20260401000008_automation_rules.sql` — 3 tables + indexes + RLS + plan_rules column

### Backend (`packages/backend/src/`)
- **Create:** `modules/automation-rules/automation-rules.module.ts` — NestJS module
- **Create:** `modules/automation-rules/automation-rules.controller.ts` — REST endpoints
- **Create:** `modules/automation-rules/automation-rules.service.ts` — CRUD + plan limit validation
- **Create:** `modules/automation-rules/rule-scheduler.service.ts` — Cron job (every minute)
- **Create:** `modules/automation-rules/rule-evaluator.service.ts` — Live metric evaluation
- **Create:** `modules/automation-rules/rule-executor.service.ts` — Action execution
- **Create:** `modules/automation-rules/rule-notifier.service.ts` — Discord + execution log
- **Create:** `modules/automation-rules/dto/create-rule.dto.ts` — Validation DTO
- **Create:** `modules/automation-rules/dto/update-rule.dto.ts` — Validation DTO
- **Modify:** `app.module.ts:16-38` — Add AutomationRulesModule import

### Frontend (`packages/frontend/src/`)
- **Create:** `pages/Rules.tsx` — Main rules page
- **Create:** `components/rules/RulesList.tsx` — List of rule cards
- **Create:** `components/rules/RuleCard.tsx` — Individual rule card
- **Create:** `components/rules/RuleFormModal.tsx` — Create/edit rule modal
- **Create:** `components/rules/ConditionBuilder.tsx` — Metric condition builder
- **Create:** `components/rules/BudgetConfig.tsx` — Budget adjustment config
- **Create:** `components/rules/RuleHistoryDrawer.tsx` — Execution history drawer
- **Create:** `hooks/useAutomationRules.ts` — CRUD + toggle hook
- **Create:** `hooks/useRuleHistory.ts` — Paginated history hook
- **Modify:** `App.tsx:18-34` — Add lazy import + route
- **Modify:** `components/Sidebar.tsx:6-28` — Add nav item

### Documentation
- **Create:** `docs/features/14-automation-rules/README.md`
- **Modify:** `SQL_DATABASE.md` — Add new tables

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260401000008_automation_rules.sql`

- [ ] **Step 1: Create migration file**

```sql
-- ============================================================
-- Migration: Automation Rules
-- Adds tables for workspace-scoped automated rules engine
-- ============================================================

-- 1. automation_rules — the rule definition
CREATE TABLE public.automation_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  connection_id uuid REFERENCES public.facebook_connections(id) ON DELETE SET NULL,
  target_entity text NOT NULL CHECK (target_entity IN ('campaign', 'adset', 'ad')),
  target_status text NOT NULL CHECK (target_status IN ('active', 'paused', 'any')),
  name_filter text,
  action_type text NOT NULL CHECK (action_type IN ('activate', 'pause', 'increase_budget', 'decrease_budget')),
  budget_adjustment jsonb,
  evaluation_period text NOT NULL CHECK (evaluation_period IN ('today', 'yesterday', 'last_7d', 'last_30d', 'custom')),
  custom_start_date date,
  frequency_minutes int NOT NULL CHECK (frequency_minutes IN (10, 15, 30, 60, 120, 180, 360, 1440)),
  daily_run_time time,
  last_executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. automation_rule_conditions — metric conditions (AND logic)
CREATE TABLE public.automation_rule_conditions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN ('spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin', 'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions')),
  operator text NOT NULL CHECK (operator IN ('gt', 'lt', 'gte', 'lte')),
  value numeric NOT NULL
);

-- 3. automation_rule_executions — execution log
CREATE TABLE public.automation_rule_executions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_facebook_id text NOT NULL,
  entity_name text,
  action_taken text NOT NULL,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  error_message text,
  executed_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_automation_rules_workspace_active
  ON public.automation_rules (workspace_id, is_active);

CREATE INDEX idx_automation_rules_active_last_exec
  ON public.automation_rules (is_active, last_executed_at)
  WHERE is_active = true;

CREATE INDEX idx_automation_rule_conditions_rule
  ON public.automation_rule_conditions (rule_id);

CREATE INDEX idx_automation_rule_executions_rule_date
  ON public.automation_rule_executions (rule_id, executed_at DESC);

CREATE INDEX idx_automation_rule_executions_workspace_date
  ON public.automation_rule_executions (workspace_id, executed_at DESC);

CREATE INDEX idx_automation_rule_executions_brin
  ON public.automation_rule_executions USING BRIN (executed_at);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;

-- automation_rules: workspace-scoped
CREATE POLICY "Users can manage their workspace rules"
  ON public.automation_rules
  FOR ALL
  TO authenticated
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())
    )
  );

-- automation_rule_conditions: via rule join
CREATE POLICY "Users can manage their rule conditions"
  ON public.automation_rule_conditions
  FOR ALL
  TO authenticated
  USING (
    rule_id IN (
      SELECT ar.id FROM public.automation_rules ar
      WHERE ar.workspace_id IN (
        SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    rule_id IN (
      SELECT ar.id FROM public.automation_rules ar
      WHERE ar.workspace_id IN (
        SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- automation_rule_executions: read-only for users
CREATE POLICY "Users can view their workspace executions"
  ON public.automation_rule_executions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- plan_rules: add max_active_rules column
-- ============================================================
ALTER TABLE public.plan_rules ADD COLUMN IF NOT EXISTS max_active_rules int DEFAULT 0;

UPDATE public.plan_rules SET max_active_rules = 0
  WHERE plan_id = 'aa410a04-a399-400e-ad1c-1ca7f75ccfeb'; -- free
UPDATE public.plan_rules SET max_active_rules = 3
  WHERE plan_id = '29a4ba19-f691-4ceb-894f-19601ea60b17'; -- starter
UPDATE public.plan_rules SET max_active_rules = 7
  WHERE plan_id = 'bd669e8b-eac6-494e-86dd-5e639a8ee182'; -- pro
UPDATE public.plan_rules SET max_active_rules = NULL
  WHERE plan_id = '1b17c43a-be5f-475f-996c-95a228af4d49'; -- enterprise (unlimited)
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push` or `npx supabase migration up`
Expected: Migration applied successfully, 3 tables created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260401000008_automation_rules.sql
git commit -m "feat(db): add automation_rules tables, indexes, RLS, and plan limits"
```

---

## Task 2: Backend DTOs

**Files:**
- Create: `packages/backend/src/modules/automation-rules/dto/create-rule.dto.ts`
- Create: `packages/backend/src/modules/automation-rules/dto/update-rule.dto.ts`

- [ ] **Step 1: Create create-rule DTO**

```typescript
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsUUID,
  IsIn,
  IsInt,
  IsArray,
  ValidateNested,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConditionDto {
  @IsIn(['spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin', 'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions'])
  metric: string;

  @IsIn(['gt', 'lt', 'gte', 'lte'])
  operator: string;

  @IsNumber()
  value: number;
}

export class BudgetAdjustmentDto {
  @IsIn(['percentage', 'fixed'])
  mode: string;

  @IsNumber()
  value: number;

  @IsIn(['daily', 'lifetime'])
  budget_type: string;

  @IsOptional()
  @IsNumber()
  min_budget?: number;

  @IsOptional()
  @IsNumber()
  max_budget?: number;
}

export class CreateRuleDto {
  @IsUUID()
  workspace_id: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  connection_id?: string;

  @IsIn(['campaign', 'adset', 'ad'])
  target_entity: string;

  @IsIn(['active', 'paused', 'any'])
  target_status: string;

  @IsOptional()
  @IsString()
  name_filter?: string;

  @IsIn(['activate', 'pause', 'increase_budget', 'decrease_budget'])
  action_type: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetAdjustmentDto)
  budget_adjustment?: BudgetAdjustmentDto;

  @IsIn(['today', 'yesterday', 'last_7d', 'last_30d', 'custom'])
  evaluation_period: string;

  @IsOptional()
  @IsDateString()
  custom_start_date?: string;

  @IsInt()
  @IsIn([10, 15, 30, 60, 120, 180, 360, 1440])
  frequency_minutes: number;

  @IsOptional()
  @IsString()
  daily_run_time?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  conditions: ConditionDto[];
}
```

- [ ] **Step 2: Create update-rule DTO**

```typescript
import {
  IsString,
  IsOptional,
  IsUUID,
  IsIn,
  IsInt,
  IsArray,
  ValidateNested,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConditionDto, BudgetAdjustmentDto } from './create-rule.dto';

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  connection_id?: string | null;

  @IsOptional()
  @IsIn(['campaign', 'adset', 'ad'])
  target_entity?: string;

  @IsOptional()
  @IsIn(['active', 'paused', 'any'])
  target_status?: string;

  @IsOptional()
  @IsString()
  name_filter?: string | null;

  @IsOptional()
  @IsIn(['activate', 'pause', 'increase_budget', 'decrease_budget'])
  action_type?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetAdjustmentDto)
  budget_adjustment?: BudgetAdjustmentDto | null;

  @IsOptional()
  @IsIn(['today', 'yesterday', 'last_7d', 'last_30d', 'custom'])
  evaluation_period?: string;

  @IsOptional()
  @IsDateString()
  custom_start_date?: string | null;

  @IsOptional()
  @IsInt()
  @IsIn([10, 15, 30, 60, 120, 180, 360, 1440])
  frequency_minutes?: number;

  @IsOptional()
  @IsString()
  daily_run_time?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  conditions?: ConditionDto[];
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/automation-rules/dto/
git commit -m "feat(backend): add automation rules DTOs with validation"
```

---

## Task 3: Backend AutomationRulesService (CRUD)

**Files:**
- Create: `packages/backend/src/modules/automation-rules/automation-rules.service.ts`

- [ ] **Step 1: Write tests for CRUD service**

Create `packages/backend/test/automation-rules/automation-rules.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AutomationRulesService } from '../../src/modules/automation-rules/automation-rules.service';
import { SupabaseService } from '../../src/shared/services/supabase.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('AutomationRulesService', () => {
  let service: AutomationRulesService;
  let mockSupabase: any;
  let mockClient: any;

  beforeEach(async () => {
    mockClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      maybeSingle: jest.fn(),
      order: jest.fn().mockReturnThis(),
    };
    mockSupabase = { getClient: jest.fn().mockReturnValue(mockClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationRulesService,
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get(AutomationRulesService);
  });

  describe('toggleRule', () => {
    it('should reject activation when plan limit is reached', async () => {
      // Mock: 3 active rules, plan limit is 3
      mockClient.single.mockResolvedValueOnce({
        data: { id: 'rule-1', is_active: false, workspace_id: 'ws-1' },
        error: null,
      });
      // Mock count of active rules
      mockClient.select.mockReturnValueOnce({
        eq: jest.fn().mockReturnThis(),
        then: jest.fn(),
      });

      jest.spyOn(service as any, 'getActiveRuleCount').mockResolvedValue(3);
      jest.spyOn(service as any, 'getPlanLimit').mockResolvedValue(3);

      await expect(service.toggleRule('user-1', 'rule-1')).rejects.toThrow(ForbiddenException);
    });

    it('should allow deactivation regardless of limit', async () => {
      mockClient.single
        .mockResolvedValueOnce({ data: { id: 'rule-1', is_active: true, workspace_id: 'ws-1' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'rule-1', is_active: false }, error: null });

      const result = await service.toggleRule('user-1', 'rule-1');
      expect(result.is_active).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx jest test/automation-rules/automation-rules.service.spec.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AutomationRulesService**

```typescript
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';

const RULE_COLUMNS = 'id, workspace_id, name, is_active, connection_id, target_entity, target_status, name_filter, action_type, budget_adjustment, evaluation_period, custom_start_date, frequency_minutes, daily_run_time, last_executed_at, created_at, updated_at';
const CONDITION_COLUMNS = 'id, rule_id, metric, operator, value';

@Injectable()
export class AutomationRulesService {
  private readonly logger = new Logger(AutomationRulesService.name);

  constructor(private readonly supabase: SupabaseService) {}

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
      const condRows = conditions.map((c) => ({
        rule_id: rule.id,
        metric: c.metric,
        operator: c.operator,
        value: c.value,
      }));

      const { data: conds, error: condError } = await client
        .from('automation_rule_conditions')
        .insert(condRows)
        .select(CONDITION_COLUMNS);

      if (condError) throw condError;
      savedConditions = conds || [];
    }

    return { ...rule, conditions: savedConditions };
  }

  async updateRule(userId: string, ruleId: string, dto: UpdateRuleDto) {
    const client = this.supabase.getClient();

    if (dto.action_type) {
      this.validateBudgetAction(dto.action_type, dto.budget_adjustment);
    }
    if (dto.frequency_minutes !== undefined) {
      this.validateDailyRunTime(dto.frequency_minutes, dto.daily_run_time);
    }
    if (dto.evaluation_period) {
      this.validateCustomPeriod(dto.evaluation_period, dto.custom_start_date);
    }

    const { conditions, ...updates } = dto;
    const updatePayload: Record<string, any> = { ...updates, updated_at: new Date().toISOString() };

    const { data: rule, error } = await client
      .from('automation_rules')
      .update(updatePayload)
      .eq('id', ruleId)
      .select(RULE_COLUMNS)
      .single();

    if (error) throw error;
    if (!rule) throw new NotFoundException('Rule not found');

    if (conditions !== undefined) {
      await client
        .from('automation_rule_conditions')
        .delete()
        .eq('rule_id', ruleId);

      let savedConditions: any[] = [];
      if (conditions.length > 0) {
        const condRows = conditions.map((c) => ({
          rule_id: ruleId,
          metric: c.metric,
          operator: c.operator,
          value: c.value,
        }));

        const { data: conds, error: condError } = await client
          .from('automation_rule_conditions')
          .insert(condRows)
          .select(CONDITION_COLUMNS);

        if (condError) throw condError;
        savedConditions = conds || [];
      }

      return { ...rule, conditions: savedConditions };
    }

    return rule;
  }

  async deleteRule(userId: string, ruleId: string) {
    const client = this.supabase.getClient();

    const { error } = await client
      .from('automation_rules')
      .delete()
      .eq('id', ruleId);

    if (error) throw error;
    return { success: true };
  }

  async toggleRule(userId: string, ruleId: string) {
    const client = this.supabase.getClient();

    const { data: rule, error } = await client
      .from('automation_rules')
      .select('id, is_active, workspace_id')
      .eq('id', ruleId)
      .single();

    if (error || !rule) throw new NotFoundException('Rule not found');

    const newState = !rule.is_active;

    if (newState) {
      const activeCount = await this.getActiveRuleCount(rule.workspace_id);
      const limit = await this.getPlanLimit(userId);

      if (limit !== null && activeCount >= limit) {
        throw new ForbiddenException(
          `Limite de regras ativas atingido (${limit}). Desative uma regra existente ou faça upgrade do plano.`,
        );
      }
    }

    const { data: updated, error: updateError } = await client
      .from('automation_rules')
      .update({ is_active: newState, updated_at: new Date().toISOString() })
      .eq('id', ruleId)
      .select(RULE_COLUMNS)
      .single();

    if (updateError) throw updateError;
    return updated;
  }

  async getActiveRuleCount(workspaceId: string): Promise<number> {
    const client = this.supabase.getClient();
    const { count, error } = await client
      .from('automation_rules')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (error) throw error;
    return count || 0;
  }

  async getPlanLimit(userId: string): Promise<number | null> {
    const client = this.supabase.getClient();

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('plan_id')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.plan_id) return 0;

    const { data: planRule, error: planError } = await client
      .from('plan_rules')
      .select('max_active_rules')
      .eq('plan_id', profile.plan_id)
      .single();

    if (planError || !planRule) return 0;
    return planRule.max_active_rules;
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
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && npx jest test/automation-rules/automation-rules.service.spec.ts --verbose`
Expected: Tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/automation-rules/automation-rules.service.ts packages/backend/test/automation-rules/
git commit -m "feat(backend): add AutomationRulesService with CRUD and plan limit validation"
```

---

## Task 4: Backend RuleEvaluatorService

**Files:**
- Create: `packages/backend/src/modules/automation-rules/rule-evaluator.service.ts`

- [ ] **Step 1: Write tests for evaluator**

Create `packages/backend/test/automation-rules/rule-evaluator.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { RuleEvaluatorService } from '../../src/modules/automation-rules/rule-evaluator.service';
import { LiveMetricsService } from '../../src/modules/metrics/live-metrics.service';

describe('RuleEvaluatorService', () => {
  let service: RuleEvaluatorService;
  let mockLiveMetrics: any;

  beforeEach(async () => {
    mockLiveMetrics = {
      getCampaigns: jest.fn(),
      getAdSets: jest.fn(),
      getAds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuleEvaluatorService,
        { provide: LiveMetricsService, useValue: mockLiveMetrics },
      ],
    }).compile();

    service = module.get(RuleEvaluatorService);
  });

  describe('evaluate', () => {
    const baseRule = {
      id: 'rule-1',
      workspace_id: 'ws-1',
      connection_id: null,
      target_entity: 'campaign',
      target_status: 'active',
      name_filter: null,
      evaluation_period: 'today',
      custom_start_date: null,
    };

    it('should return entities that match ALL conditions', async () => {
      mockLiveMetrics.getCampaigns.mockResolvedValue([
        { id: 'c1', name: 'Camp A', status: 'active', spend: 100, roas: 0.5 },
        { id: 'c2', name: 'Camp B', status: 'active', spend: 200, roas: 2.0 },
        { id: 'c3', name: 'Camp C', status: 'active', spend: 150, roas: 0.3 },
      ]);

      const conditions = [
        { metric: 'spend', operator: 'gt', value: 50 },
        { metric: 'roas', operator: 'lt', value: 1.0 },
      ];

      const result = await service.evaluate('user-1', baseRule as any, conditions);

      expect(result).toHaveLength(2);
      expect(result.map((e) => e.id)).toEqual(['c1', 'c3']);
    });

    it('should filter by target_status', async () => {
      mockLiveMetrics.getCampaigns.mockResolvedValue([
        { id: 'c1', name: 'Camp A', status: 'active', spend: 100 },
        { id: 'c2', name: 'Camp B', status: 'paused', spend: 200 },
      ]);

      const rule = { ...baseRule, target_status: 'paused' };
      const conditions = [{ metric: 'spend', operator: 'gt', value: 50 }];

      const result = await service.evaluate('user-1', rule as any, conditions);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c2');
    });

    it('should filter by name_filter (case-insensitive contains)', async () => {
      mockLiveMetrics.getCampaigns.mockResolvedValue([
        { id: 'c1', name: 'Black Friday Sale', status: 'active', spend: 100 },
        { id: 'c2', name: 'Summer Promo', status: 'active', spend: 200 },
      ]);

      const rule = { ...baseRule, name_filter: 'black' };
      const conditions = [{ metric: 'spend', operator: 'gt', value: 0 }];

      const result = await service.evaluate('user-1', rule as any, conditions);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
    });

    it('should return empty when no entities match conditions', async () => {
      mockLiveMetrics.getCampaigns.mockResolvedValue([
        { id: 'c1', name: 'Camp A', status: 'active', spend: 10, roas: 5.0 },
      ]);

      const conditions = [{ metric: 'spend', operator: 'gt', value: 1000 }];
      const result = await service.evaluate('user-1', baseRule as any, conditions);
      expect(result).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx jest test/automation-rules/rule-evaluator.service.spec.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RuleEvaluatorService**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { LiveMetricsService } from '../metrics/live-metrics.service';

interface RuleForEvaluation {
  id: string;
  workspace_id: string;
  connection_id: string | null;
  target_entity: string;
  target_status: string;
  name_filter: string | null;
  evaluation_period: string;
  custom_start_date: string | null;
}

interface Condition {
  metric: string;
  operator: string;
  value: number;
}

interface MatchedEntity {
  id: string;
  name: string;
  ad_account_id?: string;
  metricsSnapshot: Record<string, number>;
}

@Injectable()
export class RuleEvaluatorService {
  private readonly logger = new Logger(RuleEvaluatorService.name);

  constructor(private readonly liveMetrics: LiveMetricsService) {}

  async evaluate(
    userId: string,
    rule: RuleForEvaluation,
    conditions: Condition[],
  ): Promise<MatchedEntity[]> {
    const { from, to } = this.resolveDateRange(rule.evaluation_period, rule.custom_start_date);
    const filters: any = {
      from,
      to,
      workspace_id: rule.workspace_id,
    };

    if (rule.connection_id) {
      filters.connection_ids = [rule.connection_id];
    }

    const entities = await this.fetchEntities(userId, rule.target_entity, filters);

    const filtered = entities.filter((entity) => {
      if (rule.target_status !== 'any' && entity.status !== rule.target_status) {
        return false;
      }
      if (rule.name_filter && !entity.name.toLowerCase().includes(rule.name_filter.toLowerCase())) {
        return false;
      }
      return this.matchesAllConditions(entity, conditions);
    });

    return filtered.map((entity) => ({
      id: entity.id,
      name: entity.name,
      ad_account_id: entity.ad_account_id,
      metricsSnapshot: this.extractMetrics(entity),
    }));
  }

  private async fetchEntities(userId: string, targetEntity: string, filters: any): Promise<any[]> {
    switch (targetEntity) {
      case 'campaign':
        return this.liveMetrics.getCampaigns(userId, filters);
      case 'adset':
        return this.liveMetrics.getAdSets(userId, filters);
      case 'ad':
        return this.liveMetrics.getAds(userId, filters);
      default:
        return [];
    }
  }

  private matchesAllConditions(entity: any, conditions: Condition[]): boolean {
    return conditions.every((condition) => {
      const metricValue = this.getMetricValue(entity, condition.metric);
      return this.compareValues(metricValue, condition.operator, condition.value);
    });
  }

  private getMetricValue(entity: any, metric: string): number {
    const metricMap: Record<string, string> = {
      spend: 'spend',
      cpa: 'cpa_real',
      roi: 'roi',
      roas: 'roas',
      profit: 'profit',
      profit_margin: 'profit_margin',
      cpc: 'cpc',
      ctr: 'ctr',
      cpm: 'cpm',
      impressions: 'impressions',
      clicks: 'clicks',
      conversions: 'conversions',
    };

    const key = metricMap[metric] || metric;
    const value = entity[key];
    return typeof value === 'number' ? value : 0;
  }

  private compareValues(actual: number, operator: string, expected: number): boolean {
    switch (operator) {
      case 'gt': return actual > expected;
      case 'lt': return actual < expected;
      case 'gte': return actual >= expected;
      case 'lte': return actual <= expected;
      default: return false;
    }
  }

  private extractMetrics(entity: any): Record<string, number> {
    return {
      spend: entity.spend || 0,
      cpa: entity.cpa_real || 0,
      roi: entity.roi || 0,
      roas: entity.roas || 0,
      cpc: entity.cpc || 0,
      ctr: entity.ctr || 0,
      cpm: entity.cpm || 0,
      impressions: entity.impressions || 0,
      clicks: entity.clicks || 0,
      conversions: entity.conversions || 0,
      revenue: entity.revenue || 0,
      sales: entity.sales || 0,
    };
  }

  private resolveDateRange(period: string, customStartDate: string | null): { from: string; to: string } {
    const today = new Date();
    const toStr = (d: Date) => d.toISOString().split('T')[0];
    const to = toStr(today);

    switch (period) {
      case 'today':
        return { from: to, to };
      case 'yesterday': {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { from: toStr(yesterday), to: toStr(yesterday) };
      }
      case 'last_7d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 7);
        return { from: toStr(d), to };
      }
      case 'last_30d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
        return { from: toStr(d), to };
      }
      case 'custom':
        return { from: customStartDate || to, to };
      default:
        return { from: to, to };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && npx jest test/automation-rules/rule-evaluator.service.spec.ts --verbose`
Expected: All 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/automation-rules/rule-evaluator.service.ts packages/backend/test/automation-rules/rule-evaluator.service.spec.ts
git commit -m "feat(backend): add RuleEvaluatorService with live metric evaluation and condition matching"
```

---

## Task 5: Backend RuleExecutorService

**Files:**
- Create: `packages/backend/src/modules/automation-rules/rule-executor.service.ts`

- [ ] **Step 1: Write tests for executor**

Create `packages/backend/test/automation-rules/rule-executor.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { RuleExecutorService } from '../../src/modules/automation-rules/rule-executor.service';
import { FacebookService } from '../../src/modules/facebook/facebook.service';

describe('RuleExecutorService', () => {
  let service: RuleExecutorService;
  let mockFacebook: any;

  beforeEach(async () => {
    mockFacebook = {
      updateStatus: jest.fn().mockResolvedValue({ success: true }),
      updateBudget: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuleExecutorService,
        { provide: FacebookService, useValue: mockFacebook },
      ],
    }).compile();

    service = module.get(RuleExecutorService);
  });

  describe('execute', () => {
    it('should call updateStatus for pause action', async () => {
      const entities = [{ id: 'c1', name: 'Camp A', ad_account_id: 'act_123', metricsSnapshot: {} }];

      const results = await service.execute('user-1', 'pause', 'campaign', entities, null);

      expect(mockFacebook.updateStatus).toHaveBeenCalledWith('user-1', {
        facebook_id: 'c1',
        status: 'PAUSED',
        type: 'campaign',
        ad_account_id: 'act_123',
      });
      expect(results[0].status).toBe('success');
    });

    it('should calculate percentage budget increase with max cap', async () => {
      const entities = [{
        id: 'c1', name: 'Camp A', ad_account_id: 'act_123',
        metricsSnapshot: { daily_budget: 100 },
      }];
      const budgetAdj = { mode: 'percentage', value: 50, budget_type: 'daily', max_budget: 120 };

      await service.execute('user-1', 'increase_budget', 'campaign', entities, budgetAdj);

      // 100 + 50% = 150, but capped at max 120 → 12000 cents
      expect(mockFacebook.updateBudget).toHaveBeenCalledWith('user-1', {
        type: 'campaign',
        facebook_id: 'c1',
        budget_type: 'daily',
        amount: 12000,
        ad_account_id: 'act_123',
      });
    });

    it('should calculate percentage budget decrease with min floor', async () => {
      const entities = [{
        id: 'c1', name: 'Camp A', ad_account_id: 'act_123',
        metricsSnapshot: { daily_budget: 100 },
      }];
      const budgetAdj = { mode: 'percentage', value: 80, budget_type: 'daily', min_budget: 50 };

      await service.execute('user-1', 'decrease_budget', 'campaign', entities, budgetAdj);

      // 100 - 80% = 20, but floored at min 50 → 5000 cents
      expect(mockFacebook.updateBudget).toHaveBeenCalledWith('user-1', {
        type: 'campaign',
        facebook_id: 'c1',
        budget_type: 'daily',
        amount: 5000,
        ad_account_id: 'act_123',
      });
    });

    it('should set fixed budget amount', async () => {
      const entities = [{ id: 'c1', name: 'Camp A', ad_account_id: 'act_123', metricsSnapshot: {} }];
      const budgetAdj = { mode: 'fixed', value: 500, budget_type: 'daily' };

      await service.execute('user-1', 'increase_budget', 'campaign', entities, budgetAdj);

      expect(mockFacebook.updateBudget).toHaveBeenCalledWith('user-1', {
        type: 'campaign',
        facebook_id: 'c1',
        budget_type: 'daily',
        amount: 50000,
        ad_account_id: 'act_123',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx jest test/automation-rules/rule-executor.service.spec.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RuleExecutorService**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { FacebookService } from '../facebook/facebook.service';

interface MatchedEntity {
  id: string;
  name: string;
  ad_account_id?: string;
  metricsSnapshot: Record<string, number>;
}

interface BudgetAdjustment {
  mode: 'percentage' | 'fixed';
  value: number;
  budget_type: 'daily' | 'lifetime';
  min_budget?: number;
  max_budget?: number;
}

interface ExecutionResult {
  entityId: string;
  entityName: string;
  actionTaken: string;
  status: 'success' | 'error';
  errorMessage?: string;
}

@Injectable()
export class RuleExecutorService {
  private readonly logger = new Logger(RuleExecutorService.name);

  constructor(private readonly facebook: FacebookService) {}

  async execute(
    userId: string,
    actionType: string,
    targetEntity: string,
    entities: MatchedEntity[],
    budgetAdjustment: BudgetAdjustment | null,
  ): Promise<ExecutionResult[]> {
    const results = await Promise.allSettled(
      entities.map((entity) =>
        this.executeOnEntity(userId, actionType, targetEntity, entity, budgetAdjustment),
      ),
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      return {
        entityId: entities[i].id,
        entityName: entities[i].name,
        actionTaken: actionType,
        status: 'error' as const,
        errorMessage: result.reason?.message || 'Unknown error',
      };
    });
  }

  private async executeOnEntity(
    userId: string,
    actionType: string,
    targetEntity: string,
    entity: MatchedEntity,
    budgetAdjustment: BudgetAdjustment | null,
  ): Promise<ExecutionResult> {
    const fbType = targetEntity === 'adset' ? 'adset' : targetEntity;

    switch (actionType) {
      case 'activate':
        await this.facebook.updateStatus(userId, {
          facebook_id: entity.id,
          status: 'ACTIVE',
          type: fbType,
          ad_account_id: entity.ad_account_id,
        });
        return { entityId: entity.id, entityName: entity.name, actionTaken: 'activated', status: 'success' };

      case 'pause':
        await this.facebook.updateStatus(userId, {
          facebook_id: entity.id,
          status: 'PAUSED',
          type: fbType,
          ad_account_id: entity.ad_account_id,
        });
        return { entityId: entity.id, entityName: entity.name, actionTaken: 'paused', status: 'success' };

      case 'increase_budget':
      case 'decrease_budget': {
        const amount = this.calculateBudgetAmount(
          actionType,
          entity.metricsSnapshot,
          budgetAdjustment!,
        );
        const actionDesc = this.describeBudgetAction(actionType, budgetAdjustment!, amount);

        await this.facebook.updateBudget(userId, {
          type: fbType,
          facebook_id: entity.id,
          budget_type: budgetAdjustment!.budget_type,
          amount: Math.round(amount * 100), // convert to cents
          ad_account_id: entity.ad_account_id,
        });

        return { entityId: entity.id, entityName: entity.name, actionTaken: actionDesc, status: 'success' };
      }

      default:
        return { entityId: entity.id, entityName: entity.name, actionTaken: actionType, status: 'error', errorMessage: `Unknown action: ${actionType}` };
    }
  }

  private calculateBudgetAmount(
    actionType: string,
    metrics: Record<string, number>,
    adjustment: BudgetAdjustment,
  ): number {
    let newAmount: number;

    if (adjustment.mode === 'fixed') {
      newAmount = adjustment.value;
    } else {
      const budgetKey = adjustment.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget';
      const currentBudget = metrics[budgetKey] || 0;
      const change = currentBudget * (adjustment.value / 100);

      newAmount = actionType === 'increase_budget'
        ? currentBudget + change
        : currentBudget - change;
    }

    if (adjustment.min_budget !== undefined && adjustment.min_budget !== null) {
      newAmount = Math.max(newAmount, adjustment.min_budget);
    }
    if (adjustment.max_budget !== undefined && adjustment.max_budget !== null) {
      newAmount = Math.min(newAmount, adjustment.max_budget);
    }

    return Math.max(newAmount, 1); // Facebook minimum is R$ 1.00
  }

  private describeBudgetAction(actionType: string, adjustment: BudgetAdjustment, finalAmount: number): string {
    const direction = actionType === 'increase_budget' ? 'increased' : 'decreased';
    if (adjustment.mode === 'percentage') {
      return `budget_${direction}_${adjustment.value}%_to_${finalAmount.toFixed(2)}`;
    }
    return `budget_set_to_${finalAmount.toFixed(2)}`;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && npx jest test/automation-rules/rule-executor.service.spec.ts --verbose`
Expected: All 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/automation-rules/rule-executor.service.ts packages/backend/test/automation-rules/rule-executor.service.spec.ts
git commit -m "feat(backend): add RuleExecutorService with budget calculation and min/max limits"
```

---

## Task 6: Backend RuleNotifierService

**Files:**
- Create: `packages/backend/src/modules/automation-rules/rule-notifier.service.ts`

- [ ] **Step 1: Implement RuleNotifierService**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../shared/services/supabase.service';

interface ExecutionResult {
  entityId: string;
  entityName: string;
  actionTaken: string;
  status: 'success' | 'error';
  errorMessage?: string;
}

interface ExecutionLogEntry {
  rule_id: string;
  workspace_id: string;
  entity_facebook_id: string;
  entity_name: string;
  action_taken: string;
  metrics_snapshot: Record<string, number>;
  status: string;
  error_message: string | null;
}

@Injectable()
export class RuleNotifierService {
  private readonly logger = new Logger(RuleNotifierService.name);
  private readonly discordWebhookUrl: string | undefined;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {
    this.discordWebhookUrl = this.config.get<string>('DISCORD_RULES_WEBHOOK_URL');
  }

  async notify(
    ruleId: string,
    ruleName: string,
    workspaceId: string,
    results: ExecutionResult[],
    metricsSnapshots: Map<string, Record<string, number>>,
  ): Promise<void> {
    await Promise.allSettled([
      this.saveExecutionLogs(ruleId, workspaceId, results, metricsSnapshots),
      this.sendDiscordNotification(ruleName, results),
    ]);
  }

  private async saveExecutionLogs(
    ruleId: string,
    workspaceId: string,
    results: ExecutionResult[],
    metricsSnapshots: Map<string, Record<string, number>>,
  ): Promise<void> {
    if (results.length === 0) return;

    const rows: ExecutionLogEntry[] = results.map((r) => ({
      rule_id: ruleId,
      workspace_id: workspaceId,
      entity_facebook_id: r.entityId,
      entity_name: r.entityName,
      action_taken: r.actionTaken,
      metrics_snapshot: metricsSnapshots.get(r.entityId) || {},
      status: r.status,
      error_message: r.errorMessage || null,
    }));

    const client = this.supabase.getClient();
    const { error } = await client
      .from('automation_rule_executions')
      .insert(rows);

    if (error) {
      this.logger.error(`Failed to save execution logs for rule ${ruleId}: ${error.message}`);
    }
  }

  private async sendDiscordNotification(ruleName: string, results: ExecutionResult[]): Promise<void> {
    if (!this.discordWebhookUrl || results.length === 0) return;

    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    const lines = results.slice(0, 10).map((r) => {
      const icon = r.status === 'success' ? '✅' : '❌';
      const detail = r.status === 'error' ? `Erro: ${r.errorMessage}` : `Ação: ${r.actionTaken}`;
      return `${icon} **${r.entityName}** — ${detail}`;
    });

    const content = [
      `📋 **Regra Executada:** ${ruleName}`,
      `🎯 Entidades afetadas: ${results.length} (${successCount} sucesso, ${errorCount} erro)`,
      '',
      ...lines,
      results.length > 10 ? `\n... e mais ${results.length - 10} entidades` : '',
    ].join('\n');

    try {
      const response = await fetch(this.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        this.logger.warn(`Discord webhook returned ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Discord notification failed: ${(error as Error).message}`);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/modules/automation-rules/rule-notifier.service.ts
git commit -m "feat(backend): add RuleNotifierService with execution logs and Discord webhook"
```

---

## Task 7: Backend RuleSchedulerService

**Files:**
- Create: `packages/backend/src/modules/automation-rules/rule-scheduler.service.ts`

- [ ] **Step 1: Implement RuleSchedulerService**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../shared/services/supabase.service';
import { RuleEvaluatorService } from './rule-evaluator.service';
import { RuleExecutorService } from './rule-executor.service';
import { RuleNotifierService } from './rule-notifier.service';

const ADVISORY_LOCK_KEY = 777_888_999; // unique int for this scheduler
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

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (this.isRunning) {
      this.logger.debug('[scheduler] Previous cycle still running — skipping');
      return;
    }

    this.isRunning = true;
    const t0 = Date.now();

    try {
      const client = this.supabase.getClient();

      // Try advisory lock
      const { data: lockResult } = await client.rpc('pg_try_advisory_lock', { key: ADVISORY_LOCK_KEY });
      if (!lockResult) {
        this.logger.debug('[scheduler] Could not acquire lock — another instance is processing');
        return;
      }

      try {
        const rules = await this.getDueRules();
        if (rules.length === 0) {
          this.logger.debug(`[scheduler] No rules due — done in ${Date.now() - t0}ms`);
          return;
        }

        this.logger.log(`[scheduler] ${rules.length} rule(s) due for evaluation`);

        // Process rules sequentially to avoid Facebook API rate limits
        for (const rule of rules) {
          await this.processRule(rule);
        }

        this.logger.log(`[scheduler] Cycle complete in ${Date.now() - t0}ms | ${rules.length} rule(s) processed`);
      } finally {
        await client.rpc('pg_advisory_unlock', { key: ADVISORY_LOCK_KEY });
      }
    } catch (error) {
      this.logger.error(`[scheduler] Cycle failed: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async getDueRules(): Promise<any[]> {
    const client = this.supabase.getClient();
    const now = new Date();

    const { data: rules, error } = await client
      .from('automation_rules')
      .select(RULE_COLUMNS)
      .eq('is_active', true);

    if (error) throw error;
    if (!rules || rules.length === 0) return [];

    return rules.filter((rule) => this.isRuleDue(rule, now));
  }

  private isRuleDue(rule: any, now: Date): boolean {
    if (!rule.last_executed_at) return true;

    if (rule.frequency_minutes === 1440) {
      return this.isDailyRuleDue(rule, now);
    }

    const lastExec = new Date(rule.last_executed_at);
    const elapsedMs = now.getTime() - lastExec.getTime();
    const frequencyMs = rule.frequency_minutes * 60 * 1000;
    return elapsedMs >= frequencyMs;
  }

  private isDailyRuleDue(rule: any, now: Date): boolean {
    if (!rule.daily_run_time) return false;

    // Convert now to Sao Paulo time
    const spNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const [hours, minutes] = rule.daily_run_time.split(':').map(Number);
    const scheduledToday = new Date(spNow);
    scheduledToday.setHours(hours, minutes, 0, 0);

    // Has the scheduled time passed today?
    if (spNow < scheduledToday) return false;

    // Did it already execute today?
    const lastExec = new Date(rule.last_executed_at);
    const spLastExec = new Date(lastExec.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const sameDay = spNow.toDateString() === spLastExec.toDateString();

    return !sameDay;
  }

  private async processRule(rule: any): Promise<void> {
    const t0 = Date.now();
    const client = this.supabase.getClient();

    try {
      // Fetch conditions
      const { data: conditions, error: condError } = await client
        .from('automation_rule_conditions')
        .select(CONDITION_COLUMNS)
        .eq('rule_id', rule.id);

      if (condError) throw condError;
      if (!conditions || conditions.length === 0) {
        this.logger.warn(`[scheduler] Rule ${rule.name} has no conditions — skipping`);
        await this.updateLastExecuted(rule.id);
        return;
      }

      // Find the user_id for this workspace
      const { data: workspace, error: wsError } = await client
        .from('workspaces')
        .select('user_id')
        .eq('id', rule.workspace_id)
        .single();

      if (wsError || !workspace) {
        this.logger.error(`[scheduler] Workspace not found for rule ${rule.name}`);
        return;
      }

      // Evaluate
      const matchedEntities = await this.evaluator.evaluate(workspace.user_id, rule, conditions);

      if (matchedEntities.length === 0) {
        this.logger.log(`[scheduler] Rule "${rule.name}" — no matching entities (${Date.now() - t0}ms)`);
        await this.updateLastExecuted(rule.id);
        return;
      }

      // Execute
      const results = await this.executor.execute(
        workspace.user_id,
        rule.action_type,
        rule.target_entity,
        matchedEntities,
        rule.budget_adjustment,
      );

      // Build metrics snapshot map
      const metricsMap = new Map<string, Record<string, number>>();
      for (const entity of matchedEntities) {
        metricsMap.set(entity.id, entity.metricsSnapshot);
      }

      // Notify
      await this.notifier.notify(rule.id, rule.name, rule.workspace_id, results, metricsMap);

      // Update last_executed_at
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
    await client
      .from('automation_rules')
      .update({ last_executed_at: new Date().toISOString() })
      .eq('id', ruleId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/modules/automation-rules/rule-scheduler.service.ts
git commit -m "feat(backend): add RuleSchedulerService with cron, advisory lock, and orchestration"
```

---

## Task 8: Backend Controller + Module + Registration

**Files:**
- Create: `packages/backend/src/modules/automation-rules/automation-rules.controller.ts`
- Create: `packages/backend/src/modules/automation-rules/automation-rules.module.ts`
- Modify: `packages/backend/src/app.module.ts:16-38`

- [ ] **Step 1: Create the controller**

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AutomationRulesService } from './automation-rules.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { SupabaseService } from '../../shared/services/supabase.service';

@Controller('automation-rules')
@UseGuards(AuthGuard)
export class AutomationRulesController {
  constructor(
    private readonly rulesService: AutomationRulesService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get()
  async getRules(
    @CurrentUser('id') userId: string,
    @Query('workspace_id') workspaceId: string,
  ) {
    return this.rulesService.getRules(userId, workspaceId);
  }

  @Post()
  async createRule(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRuleDto,
  ) {
    return this.rulesService.createRule(userId, dto);
  }

  @Patch(':id')
  async updateRule(
    @CurrentUser('id') userId: string,
    @Param('id') ruleId: string,
    @Body() dto: UpdateRuleDto,
  ) {
    return this.rulesService.updateRule(userId, ruleId, dto);
  }

  @Delete(':id')
  async deleteRule(
    @CurrentUser('id') userId: string,
    @Param('id') ruleId: string,
  ) {
    return this.rulesService.deleteRule(userId, ruleId);
  }

  @Patch(':id/toggle')
  async toggleRule(
    @CurrentUser('id') userId: string,
    @Param('id') ruleId: string,
  ) {
    return this.rulesService.toggleRule(userId, ruleId);
  }

  @Get(':id/history')
  async getHistory(
    @CurrentUser('id') userId: string,
    @Param('id') ruleId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const client = this.supabase.getClient();
    const pageSize = Math.min(parseInt(limit || '20', 10), 100);

    let query = client
      .from('automation_rule_executions')
      .select('id, rule_id, entity_facebook_id, entity_name, action_taken, metrics_snapshot, status, error_message, executed_at')
      .eq('rule_id', ruleId)
      .order('executed_at', { ascending: false })
      .limit(pageSize);

    if (cursor) {
      query = query.lt('executed_at', cursor);
    }

    const { data, error } = await query;
    if (error) throw error;

    const items = data || [];
    const nextCursor = items.length === pageSize ? items[items.length - 1].executed_at : null;

    return { items, nextCursor };
  }
}
```

- [ ] **Step 2: Create the module**

```typescript
import { Module } from '@nestjs/common';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';
import { RuleSchedulerService } from './rule-scheduler.service';
import { RuleEvaluatorService } from './rule-evaluator.service';
import { RuleExecutorService } from './rule-executor.service';
import { RuleNotifierService } from './rule-notifier.service';
import { FacebookModule } from '../facebook/facebook.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [FacebookModule, MetricsModule],
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
```

- [ ] **Step 3: Register in AppModule**

In `packages/backend/src/app.module.ts`, add:
- Import line: `import { AutomationRulesModule } from './modules/automation-rules/automation-rules.module';`
- Add `AutomationRulesModule` to the imports array after `MetricsModule`

- [ ] **Step 4: Verify backend builds**

Run: `cd packages/backend && npx nest build`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/automation-rules/automation-rules.controller.ts packages/backend/src/modules/automation-rules/automation-rules.module.ts packages/backend/src/app.module.ts
git commit -m "feat(backend): add AutomationRulesController, module, and register in AppModule"
```

---

## Task 9: Frontend Hooks

**Files:**
- Create: `packages/frontend/src/hooks/useAutomationRules.ts`
- Create: `packages/frontend/src/hooks/useRuleHistory.ts`

- [ ] **Step 1: Create useAutomationRules hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = (await import('@/integrations/supabase/client')).supabase.auth.getSession()
    .then(({ data }) => data.session?.access_token);
  const accessToken = await token;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${res.status}`);
  }

  return res.json();
}

export interface AutomationRuleCondition {
  id: string;
  rule_id: string;
  metric: string;
  operator: string;
  value: number;
}

export interface AutomationRule {
  id: string;
  workspace_id: string;
  name: string;
  is_active: boolean;
  connection_id: string | null;
  target_entity: string;
  target_status: string;
  name_filter: string | null;
  action_type: string;
  budget_adjustment: {
    mode: 'percentage' | 'fixed';
    value: number;
    budget_type: 'daily' | 'lifetime';
    min_budget?: number;
    max_budget?: number;
  } | null;
  evaluation_period: string;
  custom_start_date: string | null;
  frequency_minutes: number;
  daily_run_time: string | null;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
  conditions: AutomationRuleCondition[];
}

export function useAutomationRules() {
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();
  const effectiveId = getEffectiveUserId(user?.id);

  const queryKey = ['automation-rules', effectiveId, activeWorkspaceId];

  const { data: rules = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiFetch<AutomationRule[]>(`/automation-rules?workspace_id=${activeWorkspaceId}`),
    enabled: !!effectiveId && !!activeWorkspaceId,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiFetch('/automation-rules', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Regra criada com sucesso');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }: any) => apiFetch(`/automation-rules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Regra atualizada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/automation-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Regra excluída');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/automation-rules/${id}/toggle`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const activeCount = rules.filter((r) => r.is_active).length;

  return {
    rules,
    loading: isLoading,
    error: error?.message || null,
    activeCount,
    createRule: createMutation.mutateAsync,
    updateRule: updateMutation.mutateAsync,
    deleteRule: deleteMutation.mutateAsync,
    toggleRule: toggleMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}
```

- [ ] **Step 2: Create useRuleHistory hook**

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface RuleExecution {
  id: string;
  rule_id: string;
  entity_facebook_id: string;
  entity_name: string;
  action_taken: string;
  metrics_snapshot: Record<string, number>;
  status: 'success' | 'error';
  error_message: string | null;
  executed_at: string;
}

interface HistoryPage {
  items: RuleExecution[];
  nextCursor: string | null;
}

export function useRuleHistory(ruleId: string | null) {
  const { user } = useAuth();

  return useInfiniteQuery<HistoryPage>({
    queryKey: ['rule-history', ruleId],
    queryFn: async ({ pageParam }) => {
      const session = await (await import('@/integrations/supabase/client')).supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam as string);

      const res = await fetch(`${API_BASE}/automation-rules/${ruleId}/history?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to fetch history');
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!ruleId && !!user,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useAutomationRules.ts packages/frontend/src/hooks/useRuleHistory.ts
git commit -m "feat(frontend): add useAutomationRules and useRuleHistory hooks"
```

---

## Task 10: Frontend Components — ConditionBuilder + BudgetConfig

**Files:**
- Create: `packages/frontend/src/components/rules/ConditionBuilder.tsx`
- Create: `packages/frontend/src/components/rules/BudgetConfig.tsx`

- [ ] **Step 1: Create ConditionBuilder**

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, X, Check } from 'lucide-react';
import { useState } from 'react';

const METRICS = [
  { value: 'spend', label: 'Gasto' },
  { value: 'cpa', label: 'CPA' },
  { value: 'roi', label: 'ROI' },
  { value: 'roas', label: 'ROAS' },
  { value: 'profit', label: 'Lucro' },
  { value: 'profit_margin', label: 'Margem de Lucro' },
  { value: 'cpc', label: 'CPC' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpm', label: 'CPM' },
  { value: 'impressions', label: 'Impressões' },
  { value: 'clicks', label: 'Cliques' },
  { value: 'conversions', label: 'Conversões' },
];

const OPERATORS = [
  { value: 'gt', label: 'Maior que' },
  { value: 'lt', label: 'Menor que' },
  { value: 'gte', label: 'Maior ou igual a' },
  { value: 'lte', label: 'Menor ou igual a' },
];

export interface ConditionInput {
  metric: string;
  operator: string;
  value: number;
}

interface ConditionBuilderProps {
  conditions: ConditionInput[];
  onChange: (conditions: ConditionInput[]) => void;
}

export function ConditionBuilder({ conditions, onChange }: ConditionBuilderProps) {
  const [draft, setDraft] = useState<{ metric: string; operator: string; value: string }>({
    metric: '',
    operator: '',
    value: '',
  });
  const [showDraft, setShowDraft] = useState(false);

  const confirmDraft = () => {
    if (!draft.metric || !draft.operator || !draft.value) return;
    const numValue = parseFloat(draft.value);
    if (isNaN(numValue)) return;

    onChange([...conditions, { metric: draft.metric, operator: draft.operator, value: numValue }]);
    setDraft({ metric: '', operator: '', value: '' });
    setShowDraft(false);
  };

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const getMetricLabel = (value: string) => METRICS.find((m) => m.value === value)?.label || value;
  const getOperatorLabel = (value: string) => OPERATORS.find((o) => o.value === value)?.label || value;

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Condições <span className="text-xs">(todas devem ser verdadeiras)</span>
      </div>

      {/* Saved conditions */}
      {conditions.map((cond, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">{getMetricLabel(cond.metric)}</span>
          <span className="text-muted-foreground">{getOperatorLabel(cond.operator)}</span>
          <span>{cond.value}</span>
          <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => removeCondition(i)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {/* Draft condition */}
      {showDraft && (
        <div className="flex items-center gap-2">
          <Select value={draft.metric} onValueChange={(v) => setDraft({ ...draft, metric: v })}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Métrica" /></SelectTrigger>
            <SelectContent>
              {METRICS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={draft.operator} onValueChange={(v) => setDraft({ ...draft, operator: v })}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Operador" /></SelectTrigger>
            <SelectContent>
              {OPERATORS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="number"
            step="any"
            placeholder="Valor"
            className="w-[100px]"
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && confirmDraft()}
          />

          <Button variant="ghost" size="icon" className="h-8 w-8 text-green-500" onClick={confirmDraft}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setShowDraft(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {!showDraft && (
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowDraft(true)}>
          <Plus className="h-3.5 w-3.5" /> Adicionar condição
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create BudgetConfig**

```tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface BudgetAdjustmentInput {
  mode: 'percentage' | 'fixed';
  value: string;
  budget_type: 'daily' | 'lifetime';
  min_budget: string;
  max_budget: string;
}

interface BudgetConfigProps {
  value: BudgetAdjustmentInput;
  onChange: (value: BudgetAdjustmentInput) => void;
}

export function BudgetConfig({ value, onChange }: BudgetConfigProps) {
  const update = (partial: Partial<BudgetAdjustmentInput>) => onChange({ ...value, ...partial });

  return (
    <div className="rounded-lg border border-dashed p-4 space-y-3">
      <div className="text-sm font-medium text-muted-foreground">Configuração de Orçamento</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Modo</Label>
          <Select value={value.mode} onValueChange={(v) => update({ mode: v as 'percentage' | 'fixed' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Porcentagem</SelectItem>
              <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Valor {value.mode === 'percentage' ? '(%)' : '(R$)'}</Label>
          <Input
            type="number"
            step="any"
            min="0"
            placeholder={value.mode === 'percentage' ? '20' : '500.00'}
            value={value.value}
            onChange={(e) => update({ value: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tipo de orçamento</Label>
          <Select value={value.budget_type} onValueChange={(v) => update({ budget_type: v as 'daily' | 'lifetime' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Diário</SelectItem>
              <SelectItem value="lifetime">Vitalício</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div />

        <div className="space-y-1.5">
          <Label className="text-xs">Orçamento mínimo (R$)</Label>
          <Input
            type="number"
            step="any"
            min="0"
            placeholder="Sem limite"
            value={value.min_budget}
            onChange={(e) => update({ min_budget: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Orçamento máximo (R$)</Label>
          <Input
            type="number"
            step="any"
            min="0"
            placeholder="Sem limite"
            value={value.max_budget}
            onChange={(e) => update({ max_budget: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/rules/
git commit -m "feat(frontend): add ConditionBuilder and BudgetConfig components"
```

---

## Task 11: Frontend Components — RuleFormModal

**Files:**
- Create: `packages/frontend/src/components/rules/RuleFormModal.tsx`

- [ ] **Step 1: Create RuleFormModal**

This is a large component — create at `packages/frontend/src/components/rules/RuleFormModal.tsx`. It uses the `Dialog` from shadcn/ui, the `ConditionBuilder`, and the `BudgetConfig` components. It handles both create and edit modes.

Key form fields: name, connection_id (select from connections), target (combined entity+status), name_filter, action_type, budget_adjustment (conditional), conditions, evaluation_period, custom_start_date (conditional), frequency_minutes, daily_run_time (conditional).

The `onSave` callback receives the assembled `CreateRuleDto`-shaped payload. Uses `useFacebookConnection` hook (already exists) to list available connections for the select.

See spec section 5.3 for full field list and behavior.

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/rules/RuleFormModal.tsx
git commit -m "feat(frontend): add RuleFormModal with full form and conditional fields"
```

---

## Task 12: Frontend Components — RuleCard, RuleHistoryDrawer, RulesList

**Files:**
- Create: `packages/frontend/src/components/rules/RuleCard.tsx`
- Create: `packages/frontend/src/components/rules/RuleHistoryDrawer.tsx`
- Create: `packages/frontend/src/components/rules/RulesList.tsx`

- [ ] **Step 1: Create RuleCard**

Uses Lucide icons (`Pencil`, `ClipboardList`, `Trash2`) for actions. Shows toggle switch for active/inactive state. Displays rule summary (target, frequency, action, conditions). See spec section 5.2.

- [ ] **Step 2: Create RuleHistoryDrawer**

Uses `Sheet` from shadcn/ui. Uses `useRuleHistory` hook with infinite scroll ("Carregar mais..."). Each execution shows entity name, action, metrics, status badge. See spec section 5.4.

- [ ] **Step 3: Create RulesList**

Header with title + active count + "Nova Regra" button. Maps rules to `RuleCard` components. Manages open state for `RuleFormModal` and `RuleHistoryDrawer`.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/rules/RuleCard.tsx packages/frontend/src/components/rules/RuleHistoryDrawer.tsx packages/frontend/src/components/rules/RulesList.tsx
git commit -m "feat(frontend): add RuleCard, RuleHistoryDrawer, and RulesList components"
```

---

## Task 13: Frontend Page + Routing + Sidebar

**Files:**
- Create: `packages/frontend/src/pages/Rules.tsx`
- Modify: `packages/frontend/src/App.tsx:18-82`
- Modify: `packages/frontend/src/components/Sidebar.tsx:6-28`

- [ ] **Step 1: Create Rules page**

```tsx
import { DashboardLayout } from '@/components/DashboardLayout';
import { RulesList } from '@/components/rules/RulesList';

export default function Rules() {
  return (
    <DashboardLayout>
      <RulesList />
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Add lazy import and route in App.tsx**

In `packages/frontend/src/App.tsx`:

Add after line 27 (`const Financial = lazy(...)`:
```typescript
const Rules = lazy(() => import("./pages/Rules"));
```

Add after the `/financial` route (line 81):
```tsx
<Route path="/rules" element={<ProtectedRoute><Rules /></ProtectedRoute>} />
```

- [ ] **Step 3: Add sidebar nav item**

In `packages/frontend/src/components/Sidebar.tsx`:

Add `Zap` to the lucide-react import on line 6:
```typescript
import {
  LayoutDashboard,
  Megaphone,
  ShoppingCart,
  Link2,
  DollarSign,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Zap,
} from 'lucide-react';
```

Add to `navItems` array after the `/campaigns` entry (line 23):
```typescript
const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns', icon: Megaphone, label: 'Campanhas' },
  { to: '/rules', icon: Zap, label: 'Regras' },
  { to: '/sales', icon: ShoppingCart, label: 'Vendas' },
  { to: '/integrations', icon: Link2, label: 'Integrações' },
  { to: '/financial', icon: DollarSign, label: 'Financeiro' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
];
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd packages/frontend && npx vite build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/Rules.tsx packages/frontend/src/App.tsx packages/frontend/src/components/Sidebar.tsx
git commit -m "feat(frontend): add Rules page, route, and sidebar navigation"
```

---

## Task 14: Documentation

**Files:**
- Create: `docs/features/14-automation-rules/README.md`
- Modify: `SQL_DATABASE.md`

- [ ] **Step 1: Create feature documentation**

Create `docs/features/14-automation-rules/README.md` following the template in `docs/features/TEMPLATE.md`. Include: objective, data model (3 tables), API endpoints (6), frontend components, business rules (plan limits, AND conditions, frequency options, budget min/max).

- [ ] **Step 2: Update SQL_DATABASE.md**

Add the 3 new tables (`automation_rules`, `automation_rule_conditions`, `automation_rule_executions`) with all columns, indexes, and RLS policies. Add the `max_active_rules` column to the `plan_rules` table section.

- [ ] **Step 3: Commit**

```bash
git add docs/features/14-automation-rules/README.md SQL_DATABASE.md
git commit -m "docs: add automation rules feature docs and update database schema"
```

---

## Task 15: End-to-End Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && npm test`
Expected: All tests pass (including new automation-rules tests)

- [ ] **Step 2: Run frontend build**

Run: `cd packages/frontend && npx vite build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 3: Run backend build**

Run: `cd packages/backend && npx nest build`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev` and verify:
1. Sidebar shows "Regras" between "Campanhas" and "Vendas"
2. `/rules` page loads with empty state
3. "Nova Regra" button opens modal
4. Modal form renders all fields correctly
5. Conditional fields appear/hide based on action type and frequency

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
