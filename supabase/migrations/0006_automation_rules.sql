-- ============================================================
-- 0006 — Regras de automação
-- ============================================================
-- Avaliam métricas de um período e agem sobre campanha/conjunto/anúncio
-- (pausar, ativar, mexer no orçamento).

CREATE TABLE public.automation_rules (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  is_active         boolean     NOT NULL DEFAULT false,
  -- Antes apontava para uma "conexão"; agora, para a conta de anúncio.
  -- NULL = a regra vale para todas as contas ativas.
  ad_account_id     uuid        REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  target_entity     text        NOT NULL CHECK (target_entity IN ('campaign', 'adset', 'ad')),
  target_status     text        NOT NULL CHECK (target_status IN ('active', 'paused', 'any')),
  name_filter       text,       -- filtro opcional por trecho do nome
  action_type       text        NOT NULL CHECK (action_type IN
                        ('activate', 'pause', 'increase_budget', 'decrease_budget')),
  budget_adjustment jsonb,      -- { "type": "percent" | "fixed", "value": number }
  evaluation_period text        NOT NULL CHECK (evaluation_period IN
                        ('today', 'yesterday', 'last_7d', 'last_30d', 'custom')),
  custom_start_date date,       -- usado quando evaluation_period = 'custom'
  frequency_minutes integer     NOT NULL CHECK (frequency_minutes IN
                        (10, 15, 30, 60, 120, 180, 360, 1440)),
  daily_run_time    time,       -- horário fixo, para regras diárias
  last_executed_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Índice do agendador: quais regras estão vencidas agora.
CREATE INDEX idx_automation_rules_due
  ON public.automation_rules (last_executed_at)
  WHERE is_active = true;

CREATE TRIGGER touch_automation_rules
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Condições em AND: todas precisam bater para a ação disparar.
CREATE TABLE public.automation_rule_conditions (
  id       uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id  uuid    NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  metric   text    NOT NULL CHECK (metric IN (
             'spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin',
             'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions'
           )),
  operator text    NOT NULL CHECK (operator IN ('gt', 'lt', 'gte', 'lte')),
  value    numeric NOT NULL
);

CREATE INDEX idx_rule_conditions_rule ON public.automation_rule_conditions (rule_id);

-- Histórico. Append-only: é o que a tela de histórico mostra.
CREATE TABLE public.automation_rule_executions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id            uuid        NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  entity_facebook_id text        NOT NULL,
  entity_name        text,
  action_taken       text        NOT NULL,
  metrics_snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status             text        NOT NULL CHECK (status IN ('success', 'error')),
  error_message      text,
  executed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rule_executions_rule_date
  ON public.automation_rule_executions (rule_id, executed_at DESC);

CREATE INDEX idx_rule_executions_date_brin
  ON public.automation_rule_executions USING BRIN (executed_at);
