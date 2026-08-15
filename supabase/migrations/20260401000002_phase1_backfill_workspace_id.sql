-- Phase 1: Backfill workspace_id on all existing rows
-- This migration populates workspace_id using junction tables and FK chains.
-- It is data-only — no code changes required.

-- ============================================================
-- Step 0: Create default workspace for users who have data but no workspace
-- ============================================================
INSERT INTO public.workspaces (user_id, name)
SELECT DISTINCT u.id, 'Principal'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspaces w WHERE w.user_id = u.id
)
AND (
  EXISTS (SELECT 1 FROM public.sales s WHERE s.user_id = u.id)
  OR EXISTS (SELECT 1 FROM public.checkout_integrations ci WHERE ci.user_id = u.id)
  OR EXISTS (SELECT 1 FROM public.facebook_connections fc WHERE fc.user_id = u.id)
  OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.user_id = u.id)
);

-- ============================================================
-- Step 0b: Temp table with default (oldest) workspace per user
-- ============================================================
CREATE TEMP TABLE tmp_default_workspace AS
SELECT DISTINCT ON (user_id) user_id, id AS workspace_id
FROM public.workspaces
ORDER BY user_id, created_at ASC;

CREATE INDEX ON tmp_default_workspace (user_id);

-- ============================================================
-- Step 1: checkout_integrations ← junction table or default
-- ============================================================
UPDATE public.checkout_integrations ci
SET workspace_id = COALESCE(
  (SELECT wci.workspace_id
   FROM public.workspace_checkout_integrations wci
   WHERE wci.checkout_integration_id = ci.id
   LIMIT 1),
  (SELECT dw.workspace_id
   FROM tmp_default_workspace dw
   WHERE dw.user_id = ci.user_id)
)
WHERE ci.workspace_id IS NULL;

-- ============================================================
-- Step 2: facebook_connections ← junction table or default
-- ============================================================
UPDATE public.facebook_connections fc
SET workspace_id = COALESCE(
  (SELECT wc.workspace_id
   FROM public.workspace_connections wc
   WHERE wc.facebook_connection_id = fc.id
   LIMIT 1),
  (SELECT dw.workspace_id
   FROM tmp_default_workspace dw
   WHERE dw.user_id = fc.user_id)
)
WHERE fc.workspace_id IS NULL;

-- ============================================================
-- Step 3: sales ← checkout_integrations.workspace_id or default
-- ============================================================
UPDATE public.sales s
SET workspace_id = COALESCE(
  (SELECT ci.workspace_id
   FROM public.checkout_integrations ci
   WHERE ci.id = s.checkout_integration_id),
  (SELECT dw.workspace_id
   FROM tmp_default_workspace dw
   WHERE dw.user_id = s.user_id)
)
WHERE s.workspace_id IS NULL;

-- ============================================================
-- Step 4: campaigns ← facebook_connections.workspace_id or default
-- ============================================================
UPDATE public.campaigns c
SET workspace_id = COALESCE(
  (SELECT fc.workspace_id
   FROM public.facebook_connections fc
   WHERE fc.id = c.facebook_connection_id),
  (SELECT dw.workspace_id
   FROM tmp_default_workspace dw
   WHERE dw.user_id = c.user_id)
)
WHERE c.workspace_id IS NULL;

-- ============================================================
-- Step 5: ad_sets ← campaigns.workspace_id
-- ============================================================
UPDATE public.ad_sets a
SET workspace_id = COALESCE(
  (SELECT camp.workspace_id
   FROM public.campaigns camp
   WHERE camp.id = a.campaign_id),
  (SELECT dw.workspace_id
   FROM tmp_default_workspace dw
   WHERE dw.user_id = a.user_id)
)
WHERE a.workspace_id IS NULL;

-- ============================================================
-- Step 6: ads ← ad_sets.workspace_id
-- ============================================================
UPDATE public.ads ad
SET workspace_id = COALESCE(
  (SELECT ast.workspace_id
   FROM public.ad_sets ast
   WHERE ast.id = ad.ad_set_id),
  (SELECT dw.workspace_id
   FROM tmp_default_workspace dw
   WHERE dw.user_id = ad.user_id)
)
WHERE ad.workspace_id IS NULL;

-- ============================================================
-- Step 7: daily_ad_spend ← campaigns or facebook_connections or default
-- ============================================================
UPDATE public.daily_ad_spend das
SET workspace_id = COALESCE(
  (SELECT camp.workspace_id
   FROM public.campaigns camp
   WHERE camp.id = das.campaign_id),
  (SELECT fc.workspace_id
   FROM public.facebook_connections fc
   WHERE fc.id = das.facebook_connection_id),
  (SELECT dw.workspace_id
   FROM tmp_default_workspace dw
   WHERE dw.user_id = das.user_id)
)
WHERE das.workspace_id IS NULL;

-- ============================================================
-- Step 8: Simple tables ← default workspace
-- ============================================================
UPDATE public.company_costs
SET workspace_id = (SELECT dw.workspace_id FROM tmp_default_workspace dw WHERE dw.user_id = company_costs.user_id)
WHERE workspace_id IS NULL;

UPDATE public.sync_schedules
SET workspace_id = (SELECT dw.workspace_id FROM tmp_default_workspace dw WHERE dw.user_id = sync_schedules.user_id)
WHERE workspace_id IS NULL;

UPDATE public.sync_logs
SET workspace_id = (SELECT dw.workspace_id FROM tmp_default_workspace dw WHERE dw.user_id = sync_logs.user_id)
WHERE workspace_id IS NULL;

UPDATE public.processing_jobs
SET workspace_id = (SELECT dw.workspace_id FROM tmp_default_workspace dw WHERE dw.user_id = processing_jobs.user_id)
WHERE workspace_id IS NULL;

-- ============================================================
-- Cleanup
-- ============================================================
DROP TABLE tmp_default_workspace;
