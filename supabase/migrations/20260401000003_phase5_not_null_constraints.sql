-- Phase 5A: Enforce NOT NULL on workspace_id across all tables
-- Only run AFTER verifying all rows have workspace_id populated (Phase 1 backfill)

ALTER TABLE public.sales ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.campaigns ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.ad_sets ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.ads ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.daily_ad_spend ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.checkout_integrations ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.facebook_connections ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.company_costs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.sync_schedules ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.sync_logs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.processing_jobs ALTER COLUMN workspace_id SET NOT NULL;
