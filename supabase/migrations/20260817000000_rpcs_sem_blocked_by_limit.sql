-- ============================================================
-- RPCs de agregacao sem blocked_by_limit
-- ============================================================
-- A coluna sales.blocked_by_limit foi derrubada junto com a cobranca, mas as
-- tres funcoes de agregacao continuavam filtrando por ela. O Postgres so
-- reclama quando a funcao roda, entao a migration passou e o erro apareceu
-- na tela: dashboard_metrics devolvia
--   42703: column "blocked_by_limit" does not exist
-- e o dashboard mostrava tudo zerado, com os dados ja gravados no banco.
--
-- Este arquivo recria as tres funcoes identicas as originais, sem esse filtro.
-- Nada mais muda: mesma assinatura, mesmas chaves de retorno.

-- >>> de 20260428100000_dashboard_aggregation_rpcs.sql

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

-- >>> de 20260508120000_sales_summary_rpc_v2.sql

CREATE OR REPLACE FUNCTION public.sales_summary(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_q_pattern text := CASE WHEN p_q IS NULL OR length(trim(p_q)) = 0 THEN NULL ELSE '%' || trim(p_q) || '%' END;
  v_approved_count int := 0;
  v_gross_revenue numeric := 0;
  v_avg_ticket numeric := 0;
  v_refunds_count int := 0;
  v_total_count int := 0;
  v_refund_rate numeric := 0;
  v_by_product jsonb := '[]'::jsonb;
  v_by_ad jsonb := '[]'::jsonb;
  v_refunds_by_state jsonb := '[]'::jsonb;
  v_refunded_sample jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_approved_count, v_gross_revenue
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  SELECT COUNT(*)
  INTO v_refunds_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'refunded'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  v_total_count := v_approved_count + v_refunds_count;
  IF v_total_count > 0 THEN
    v_refund_rate := (v_refunds_count::numeric / v_total_count) * 100;
  END IF;

  IF v_approved_count > 0 THEN
    v_avg_ticket := v_gross_revenue / v_approved_count;
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT jsonb_build_object(
      'product_name', COALESCE(product_name, 'Sem produto'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(amount), 0)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY product_name
    ORDER BY SUM(amount) DESC NULLS LAST
    LIMIT 10
  ) t;

  -- Top ads (approved sales, by quantity).
  -- Grouping key matches the pre-server-aggregation behavior:
  --   utm_content (UTM from the click) → ads.name → ad_id (raw) → 'Sem anúncio'
  -- ad_set / campaign names are intentionally NOT used as fallbacks here.
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_ad
  FROM (
    SELECT jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(s.utm_content), ''), a.name, NULLIF(s.ad_id, ''), 'Sem anúncio'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(s.amount), 0)
    ) AS row
    FROM public.sales s
    LEFT JOIN public.ads a ON s.ad_internal_id = a.id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
      AND (p_checkout_ids IS NULL OR s.checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR s.product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR s.campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR s.customer_email ILIKE v_q_pattern
        OR s.customer_name ILIKE v_q_pattern
        OR s.product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunds_by_state
  FROM (
    SELECT jsonb_build_object(
      'state', COALESCE(UPPER(TRIM(customer_state)), 'N/A'),
      'count', COUNT(*)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 3
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunded_sample
  FROM (
    SELECT jsonb_build_object(
      'customer_name', customer_name,
      'customer_state', customer_state,
      'amount', amount
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    ORDER BY sold_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object(
    'metrics', jsonb_build_object(
      'approved_count', v_approved_count,
      'gross_revenue', v_gross_revenue,
      'avg_ticket', v_avg_ticket,
      'refunds_count', v_refunds_count,
      'refund_rate', v_refund_rate
    ),
    'by_product', v_by_product,
    'by_ad', v_by_ad,
    'refunds_by_state', v_refunds_by_state,
    'refunded_sample', v_refunded_sample
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sales_summary(uuid, uuid, timestamptz, timestamptz, text[], uuid[], text[], uuid[], text) TO authenticated, service_role;

