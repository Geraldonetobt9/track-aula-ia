-- Phase 0A: Add nullable workspace_id column to all business-data tables
-- This is purely additive — no existing code or queries are affected.

-- 1. sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 2. campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 3. ad_sets
ALTER TABLE public.ad_sets
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 4. ads
ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 5. daily_ad_spend
ALTER TABLE public.daily_ad_spend
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 6. checkout_integrations
ALTER TABLE public.checkout_integrations
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 7. facebook_connections (already has facebook_user_id, facebook_user_name from prior migrations)
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 8. company_costs
ALTER TABLE public.company_costs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 9. sync_schedules
ALTER TABLE public.sync_schedules
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 10. sync_logs
ALTER TABLE public.sync_logs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 11. processing_jobs
ALTER TABLE public.processing_jobs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);
