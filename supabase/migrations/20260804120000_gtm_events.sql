-- Server-side GTM event ingestion.
--
-- The sGTM container (hosted on Stape) fires an HTTP Request tag alongside the
-- Meta CAPI tag, POSTing each event to /api/gtm/events. Rows land here and are
-- streamed to the Events page via Supabase Realtime, and aggregated into the
-- Dashboard visitors card.
--
-- Retention is 30 days, enforced by a daily cron in the backend. This table is
-- append-only and PageView-dominated, so it is the largest-volume table in the
-- schema per unit of time — the purge is what keeps it bounded.
--
-- No CREATE INDEX CONCURRENTLY here: the Supabase SQL editor runs statements
-- inside a transaction block, which CONCURRENTLY forbids (error 25001). The
-- table is created empty in this same migration, so the lock is free anyway.

-- ============================================================
-- 1. Ingestion token on workspaces
-- ============================================================

-- Shared secret the sGTM tag sends in X-Sentinela-Token. Generated on demand
-- from the Integrations screen and shown in plaintext there, matching how
-- checkout webhook tokens already work in this project.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS gtm_ingest_token text;

-- Unique so the ingestion endpoint can resolve token -> workspace in one
-- indexed lookup. Partial: most workspaces will never enable this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_gtm_ingest_token
  ON public.workspaces (gtm_ingest_token)
  WHERE gtm_ingest_token IS NOT NULL;

-- ============================================================
-- 2. Events table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gtm_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_name text NOT NULL,
  event_id text,
  event_time timestamptz NOT NULL DEFAULT now(),
  value numeric,
  currency text,
  page_url text,
  has_fbp boolean NOT NULL DEFAULT false,
  has_fbc boolean NOT NULL DEFAULT false,
  -- sha256(_fbp + GTM_VISITOR_SALT). The raw cookie is never persisted, here or
  -- inside raw. Stable per browser, which is what makes repeat-visit counting
  -- possible without storing an identifier that maps back to a person.
  visitor_hash text,
  fbclid text,
  -- Payload as received, with user_data and every PII field already stripped
  -- by the backend before insert.
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gtm_events_pkey PRIMARY KEY (id),
  CONSTRAINT gtm_events_workspace_id_fkey FOREIGN KEY (workspace_id)
    REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- The Events page query: newest first within a workspace.
CREATE INDEX IF NOT EXISTS idx_gtm_events_workspace_created
  ON public.gtm_events (workspace_id, created_at DESC);

-- The visitors aggregation. INCLUDE keeps it index-only: the COUNT(DISTINCT)
-- never has to touch the heap.
CREATE INDEX IF NOT EXISTS idx_gtm_events_visits
  ON public.gtm_events (workspace_id, event_name, created_at)
  INCLUDE (visitor_hash);

-- The daily purge scans by age across all workspaces. BRIN is ~10x smaller
-- than B-tree and this table is append-only, so physical order tracks time.
CREATE INDEX IF NOT EXISTS idx_gtm_events_created_brin
  ON public.gtm_events USING BRIN (created_at);

-- Deduplication against the browser pixel.
--
-- Not a partial index (WHERE event_id IS NOT NULL) even though that would be
-- marginally smaller: ON CONFLICT cannot infer a partial index without
-- repeating its predicate, and PostgREST's on_conflict only takes a column
-- list. Postgres treats NULLs as distinct by default, so events without an
-- event_id never collide here anyway.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gtm_events_dedup
  ON public.gtm_events (workspace_id, event_id);

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.gtm_events ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner. This policy is also what gates Realtime: without
-- it the subscription would deliver nothing.
--
-- Dropped first because CREATE POLICY has no IF NOT EXISTS: without this, a
-- second run of the migration fails with 42710 while every other statement
-- here is idempotent.
DROP POLICY IF EXISTS "Users can view their own gtm events" ON public.gtm_events;

CREATE POLICY "Users can view their own gtm events" ON public.gtm_events
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- No INSERT/UPDATE/DELETE policies on purpose. Writes come from the backend
-- with the service role, which bypasses RLS; nothing should be able to forge
-- an event from a browser session.

-- ============================================================
-- 3b. Realtime
-- ============================================================

-- Adds the table to the publication Supabase Realtime listens on. Usually done
-- by hand in Database > Replication; doing it here means the feature works the
-- moment this migration runs, with no separate panel step to forget.
--
-- Only INSERT is subscribed, so the default replica identity is enough —
-- REPLICA IDENTITY FULL only matters for the old row on UPDATE/DELETE.
--
-- The exception block makes it safe to re-run: adding a table already in the
-- publication raises duplicate_object.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.gtm_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. Visitors aggregation
-- ============================================================

-- Kept separate from dashboard_metrics deliberately. That RPC already runs six
-- aggregations for every user on every dashboard load, and this metric only
-- returns rows for workspaces that send GTM events. Merging them would make
-- everyone else pay for a COUNT(DISTINCT) that is always empty.
CREATE OR REPLACE FUNCTION public.gtm_visit_metrics(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_unique_visitors int := 0;
  v_total_visits int := 0;
  v_unidentified_visits int := 0;
  v_avg numeric := 0;
BEGIN
  -- A "visit" is a PageView. Purchase, InitiateCheckout and the rest describe
  -- what happened during a visit, not a visit of their own.
  SELECT
    COUNT(*),
    COUNT(DISTINCT visitor_hash),
    COUNT(*) FILTER (WHERE visitor_hash IS NULL)
  INTO v_total_visits, v_unique_visitors, v_unidentified_visits
  FROM public.gtm_events
  WHERE workspace_id = p_workspace_id
    AND user_id = p_user_id
    AND event_name = 'PageView'
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at < p_to);

  IF v_unique_visitors > 0 THEN
    -- Identified visits only. Dividing all visits by identified visitors would
    -- inflate the average by however many events arrived without _fbp.
    v_avg := ROUND(
      (v_total_visits - v_unidentified_visits)::numeric / v_unique_visitors,
      1
    );
  END IF;

  RETURN jsonb_build_object(
    'unique_visitors', v_unique_visitors,
    'total_visits', v_total_visits,
    'avg_visits_per_visitor', v_avg,
    'unidentified_visits', v_unidentified_visits
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_visit_metrics(uuid, uuid, timestamptz, timestamptz)
  TO authenticated, service_role;
