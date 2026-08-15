-- Server-side aggregation for dashboard endpoints.
--
-- Replaces the row-level pulls in LiveMetricsService that were silently truncated
-- by PostgREST's default 1000-row cap (corrupting SUM/COUNT for users with >1000
-- approved sales) and that wasted bandwidth transferring full result sets just
-- to compute aggregates in Node.

-- ============================================================
-- Helper: pick first numeric segment (>= 6 digits) from a piped/slashed string.
-- Mirrors the legacy TS extractNumericId used by sale-matcher attribution.
-- ============================================================
CREATE OR REPLACE FUNCTION public.extract_numeric_ad_id(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(p)
  FROM regexp_split_to_table(coalesce(raw, ''), '[|/]') AS p
  WHERE trim(p) ~ '^[0-9]{6,}$'
  LIMIT 1;
$$;

-- ============================================================
-- Dashboard aggregations: lifetime + period (gross, count, chart, regions, recent).
-- One round trip returns every shape the dashboard endpoint needs.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_gross numeric := 0;
  v_count int := 0;
  v_lifetime numeric := 0;
  v_chart jsonb := '[]'::jsonb;
  v_regions jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  -- Period: gross revenue + sales count (approved only).
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO v_gross, v_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND blocked_by_limit = false
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names));

  -- Lifetime: ignores period/checkout/product filters by design (drives the milestone bar).
  SELECT COALESCE(SUM(amount), 0)
  INTO v_lifetime
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND blocked_by_limit = false
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id);

  -- Chart: revenue per UTC day, ascending.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', r) ORDER BY d), '[]'::jsonb)
  INTO v_chart
  FROM (
    SELECT to_char(sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
           SUM(amount) AS r
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND blocked_by_limit = false
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY d
  ) c;

  -- Regions: by customer_state, sorted by sales DESC. Percentage is computed in TS.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'state', state,
    'sales', sales_count,
    'revenue', revenue
  ) ORDER BY sales_count DESC), '[]'::jsonb)
  INTO v_regions
  FROM (
    SELECT customer_state AS state,
           COUNT(*) AS sales_count,
           SUM(amount) AS revenue
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND blocked_by_limit = false
      AND customer_state IS NOT NULL
      AND customer_state <> ''
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY customer_state
  ) r;

  -- Recent: 9 most recent approved sales (id, product_name, sold_at, amount).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'product_name', product_name,
    'sold_at', sold_at,
    'amount', amount
  ) ORDER BY sold_at DESC, id DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT id, product_name, sold_at, amount
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND blocked_by_limit = false
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    ORDER BY sold_at DESC, id DESC
    LIMIT 9
  ) rs;

  RETURN jsonb_build_object(
    'gross_revenue', v_gross,
    'sales_count', v_count,
    'lifetime_revenue', v_lifetime,
    'chart_data', v_chart,
    'regions', v_regions,
    'recent_sales', v_recent
  );
END;
$$;

-- ============================================================
-- LC sales aggregated by ad_id (or extracted from utm_term/utm_content).
-- Feeds campaign/adset/ad attribution maps.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sales_grouped_by_ad(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  ad_id text,
  approved_count int,
  approved_revenue numeric,
  refunded_count int,
  refunded_revenue numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH extracted AS (
    SELECT
      COALESCE(
        public.extract_numeric_ad_id(s.ad_id),
        public.extract_numeric_ad_id(s.utm_term),
        public.extract_numeric_ad_id(s.utm_content)
      ) AS extracted_ad_id,
      s.status,
      s.amount
    FROM public.sales s
    WHERE s.user_id = p_user_id
      AND s.status IN ('approved', 'refunded')
      AND s.blocked_by_limit = false
      AND (s.ad_id IS NOT NULL OR s.utm_content IS NOT NULL OR s.utm_term IS NOT NULL)
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
  )
  SELECT
    extracted_ad_id,
    COUNT(*) FILTER (WHERE status = 'approved')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::numeric,
    COUNT(*) FILTER (WHERE status = 'refunded')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric
  FROM extracted
  WHERE extracted_ad_id IS NOT NULL
  GROUP BY extracted_ad_id;
$$;

-- ============================================================
-- Permissions.
-- These functions take p_user_id directly; granting frontend roles would let
-- the anon/authenticated roles read any user's data. Lock them to service_role.
-- (service_role bypasses RLS anyway, so the GRANT is just for PostgREST's
-- function-execution check.)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.extract_numeric_ad_id(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.extract_numeric_ad_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) TO service_role;
