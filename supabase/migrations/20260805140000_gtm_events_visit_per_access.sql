-- Visit = access, not session.
--
-- The previous definition cut visits on 30 minutes of inactivity, so three
-- accesses in the same sitting counted as one visit. The operator wants each
-- access counted: three accesses are three visits, however close together.
--
-- The rule is now simply: an event's visit number is how many PageViews that
-- person had up to and including that event.
--
--   - on a PageView, that is its own position — 1st, 2nd, 3rd access
--   - on a Purchase, it is how many visits the person had before buying
--
-- One count, both questions. Purchases and other events no longer need a
-- separate notion of "which session am I in".

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
  -- Full history of just those visitors, flagging which rows are an access.
  -- The name is normalised because tag templates spell it PageView, pageview
  -- or page_view depending on which client produced the event.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
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
      -- Running count, inclusive of the row itself. id breaks ties so two
      -- events in the same millisecond number consistently.
      SUM(is_access) OVER (
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

-- Realigned to the same definition. It has no caller since the Dashboard
-- visitors card was removed, but leaving it computing sessions would mean
-- "visita" meant two different things depending on which function you read.
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
  SELECT
    COUNT(DISTINCT visitor_key) FILTER (WHERE visitor_key IS NOT NULL),
    COUNT(*) FILTER (
      WHERE visitor_key IS NOT NULL
        AND lower(replace(event_name, '_', '')) = 'pageview'
    ),
    COUNT(*) FILTER (WHERE visitor_key IS NULL)
  INTO v_unique_visitors, v_total_visits, v_unidentified_events
  FROM public.gtm_events
  WHERE workspace_id = p_workspace_id
    AND user_id = p_user_id
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at < p_to);

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
