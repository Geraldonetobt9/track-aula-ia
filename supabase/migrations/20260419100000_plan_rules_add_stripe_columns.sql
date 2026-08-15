-- supabase/migrations/20260419100000_plan_rules_add_stripe_columns.sql

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS stripe_product_id        text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_base     text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_metered  text,
  ADD COLUMN IF NOT EXISTS stripe_meter_event_name  text;

COMMENT ON COLUMN public.plan_rules.stripe_product_id IS
  'Stripe Product ID (prod_xxx). NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_price_id_base IS
  'Stripe Price ID do preço fixo mensal. NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_price_id_metered IS
  'Stripe Price ID do preço metered para overage. NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_meter_event_name IS
  'Nome do meter event a enviar quando overage ocorre. NULL para free e unlimited.';
