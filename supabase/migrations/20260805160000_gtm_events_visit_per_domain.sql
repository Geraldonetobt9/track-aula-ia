-- Visits are counted per subdomain.
--
-- Until now the count was global per person: someone who accessed two different
-- properties of the operator had those accesses mixed into one sequence. A
-- visit should belong to the site it happened on, so the count is now scoped to
-- the host taken from page_url — the URL up to the .com, dropping path and
-- query.
--
-- Per SUBDOMAIN, not per registered domain: loja.exemplo.com and
-- blog.exemplo.com are separate sites and get separate counts.

-- ============================================================
-- 1. The host, derived from page_url
-- ============================================================

-- Generated rather than written by the ingestion code: it is derived data, and
-- Postgres computing it means every event already stored gets the value without
-- a backfill step.
--
-- Only noise is removed — nothing that distinguishes one host from another:
--   scheme dropped   https://loja.exemplo.com/x?a=1  ->  loja.exemplo.com
--   path and query dropped
--   port dropped     exemplo.com:443                 ->  exemplo.com
--   lowercased       Exemplo.COM                     ->  exemplo.com
--
-- `www.` is deliberately KEPT: it is a subdomain like any other, and stripping
-- it would merge www.exemplo.com with exemplo.com.
--
-- A page_url that is null or unparseable yields null, which groups on its own.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS page_host text
  GENERATED ALWAYS AS (
    NULLIF(
      split_part(
        lower(
          COALESCE(
            substring(page_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/?#]+)'),
            ''
          )
        ),
        ':', 1
      ),
      ''
    )
  ) STORED;

-- The history scan now narrows by host as well.
CREATE INDEX IF NOT EXISTS idx_gtm_events_visitor_host
  ON public.gtm_events (workspace_id, visitor_key, page_host, created_at);

-- ============================================================
-- 2. Page query, counting per domain
-- ============================================================

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
      -- Partitioned by host: a visit belongs to the site it happened on.
      -- Running count inclusive of the row itself, so a PageView reads as its
      -- own position and a Purchase as how many visits came before it.
      SUM(is_access) OVER (
        PARTITION BY visitor_key, page_host
        ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
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
        'page_host', p.page_host,
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
