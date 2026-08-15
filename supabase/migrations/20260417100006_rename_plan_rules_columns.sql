-- supabase/migrations/20260417100006_rename_plan_rules_columns.sql

ALTER TABLE public.plan_rules
  RENAME COLUMN max_sales TO max_sales_monthly;

ALTER TABLE public.plan_rules
  RENAME COLUMN max_ad_accounts TO max_active_ad_accounts;

COMMENT ON COLUMN public.plan_rules.max_sales_monthly IS
  'Limite de vendas aprovadas por ciclo de assinatura. -1 = ilimitado.';
COMMENT ON COLUMN public.plan_rules.max_active_ad_accounts IS
  'Limite de ad accounts com is_active=true. -1 = ilimitado.';
