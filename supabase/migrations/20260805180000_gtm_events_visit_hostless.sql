-- Events without a page_url count across all hosts.
--
-- Real data exposed the gap: a Purchase arrives with no page_url, so page_host
-- is null. With the count partitioned by host, that event landed in a partition
-- of its own where no PageView exists — and reported zero visits, for someone
-- who had accessed six pages across five subdomains before buying.
--
-- The rule is now:
--   event WITH a host    -> accesses on that host, as before
--   event WITHOUT a host -> accesses across every host of that person
--
-- There is nothing to scope a hostless event to, and the total is the honest
-- answer to "how many visits before this happened". Sending page_url on the
-- purchase tag would not fix it either: the host would be the checkout page,
-- which the person visited once.

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
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, page_host,
           created_at
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
      -- Both counts, inclusive of the row itself; which one applies is decided
      -- below by whether the event knows what host it happened on.
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
