-- Phase 0B: Create composite indexes on workspace_id
-- Partial indexes (WHERE workspace_id IS NOT NULL) during transition period.
-- These will be rebuilt as full indexes after Phase 5 (NOT NULL enforcement).
-- Note: Not using CONCURRENTLY because Supabase runs migrations inside a transaction.
-- For production with large tables, run these manually outside a transaction.

CREATE INDEX IF NOT EXISTS idx_sales_workspace_sold_at
  ON public.sales (workspace_id, sold_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_workspace_approved
  ON public.sales (workspace_id, sold_at DESC)
  WHERE status = 'approved' AND workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace
  ON public.campaigns (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_sets_workspace
  ON public.ad_sets (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ads_workspace
  ON public.ads (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_ad_spend_workspace_date
  ON public.daily_ad_spend (workspace_id, date DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_integrations_workspace
  ON public.checkout_integrations (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facebook_connections_workspace_id
  ON public.facebook_connections (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_costs_workspace
  ON public.company_costs (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_schedules_workspace
  ON public.sync_schedules (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace
  ON public.sync_logs (workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;
