-- Phase 5B: Swap unique indexes from user_id-scoped to workspace_id-scoped

-- daily_ad_spend: workspace-scoped uniqueness
ALTER TABLE public.daily_ad_spend DROP CONSTRAINT IF EXISTS idx_daily_ad_spend_unique;
DROP INDEX IF EXISTS idx_daily_ad_spend_unique;
CREATE UNIQUE INDEX idx_daily_ad_spend_unique
  ON public.daily_ad_spend (workspace_id, COALESCE(facebook_campaign_id, ''::text), COALESCE(facebook_adset_id, ''::text), COALESCE(facebook_ad_id, ''::text), date);

-- sales: workspace-scoped uniqueness (drop constraint first, then index)
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_external_id_user_id_unique;
DROP INDEX IF EXISTS sales_external_id_user_id_unique;
CREATE UNIQUE INDEX sales_external_id_workspace_unique
  ON public.sales (external_id, workspace_id);

-- sync_schedules: workspace-scoped uniqueness
ALTER TABLE public.sync_schedules DROP CONSTRAINT IF EXISTS sync_schedules_user_id_sync_type_key;
DROP INDEX IF EXISTS sync_schedules_user_id_sync_type_key;
CREATE UNIQUE INDEX sync_schedules_workspace_sync_type_key
  ON public.sync_schedules (workspace_id, sync_type);
