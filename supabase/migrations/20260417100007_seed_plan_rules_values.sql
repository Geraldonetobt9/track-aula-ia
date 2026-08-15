-- supabase/migrations/20260417100007_seed_plan_rules_values.sql

INSERT INTO public.plan_rules
  (plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations,
   max_workspaces, max_active_rules, overage_price_cents)
VALUES
  ('free',       30,   1,  1,  1,  0,  0),
  ('pro',        1000, 3,  3,  3,  3,  14),
  ('starter',    2500, 7,  7,  7,  7,  12),
  ('enterprise', 5000, -1, -1, -1, -1, 7),
  ('unlimited',  -1,   -1, -1, -1, -1, 0)
ON CONFLICT (plan) DO UPDATE SET
  max_sales_monthly         = EXCLUDED.max_sales_monthly,
  max_active_ad_accounts    = EXCLUDED.max_active_ad_accounts,
  max_checkout_integrations = EXCLUDED.max_checkout_integrations,
  max_workspaces            = EXCLUDED.max_workspaces,
  max_active_rules          = EXCLUDED.max_active_rules,
  overage_price_cents       = EXCLUDED.overage_price_cents,
  updated_at                = now();
