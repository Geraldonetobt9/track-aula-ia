-- Restore the original "Vendas por Anúncio" grouping rule and fix the ads JOIN.
--
-- The previous version of sales_summary (20260506110000) had two problems:
--
-- 1. The by_ad breakdown grouped by
--    COALESCE(ads.name, ad_sets.name, campaigns.name, 'Anúncio não identificado'),
--    which changed the card behavior: when a sale only resolved to an ad_set
--    or campaign, the card showed the ad set / campaign name instead of the
--    pre-rewrite behavior of falling back to utm_content / raw ad_id.
--
-- 2. The JOIN `s.ad_id = a.id` compared text (Facebook ad id stored in
--    sales.ad_id) with uuid (ads.id), which raised
--    "operator does not exist: text = uuid" at runtime. The whole RPC
--    failed and the backend silently fell back to the in-memory aggregation
--    in sales.service.ts. This migration switches the JOIN to the actual
--    foreign key (sales.ad_internal_id → ads.id) so the RPC actually runs.
--
-- This migration recreates the function with the original grouping key:
--   COALESCE(s.utm_content, ads.name, s.ad_id, 'Sem anúncio')
-- Every other aggregation (metrics, by_product, refunds_by_state,
-- refunded_sample) is unchanged.

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
    AND blocked_by_limit = false
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
    AND blocked_by_limit = false
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
      AND blocked_by_limit = false
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
      AND s.blocked_by_limit = false
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
      AND blocked_by_limit = false
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
      AND blocked_by_limit = false
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
