-- Visit numbering for GTM events.
--
-- The Events page needs to show, for each event, which visit of that person it
-- belongs to — first, second, and so on. Two things are needed for that: a
-- stable key for the person, and a definition of "visit".
--
-- A visit is a SESSION, not a pageview. Somebody who opens five pages in one
-- sitting made one visit, not five. Sessions are cut on 30 minutes of
-- inactivity, the same convention GA uses, and are computed over all events
-- (not just PageView) — a Purchase ten minutes after a PageView belongs to the
-- same visit.

-- ============================================================
-- 1. The person key
-- ============================================================

-- Identifier the site sends as `id_do_usuario` in the payload. Named
-- external_* because `user_id` on this table already means the workspace owner.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS external_user_id text;

-- Backfill from events already ingested: the field was landing in `raw`
-- untouched, since it is not one of the PII keys that get stripped.
UPDATE public.gtm_events
SET external_user_id = NULLIF(TRIM(raw->>'id_do_usuario'), '')
WHERE external_user_id IS NULL
  AND raw ? 'id_do_usuario';

-- One key to group by, so queries and indexes don't have to repeat the
-- fallback. Generated and STORED because it is read far more than written and
-- an expression index would not help the GROUP BY.
--
-- Falls back to visitor_hash so anonymous traffic still gets numbered: someone
-- browsing before logging in is a visitor too.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS visitor_key text
  GENERATED ALWAYS AS (COALESCE(external_user_id, visitor_hash)) STORED;

-- Covers both the session window and the per-visitor history scan.
CREATE INDEX IF NOT EXISTS idx_gtm_events_visitor_key
  ON public.gtm_events (workspace_id, visitor_key, created_at);

-- ============================================================
-- 2. Page query with visit numbers
-- ============================================================

-- Replaces the plain SELECT the Events page used. The visit number cannot be
-- computed from a page of rows alone — it depends on everything that visitor
-- did before — so the page is selected first, then only the histories of the
-- visitors on that page are scanned.
CREATE OR REPLACE FUNCTION public.gtm_events_page(
  p_user_id uuid,
  p_workspace_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT id, event_name, event_id, event_time, value, currency, page_url,
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_event_name IS NULL OR event_name = p_event_name)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  visitors AS (
    SELECT DISTINCT visitor_key FROM page WHERE visitor_key IS NOT NULL
  ),
  -- Full history of just those visitors, marking where each session starts.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
      e.created_at,
      CASE
        WHEN LAG(e.created_at) OVER w IS NULL
          OR e.created_at - LAG(e.created_at) OVER w > interval '30 minutes'
        THEN 1 ELSE 0
      END AS starts_visit
    FROM public.gtm_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.user_id = p_user_id
      AND e.visitor_key IN (SELECT visitor_key FROM visitors)
    -- id breaks ties so two events in the same millisecond number consistently.
    WINDOW w AS (PARTITION BY e.visitor_key ORDER BY e.created_at, e.id)
  ),
  numbered AS (
    SELECT
      id,
      SUM(starts_visit) OVER (
        PARTITION BY visitor_key ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visit_number
    FROM history
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'event_name', p.event_name,
        'event_id', p.event_id,
        'event_time', p.event_time,
        'value', p.value,
        'currency', p.currency,
        'page_url', p.page_url,
        'has_fbp', p.has_fbp,
        'has_fbc', p.has_fbc,
        'fbclid', p.fbclid,
        'external_user_id', p.external_user_id,
        'visitor_key', p.visitor_key,
        'visit_number', n.visit_number,
        'created_at', p.created_at
      ) AS row
    FROM page p
    LEFT JOIN numbered n ON n.id = p.id
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_events_page(uuid, uuid, timestamptz, text, int)
  TO authenticated, service_role;

-- ============================================================
-- 3. Dashboard metric, realigned to sessions
-- ============================================================

-- Was counting PageView rows and calling them visits. With the Events page now
-- showing "3rd visit" on a session basis, the same word had two meanings in the
-- same product — five pageviews in one sitting would read as five visits here
-- and one visit there. Both now mean sessions.
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
  v_unidentified_events int := 0;
  v_avg numeric := 0;
BEGIN
  WITH scoped AS (
    SELECT visitor_key, created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
  ),
  sessionized AS (
    SELECT
      visitor_key,
      CASE
        WHEN LAG(created_at) OVER w IS NULL
          OR created_at - LAG(created_at) OVER w > interval '30 minutes'
        THEN 1 ELSE 0
      END AS starts_visit
    FROM scoped
    WHERE visitor_key IS NOT NULL
    WINDOW w AS (PARTITION BY visitor_key ORDER BY created_at)
  )
  SELECT
    (SELECT COUNT(DISTINCT visitor_key) FROM sessionized),
    (SELECT COALESCE(SUM(starts_visit), 0) FROM sessionized),
    (SELECT COUNT(*) FROM scoped WHERE visitor_key IS NULL)
  INTO v_unique_visitors, v_total_visits, v_unidentified_events;

  IF v_unique_visitors > 0 THEN
    v_avg := ROUND(v_total_visits::numeric / v_unique_visitors, 1);
  END IF;

  RETURN jsonb_build_object(
    'unique_visitors', v_unique_visitors,
    'total_visits', v_total_visits,
    'avg_visits_per_visitor', v_avg,
    'unidentified_visits', v_unidentified_events
  );
END;
$$;
