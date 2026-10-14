-- ============================================================
-- Testes A/B da página de vendas, medidos pelo indexador
-- ============================================================
-- O snippet (tracker.js) sorteia a variante de cada visitante e avisa o
-- /collect. A venda volta pelo webhook com o indexador stl_<sessão>, o
-- tracking_match_sale liga a venda à sessão e, por ela, ao visitante — e o
-- visitante diz em que variante estava. Nada aqui muda a ingestão nem o
-- casamento: as funções existentes ficam como estão.
--
--   ab_tests             o teste: página, modo, objetivo, estado
--   ab_test_variants     A, B, C... com peso e, no modo redirect, a URL
--   ab_test_assignments  um visitante numa variante (o primeiro sorteio vale)
--
-- Só aditiva: tabelas novas, duas funções novas e dois índices de leitura.

BEGIN;

-- ------------------------------------------------------------
-- 1. Testes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hypothesis TEXT,
  -- redirect: cada variante é uma página; o snippet leva o visitante à dele.
  -- elements: uma página só; o snippet mostra os blocos data-stl-ab da variante.
  mode TEXT NOT NULL DEFAULT 'redirect' CHECK (mode IN ('redirect', 'elements')),
  -- Página onde o teste roda (a do controle, no modo redirect).
  page_url TEXT NOT NULL,
  -- Métrica que decide o vencedor.
  goal TEXT NOT NULL DEFAULT 'sale' CHECK (goal IN ('sale', 'checkout', 'revenue')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'finished')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  winner_variant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_workspace_status
  ON public.ab_tests (workspace_id, status);

-- ------------------------------------------------------------
-- 2. Variantes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ab_test_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES public.ab_tests(id) ON DELETE CASCADE,
  -- A, B, C, D, E. A é sempre o controle.
  key TEXT NOT NULL CHECK (key ~ '^[A-E]$'),
  name TEXT NOT NULL,
  -- Só no modo redirect.
  url TEXT,
  weight INT NOT NULL DEFAULT 50 CHECK (weight BETWEEN 1 AND 100),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, key)
);

ALTER TABLE public.ab_tests DROP CONSTRAINT IF EXISTS ab_tests_winner_fk;
ALTER TABLE public.ab_tests ADD CONSTRAINT ab_tests_winner_fk
  FOREIGN KEY (winner_variant_id) REFERENCES public.ab_test_variants(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. Sorteios
-- ------------------------------------------------------------
-- Um visitante entra numa variante uma vez por teste. session_id é a visita
-- em que ele foi sorteado: a partir dela contam os cliques e as vendas.
CREATE TABLE IF NOT EXISTS public.ab_test_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.ab_tests(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.ab_test_variants(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_ab_assignments_variant
  ON public.ab_test_assignments (test_id, variant_id);

-- Leitura do resultado: vendas e sessões do visitante sorteado.
CREATE INDEX IF NOT EXISTS idx_sales_visitor
  ON public.sales (workspace_id, visitor_id) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_visitor
  ON public.tracking_sessions (workspace_id, visitor_id);

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------
-- Como no rastreio: o dono lê, e toda escrita vem do backend com a service
-- role. O snippet não tem login.
ALTER TABLE public.ab_tests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_test_variants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_test_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono le os testes da area" ON public.ab_tests;
CREATE POLICY "Dono le os testes da area" ON public.ab_tests
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Dono le as variantes da area" ON public.ab_test_variants;
CREATE POLICY "Dono le as variantes da area" ON public.ab_test_variants
  FOR SELECT USING (test_id IN (
    SELECT t.id FROM public.ab_tests t
    JOIN public.workspaces w ON w.id = t.workspace_id
    WHERE w.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Dono le os sorteios da area" ON public.ab_test_assignments;
CREATE POLICY "Dono le os sorteios da area" ON public.ab_test_assignments
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- ------------------------------------------------------------
-- 5. Gravação do sorteio, pelo /collect
-- ------------------------------------------------------------
-- p_assignments: [{ test_id, variant_id }]. Entra só o que confere: teste
-- rodando, da mesma área, e variante do mesmo teste. Um visitante que já
-- tem variante fica com ela (o primeiro sorteio vale).
CREATE OR REPLACE FUNCTION public.ab_record_assignments(
  p_workspace_id uuid,
  p_visitor_id text,
  p_session_id text,
  p_assignments jsonb
)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO ab_test_assignments (workspace_id, test_id, variant_id, visitor_id, session_id)
  SELECT p_workspace_id, t.id, v.id, p_visitor_id, p_session_id
  FROM jsonb_array_elements(p_assignments) e
  JOIN ab_tests t
    ON t.id::text = e->>'test_id' AND t.workspace_id = p_workspace_id AND t.status = 'running'
  JOIN ab_test_variants v
    ON v.id::text = e->>'variant_id' AND v.test_id = t.id
  ON CONFLICT (test_id, visitor_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ab_record_assignments(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_record_assignments(uuid, text, text, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 6. Resultado por variante
-- ------------------------------------------------------------
-- Por visitante sorteado, a partir do sorteio:
--   checkout  alguma sessão dele (a do sorteio ou posterior) clicou no checkout
--   compra    venda aprovada ligada a ele (sales.visitor_id, que o
--             tracking_match_sale preenche — pelo indexador, na maioria)
--   receita   soma das linhas aprovadas (order bumps inclusos), como no Dashboard
--
-- Vendas contam até 7 dias depois do fim do teste: boleto e pix aprovam
-- depois do clique. revenue_sq (soma dos quadrados da receita por visitante)
-- é o que o backend precisa para a variância da receita por visitante.
--
-- unmatched_sales: pedidos aprovados no período do teste sem visita ligada.
-- Alto demais quer dizer que o indexador não está voltando no webhook.
CREATE OR REPLACE FUNCTION public.ab_test_results(p_user_id uuid, p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_test ab_tests%ROWTYPE;
  v_until timestamptz;
  v_variants jsonb;
  v_daily jsonb;
  v_unmatched int;
BEGIN
  SELECT t.* INTO v_test
  FROM ab_tests t
  JOIN workspaces w ON w.id = t.workspace_id
  WHERE t.id = p_test_id AND w.user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_until := COALESCE(v_test.ended_at + interval '7 days', 'infinity'::timestamptz);

  WITH a AS (
    SELECT * FROM ab_test_assignments WHERE test_id = p_test_id
  ),
  clk AS (
    SELECT DISTINCT a.variant_id, a.visitor_id
    FROM a
    JOIN tracking_sessions s
      ON s.workspace_id = v_test.workspace_id
     AND s.visitor_id = a.visitor_id
     AND s.had_checkout_click
     AND (s.session_id = a.session_id OR s.started_at >= a.assigned_at)
     AND s.started_at < v_until
  ),
  buy AS (
    SELECT a.variant_id, a.visitor_id,
      COUNT(DISTINCT COALESCE(x.order_external_id, x.id::text)) AS orders,
      COUNT(DISTINCT COALESCE(x.order_external_id, x.id::text))
        FILTER (WHERE x.match_method IN ('sck', 'order')) AS orders_indexed,
      SUM(x.amount) AS revenue
    FROM a
    JOIN sales x
      ON x.workspace_id = v_test.workspace_id
     AND x.user_id = p_user_id
     AND x.visitor_id = a.visitor_id
     AND x.status = 'approved'
     AND x.sold_at >= a.assigned_at - interval '5 minutes'
     AND x.sold_at < v_until
    GROUP BY 1, 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'key', v.key,
    'name', v.name,
    'url', v.url,
    'weight', v.weight,
    'visitors', (SELECT COUNT(*) FROM a WHERE a.variant_id = v.id),
    'checkout_visitors', (SELECT COUNT(*) FROM clk WHERE clk.variant_id = v.id),
    'buyers', (SELECT COUNT(*) FROM buy WHERE buy.variant_id = v.id),
    'orders', (SELECT COALESCE(SUM(orders), 0) FROM buy WHERE buy.variant_id = v.id),
    'orders_indexed', (SELECT COALESCE(SUM(orders_indexed), 0) FROM buy WHERE buy.variant_id = v.id),
    'revenue', (SELECT COALESCE(SUM(revenue), 0) FROM buy WHERE buy.variant_id = v.id),
    'revenue_sq', (SELECT COALESCE(SUM(revenue * revenue), 0) FROM buy WHERE buy.variant_id = v.id)
  ) ORDER BY v.position, v.key), '[]'::jsonb)
  INTO v_variants
  FROM ab_test_variants v
  WHERE v.test_id = p_test_id;

  -- Série diária (calendário de São Paulo): sorteados no dia e compradores
  -- pelo dia da primeira compra. O painel acumula para a curva de conversão.
  WITH a AS (
    SELECT * FROM ab_test_assignments WHERE test_id = p_test_id
  ),
  firsts AS (
    SELECT a.variant_id, a.visitor_id, MIN(x.sold_at) AS first_sale
    FROM a
    JOIN sales x
      ON x.workspace_id = v_test.workspace_id
     AND x.user_id = p_user_id
     AND x.visitor_id = a.visitor_id
     AND x.status = 'approved'
     AND x.sold_at >= a.assigned_at - interval '5 minutes'
     AND x.sold_at < v_until
    GROUP BY 1, 2
  ),
  rows AS (
    SELECT variant_id, (assigned_at AT TIME ZONE 'America/Sao_Paulo')::date AS d, 1 AS visitors, 0 AS buyers FROM a
    UNION ALL
    SELECT variant_id, (first_sale AT TIME ZONE 'America/Sao_Paulo')::date, 0, 1 FROM firsts
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(d, 'YYYY-MM-DD'),
    'variant_id', variant_id,
    'visitors', visitors,
    'buyers', buyers
  ) ORDER BY d), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT variant_id, d, SUM(visitors) AS visitors, SUM(buyers) AS buyers
    FROM rows
    GROUP BY 1, 2
  ) g;

  IF v_test.started_at IS NULL THEN
    v_unmatched := 0;
  ELSE
    SELECT COUNT(DISTINCT COALESCE(order_external_id, id::text)) INTO v_unmatched
    FROM sales
    WHERE workspace_id = v_test.workspace_id
      AND user_id = p_user_id
      AND status = 'approved'
      AND visitor_id IS NULL
      AND sold_at >= v_test.started_at
      AND sold_at < LEAST(v_until, now() + interval '1 day');
  END IF;

  RETURN jsonb_build_object(
    'variants', v_variants,
    'daily', v_daily,
    'unmatched_sales', v_unmatched
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ab_test_results(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_test_results(uuid, uuid) TO service_role;

COMMIT;
