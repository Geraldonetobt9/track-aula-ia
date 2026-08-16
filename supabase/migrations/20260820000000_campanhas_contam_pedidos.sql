-- ============================================================
-- Campanhas: contar pedidos, somar linhas
-- ============================================================
-- Mesma regra já aplicada ao dashboard e à tela de vendas, agora na atribuição
-- por anúncio, que alimenta /campaigns.
--
-- Com uma linha por produto, uma compra com dois order bumps contava três
-- vendas para o mesmo anúncio. O faturamento estava certo — a soma das linhas
-- dá o valor do pedido — mas a contagem inflava, e com ela o CPA e a taxa de
-- conversão da campanha.
--
-- Agora a contagem usa DISTINCT sobre order_external_id: o anúncio recebe uma
-- venda, com o valor somado dos produtos que ela trouxe.

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
      s.amount,
      -- A chave do pedido. Venda de plataforma sem order bump recebe o próprio
      -- external_id no backfill, então cai no caso de sempre: uma linha, um
      -- pedido.
      COALESCE(s.order_external_id, s.id::text) AS pedido
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
    COUNT(DISTINCT pedido) FILTER (WHERE status = 'approved')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::numeric,
    COUNT(DISTINCT pedido) FILTER (WHERE status = 'refunded')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric
  FROM extracted
  WHERE extracted_ad_id IS NOT NULL
  GROUP BY extracted_ad_id;
$$;

REVOKE EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) TO service_role;
