-- Phase 5D: Rebuild partial indexes as full indexes
-- Now that workspace_id is NOT NULL, the WHERE clause is unnecessary.

DROP INDEX IF EXISTS idx_sales_workspace_sold_at;
CREATE INDEX idx_sales_workspace_sold_at
  ON public.sales (workspace_id, sold_at DESC);

DROP INDEX IF EXISTS idx_sales_workspace_approved;
CREATE INDEX idx_sales_workspace_approved
  ON public.sales (workspace_id, sold_at DESC)
  WHERE status = 'approved';

DROP INDEX IF EXISTS idx_campaigns_workspace;
CREATE INDEX idx_campaigns_workspace
  ON public.campaigns (workspace_id);

DROP INDEX IF EXISTS idx_ad_sets_workspace;
CREATE INDEX idx_ad_sets_workspace
  ON public.ad_sets (workspace_id);

DROP INDEX IF EXISTS idx_ads_workspace;
CREATE INDEX idx_ads_workspace
  ON public.ads (workspace_id);

DROP INDEX IF EXISTS idx_daily_ad_spend_workspace_date;
CREATE INDEX idx_daily_ad_spend_workspace_date
  ON public.daily_ad_spend (workspace_id, date DESC);

DROP INDEX IF EXISTS idx_checkout_integrations_workspace;
CREATE INDEX idx_checkout_integrations_workspace
  ON public.checkout_integrations (workspace_id);

DROP INDEX IF EXISTS idx_facebook_connections_workspace_id;
CREATE INDEX idx_facebook_connections_workspace_id
  ON public.facebook_connections (workspace_id);

DROP INDEX IF EXISTS idx_company_costs_workspace;
CREATE INDEX idx_company_costs_workspace
  ON public.company_costs (workspace_id);

DROP INDEX IF EXISTS idx_sync_schedules_workspace;
CREATE INDEX idx_sync_schedules_workspace
  ON public.sync_schedules (workspace_id);

DROP INDEX IF EXISTS idx_sync_logs_workspace;
CREATE INDEX idx_sync_logs_workspace
  ON public.sync_logs (workspace_id, created_at DESC);
