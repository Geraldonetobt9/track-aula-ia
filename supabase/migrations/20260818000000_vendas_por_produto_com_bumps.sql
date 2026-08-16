-- ============================================================
-- Vendas por Produto: desmembra order bumps
-- ============================================================
-- Uma compra na Hubla traz o produto principal e os order bumps, cada um com
-- seu valor, alem do total somado da fatura.
--
-- O dashboard conta UMA venda pelo total — isso nao muda. O que muda e o
-- painel "Vendas por Produto": uma linha por produto, com o valor daquele
-- produto, lendo metadata.items gravado pelo processador.
--
-- Venda sem metadata.items continua aparecendo pelo product_name e valor
-- cheio, entao o historico ja gravado nao se perde.

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

  -- Vendas por Produto, desmembrando order bumps.
  --
  -- Uma compra na Hubla pode trazer o produto principal e varios bumps, cada um
  -- com seu valor. O processador guarda essa quebra em metadata.items.
  --
  -- Isto NAO afeta o dashboard: la a venda continua sendo uma so, pelo total.
  -- Sao duas leituras do mesmo fato.
  --
  -- A agregacao acontece em colunas simples e so depois vira JSON. Montar o
  -- jsonb_build_object dentro do GROUP BY, com ORDER BY sobre um agregado,
  -- fazia o Postgres recusar com 42803.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_name', item_name,
        'count',        qtd,
        'revenue',      receita
      ) ORDER BY receita DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_by_product
  FROM (
    SELECT
      item_name,
      COUNT(*)                      AS qtd,
      COALESCE(SUM(item_amount), 0) AS receita
    FROM (
      -- O LATERAL sobre '[null]' preserva a venda que nao tem items: o
      -- elemento nulo faz o COALESCE cair no product_name e no amount da venda,
      -- entao o historico ja gravado continua aparecendo.
      --
      -- O alias i(item) nomeia a coluna alem da tabela; so 'AS item' deixaria
      -- a referencia ambigua entre a linha inteira e a coluna.
      SELECT
        COALESCE(i.item ->> 'name', s.product_name, 'Sem produto') AS item_name,
        COALESCE((i.item ->> 'amount')::numeric, s.amount)          AS item_amount
      FROM public.sales s
      LEFT JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(s.metadata -> 'items') = 'array'
           AND jsonb_array_length(s.metadata -> 'items') > 0
          THEN s.metadata -> 'items'
          ELSE '[null]'::jsonb
        END
      ) AS i(item) ON true
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
    ) expandido
    GROUP BY item_name
    ORDER BY receita DESC NULLS LAST
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
