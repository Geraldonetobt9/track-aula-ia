-- supabase/migrations/20260417300000_drop_plan_rules_dead_columns.sql

-- Remove colunas que nunca foram usadas em enforcement ou UI.
-- max_campaigns, sync_interval_minutes e os 5 feature_* eram consultadas
-- apenas pelo endpoint admin mas nenhum componente do frontend nem nenhum
-- service do backend validava seus valores em runtime.

ALTER TABLE public.plan_rules
  DROP COLUMN IF EXISTS max_campaigns,
  DROP COLUMN IF EXISTS sync_interval_minutes,
  DROP COLUMN IF EXISTS feature_sales_globe,
  DROP COLUMN IF EXISTS feature_advanced_reports,
  DROP COLUMN IF EXISTS feature_conversion_funnel,
  DROP COLUMN IF EXISTS feature_auto_sync,
  DROP COLUMN IF EXISTS feature_api_access;
