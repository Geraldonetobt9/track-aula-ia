-- ============================================================
-- Uma linha por produto, contando pedidos e não itens
-- ============================================================
-- Uma compra na Hubla traz o produto principal e os order bumps. O pedido é
-- um; os produtos são vários.
--
-- A tentativa anterior gravava UMA linha com o total e desmembrava na leitura,
-- a partir de metadata.items. Isso resolvia o painel de produtos e deixava de
-- fora "Vendas em tempo real" e a lista de vendas — que leem linhas, não
-- metadata. Consertar os três lugares na leitura seria remendar três vezes o
-- mesmo desencontro entre o modelo e a tela.
--
-- Agora cada produto é uma linha de venda, com seu valor. O que precisa ser
-- por pedido — a contagem de "Vendas aprovadas" — passa a contar pedidos
-- distintos, via order_external_id. O faturamento continua sendo a soma das
-- linhas, e dá o mesmo total de antes.

BEGIN;

-- ------------------------------------------------------------
-- 1. Colunas que ligam a linha ao pedido
-- ------------------------------------------------------------
ALTER TABLE public.sales
  -- O id da fatura na plataforma. Todas as linhas da mesma compra compartilham
  -- este valor; é ele que faz a contagem enxergar um pedido só.
  ADD COLUMN IF NOT EXISTS order_external_id text,
  ADD COLUMN IF NOT EXISTS is_order_bump     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sales.order_external_id IS
  'Id do pedido na plataforma. Linhas da mesma compra repetem este valor; a contagem de vendas usa DISTINCT sobre ele.';

-- A contagem por pedido roda em toda carga do dashboard, filtrada por período.
CREATE INDEX IF NOT EXISTS idx_sales_order_external
  ON public.sales (order_external_id, sold_at DESC)
  WHERE order_external_id IS NOT NULL;

-- Venda antiga não tem pedido: ela própria é o pedido.
UPDATE public.sales
SET order_external_id = external_id
WHERE order_external_id IS NULL
  AND external_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. dashboard_metrics: contar pedidos, somar linhas
-- ------------------------------------------------------------
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
  -- Faturamento soma as LINHAS; a contagem usa PEDIDOS distintos. É o que faz
  -- uma compra com dois order bumps valer R$ 218,28 e contar como 1 venda.
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(DISTINCT COALESCE(order_external_id, id::text))
  INTO v_gross, v_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names));

  SELECT COALESCE(SUM(amount), 0)
  INTO v_lifetime
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id);

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

  -- Região conta pedidos pelo mesmo motivo da contagem acima: senão uma compra
  -- com dois bumps apareceria como três vendas em São Paulo.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'state', state,
    'sales', sales_count,
    'revenue', revenue
  ) ORDER BY sales_count DESC), '[]'::jsonb)
  INTO v_regions
  FROM (
    SELECT customer_state AS state,
           COUNT(DISTINCT COALESCE(order_external_id, id::text)) AS sales_count,
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

  -- "Vendas em tempo real" mostra LINHAS: é exatamente onde o cliente quer ver
  -- o principal e os bumps separados, cada um com seu valor.
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

-- ------------------------------------------------------------
-- 3. sales_summary: volta ao agrupamento simples
-- ------------------------------------------------------------
-- Com uma linha por produto, o painel "Vendas por Produto" volta a ser um
-- GROUP BY product_name comum. O LATERAL sobre metadata.items da tentativa
-- anterior sai daqui — era ele que quebrava a tela com 42803.
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
  -- Pedidos distintos, pelo mesmo motivo do dashboard: o ticket medio de uma
  -- compra e o valor do pedido, nao o de cada item dela.
  SELECT COUNT(DISTINCT COALESCE(order_external_id, id::text)), COALESCE(SUM(amount), 0)
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

  SELECT COUNT(DISTINCT COALESCE(order_external_id, id::text))
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
      'count', COUNT(DISTINCT COALESCE(order_external_id, id::text))
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

GRANT EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_summary(uuid, uuid, timestamptz, timestamptz, text[], uuid[], text[], uuid[], text) TO authenticated, service_role;

COMMIT;
