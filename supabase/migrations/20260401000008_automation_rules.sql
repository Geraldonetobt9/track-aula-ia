-- Migration: automation_rules feature
-- Creates tables for rule definitions, conditions, and execution logs.
-- Adds max_active_rules column to plan_rules with per-plan seeding.

-- ============================================================
-- TABLE: automation_rules
-- ============================================================
CREATE TABLE public.automation_rules (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL,
  name               text        NOT NULL,
  is_active          boolean     NOT NULL DEFAULT false,
  connection_id      uuid,
  target_entity      text        NOT NULL,
  target_status      text        NOT NULL,
  name_filter        text,
  action_type        text        NOT NULL,
  budget_adjustment  jsonb,
  evaluation_period  text        NOT NULL,
  custom_start_date  date,
  frequency_minutes  integer     NOT NULL,
  daily_run_time     time,
  last_executed_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT automation_rules_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rules_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT automation_rules_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES public.facebook_connections(id) ON DELETE SET NULL,
  CONSTRAINT automation_rules_target_entity_check
    CHECK (target_entity IN ('campaign', 'adset', 'ad')),
  CONSTRAINT automation_rules_target_status_check
    CHECK (target_status IN ('active', 'paused', 'any')),
  CONSTRAINT automation_rules_action_type_check
    CHECK (action_type IN ('activate', 'pause', 'increase_budget', 'decrease_budget')),
  CONSTRAINT automation_rules_evaluation_period_check
    CHECK (evaluation_period IN ('today', 'yesterday', 'last_7d', 'last_30d', 'custom')),
  CONSTRAINT automation_rules_frequency_minutes_check
    CHECK (frequency_minutes IN (10, 15, 30, 60, 120, 180, 360, 1440))
);

-- ============================================================
-- TABLE: automation_rule_conditions
-- ============================================================
CREATE TABLE public.automation_rule_conditions (
  id       uuid    NOT NULL DEFAULT gen_random_uuid(),
  rule_id  uuid    NOT NULL,
  metric   text    NOT NULL,
  operator text    NOT NULL,
  value    numeric NOT NULL,

  CONSTRAINT automation_rule_conditions_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rule_conditions_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_conditions_metric_check
    CHECK (metric IN (
      'spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin',
      'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions'
    )),
  CONSTRAINT automation_rule_conditions_operator_check
    CHECK (operator IN ('gt', 'lt', 'gte', 'lte'))
);

-- ============================================================
-- TABLE: automation_rule_executions
-- ============================================================
CREATE TABLE public.automation_rule_executions (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  rule_id             uuid        NOT NULL,
  workspace_id        uuid        NOT NULL,
  entity_facebook_id  text        NOT NULL,
  entity_name         text,
  action_taken        text        NOT NULL,
  metrics_snapshot    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL,
  error_message       text,
  executed_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT automation_rule_executions_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rule_executions_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_executions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_executions_status_check
    CHECK (status IN ('success', 'error'))
);

-- ============================================================
-- UPDATED_AT TRIGGER: automation_rules
-- ============================================================
CREATE TRIGGER update_automation_rules_updated_at
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- INDEXES
-- ============================================================

-- automation_rules: workspace + active status (primary access pattern)
CREATE INDEX idx_automation_rules_workspace_active
  ON public.automation_rules (workspace_id, is_active);

-- automation_rules: scheduler lookup — only active rules, ordered by last run
CREATE INDEX idx_automation_rules_active_last_executed
  ON public.automation_rules (is_active, last_executed_at)
  WHERE is_active = true;

-- automation_rule_conditions: join on rule_id
CREATE INDEX idx_automation_rule_conditions_rule_id
  ON public.automation_rule_conditions (rule_id);

-- automation_rule_executions: history by rule (most recent first)
CREATE INDEX idx_automation_rule_executions_rule_date
  ON public.automation_rule_executions (rule_id, executed_at DESC);

-- automation_rule_executions: history by workspace (most recent first)
CREATE INDEX idx_automation_rule_executions_workspace_date
  ON public.automation_rule_executions (workspace_id, executed_at DESC);

-- automation_rule_executions: BRIN on executed_at (append-only, monotonically increasing)
CREATE INDEX idx_automation_rule_executions_executed_at_brin
  ON public.automation_rule_executions USING BRIN (executed_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;

-- automation_rules: workspace members can manage their own rules
CREATE POLICY "Workspace members can manage their automation rules"
  ON public.automation_rules
  FOR ALL
  TO authenticated
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- automation_rule_conditions: accessible when the parent rule belongs to the user
CREATE POLICY "Workspace members can manage their rule conditions"
  ON public.automation_rule_conditions
  FOR ALL
  TO authenticated
  USING (
    rule_id IN (
      SELECT ar.id FROM public.automation_rules ar
      JOIN public.workspaces w ON w.id = ar.workspace_id
      WHERE w.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    rule_id IN (
      SELECT ar.id FROM public.automation_rules ar
      JOIN public.workspaces w ON w.id = ar.workspace_id
      WHERE w.user_id = (SELECT auth.uid())
    )
  );

-- automation_rule_executions: read-only for workspace members
CREATE POLICY "Workspace members can view their rule executions"
  ON public.automation_rule_executions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- plan_rules: add max_active_rules column
-- ============================================================

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS max_active_rules integer DEFAULT 0;

-- Seed per-plan limits
UPDATE public.plan_rules SET max_active_rules = 0
  WHERE id = 'aa410a04-a399-400e-ad1c-1ca7f75ccfeb'; -- free

UPDATE public.plan_rules SET max_active_rules = 3
  WHERE id = '29a4ba19-f691-4ceb-894f-19601ea60b17'; -- starter

UPDATE public.plan_rules SET max_active_rules = 7
  WHERE id = 'bd669e8b-eac6-494e-86dd-5e639a8ee182'; -- pro

UPDATE public.plan_rules SET max_active_rules = NULL
  WHERE id = '1b17c43a-be5f-475f-996c-95a228af4d49'; -- enterprise (unlimited)
