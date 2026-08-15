-- ============================================================
-- 0005 — Financeiro
-- ============================================================

-- ------------------------------------------------------------
-- company_costs — custos recorrentes aplicados sobre o faturamento.
-- ------------------------------------------------------------
-- 'percentage' incide sobre a receita do período; 'fixed' é um valor mensal.
CREATE TABLE public.company_costs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  type       text        NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value      numeric     NOT NULL CHECK (value >= 0),
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_costs_active
  ON public.company_costs (is_active) WHERE is_active = true;

CREATE TRIGGER touch_company_costs
  BEFORE UPDATE ON public.company_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- financial_entries — lançamentos manuais por mês de referência.
-- ------------------------------------------------------------
-- 'tax' é um imposto em valor, digitado à mão, e convive com o percentual sobre
-- ads que fica em app_settings.ad_spend_tax_percentage: um incide sobre o gasto
-- de mídia, o outro é subtraído do lucro por conta própria.
CREATE TABLE public.financial_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text        NOT NULL CHECK (type IN ('expense', 'revenue', 'tax')),
  name            text        NOT NULL,
  amount          numeric     NOT NULL DEFAULT 0,
  reference_month date        NOT NULL,   -- sempre o dia 1 do mês
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_entries_month_type
  ON public.financial_entries (reference_month, type);

CREATE TRIGGER touch_financial_entries
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
