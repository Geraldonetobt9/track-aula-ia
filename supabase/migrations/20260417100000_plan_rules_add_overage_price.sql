-- supabase/migrations/20260417100000_plan_rules_add_overage_price.sql

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS overage_price_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plan_rules.overage_price_cents IS
  'Preço em centavos por venda aprovada acima do max_sales_monthly. 0 = sem overage (Free, Unlimited).';
