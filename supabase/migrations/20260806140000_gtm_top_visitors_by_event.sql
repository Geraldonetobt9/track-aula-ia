-- Breakdown by event name in the visitor ranking.
--
-- Visits alone say how often somebody came, not how far they got. With the
-- count per event name the row reads as a funnel: six page_view, one
-- add_to_cart, one begin_checkout, one purchase.
--
-- Returned as a jsonb object rather than fixed columns because the set of event
-- names is whatever the sGTM triggers send — it is not knowable here, and it
-- changes when a tag is added.

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
  WITH scoped AS (
    SELECT visitor_key, external_user_id, event_name, value, page_host, created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND visitor_key IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
  ),
  totals AS (
    SELECT
      visitor_key,
      -- MAX because a person can appear before and after logging in; grouped by
      -- visitor_key, this picks the id when one exists.
      MAX(external_user_id) AS external_user_id,
      COUNT(*) FILTER (WHERE lower(replace(event_name, '_', '')) = 'pageview') AS visits,
      COUNT(*) AS events,
      COUNT(*) FILTER (WHERE lower(event_name) = 'purchase') AS purchases,
      COALESCE(SUM(value) FILTER (WHERE lower(event_name) = 'purchase'), 0) AS revenue,
      COUNT(DISTINCT page_host) AS hosts,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen
    FROM scoped
    GROUP BY visitor_key
    ORDER BY visits DESC, last_seen DESC
    -- Limited before the breakdown runs, so it only builds the top rows.
    LIMIT p_limit
  ),
  by_name AS (
    SELECT counted.visitor_key, jsonb_object_agg(counted.event_name, counted.cnt) AS events_by_name
    FROM (
      SELECT visitor_key, event_name, COUNT(*) AS cnt
      FROM scoped
      WHERE visitor_key IN (SELECT visitor_key FROM totals)
      GROUP BY visitor_key, event_name
    ) counted
    GROUP BY counted.visitor_key
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'visitor_key', t.visitor_key,
        'external_user_id', t.external_user_id,
        'visits', t.visits,
        'events', t.events,
        'purchases', t.purchases,
        'revenue', t.revenue,
        'hosts', t.hosts,
        'events_by_name', COALESCE(b.events_by_name, '{}'::jsonb),
        'first_seen', t.first_seen,
        'last_seen', t.last_seen
      ) ORDER BY t.visits DESC, t.last_seen DESC
    ),
    '[]'::jsonb
  )
  FROM totals t
  LEFT JOIN by_name b ON b.visitor_key = t.visitor_key;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_top_visitors(uuid, uuid, timestamptz, timestamptz, int)
  TO authenticated, service_role;
