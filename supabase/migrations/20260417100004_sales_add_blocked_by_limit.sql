-- supabase/migrations/20260417100004_sales_add_blocked_by_limit.sql

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS blocked_by_limit boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sales_blocked_by_limit
  ON public.sales(user_id) WHERE blocked_by_limit = true;

COMMENT ON COLUMN public.sales.blocked_by_limit IS
  'Quando true, venda NÃO entra em métricas/receita/atribuição. Usado quando Free excede max_sales_monthly.';
