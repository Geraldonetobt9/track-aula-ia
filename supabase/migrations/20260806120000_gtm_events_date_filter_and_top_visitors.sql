-- Date filter on the Events page, and a ranking of who visits the most.

-- ============================================================
-- 1. Page query, now with a date range
-- ============================================================

CREATE OR REPLACE FUNCTION public.gtm_events_page(
  p_user_id uuid,
  p_workspace_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT id, event_name, event_id, event_time, value, currency, page_url,
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, page_host,
           created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_event_name IS NULL OR event_name = p_event_name)
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  visitors AS (
    SELECT DISTINCT visitor_key FROM page WHERE visitor_key IS NOT NULL
  ),
  -- Deliberately NOT filtered by the date range.
  --
  -- The visit number is a fact about the person's history, not about what the
  -- screen is currently showing. Narrowing this to the filter would renumber
  -- someone's 5th visit as their 1st the moment you filtered to today — the
  -- number would change meaning depending on the filter, which is worse than
  -- useless.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
      e.page_host,
      e.created_at,
      CASE
        WHEN lower(replace(e.event_name, '_', '')) = 'pageview' THEN 1 ELSE 0
      END AS is_access
    FROM public.gtm_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.user_id = p_user_id
      AND e.visitor_key IN (SELECT visitor_key FROM visitors)
  ),
  numbered AS (
    SELECT
      id,
      page_host,
      SUM(is_access) OVER (
        PARTITION BY visitor_key, page_host ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visits_on_host,
      SUM(is_access) OVER (
        PARTITION BY visitor_key ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visits_anywhere
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
        'page_host', p.page_host,
        'has_fbp', p.has_fbp,
        'has_fbc', p.has_fbc,
        'fbclid', p.fbclid,
        'external_user_id', p.external_user_id,
        'visitor_key', p.visitor_key,
        'visit_number',
          CASE WHEN p.page_host IS NULL THEN n.visits_anywhere ELSE n.visits_on_host END,
        'visit_scope',
          CASE WHEN p.page_host IS NULL THEN 'all_hosts' ELSE 'host' END,
        'created_at', p.created_at
      ) AS row
    FROM page p
    LEFT JOIN numbered n ON n.id = p.id
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_events_page(uuid, uuid, timestamptz, text, int, timestamptz, timestamptz)
  TO authenticated, service_role;

-- ============================================================
-- 2. Who visits the most
-- ============================================================

-- Counts WITHIN the selected period, unlike the per-event visit number above.
-- The question here is "who showed up most in this window", so the window is
-- the point; on an individual event the question is "which visit of theirs was
-- this", which only history can answer.
CREATE OR REPLACE FUNCTION public.gtm_top_visitors(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'visitor_key', visitor_key,
        'external_user_id', external_user_id,
        'visits', visits,
        'events', events,
        'purchases', purchases,
        'revenue', revenue,
        'hosts', hosts,
        'first_seen', first_seen,
        'last_seen', last_seen
      ) ORDER BY visits DESC, last_seen DESC
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      visitor_key,
      -- MAX because a person can appear before and after logging in; the row
      -- is grouped by visitor_key, so this picks the id when one exists.
      MAX(external_user_id) AS external_user_id,
      COUNT(*) FILTER (WHERE lower(replace(event_name, '_', '')) = 'pageview') AS visits,
      COUNT(*) AS events,
      COUNT(*) FILTER (WHERE lower(event_name) = 'purchase') AS purchases,
      COALESCE(SUM(value) FILTER (WHERE lower(event_name) = 'purchase'), 0) AS revenue,
      COUNT(DISTINCT page_host) AS hosts,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND visitor_key IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
    GROUP BY visitor_key
    ORDER BY visits DESC, last_seen DESC
    -- Limited before aggregating into JSON, so only the top rows are built.
    LIMIT p_limit
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_top_visitors(uuid, uuid, timestamptz, timestamptz, int)
  TO authenticated, service_role;
