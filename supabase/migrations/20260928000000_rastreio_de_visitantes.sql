-- ============================================================
-- Rastreio de visitantes: do clique na página de vendas até a venda
-- ============================================================
-- Até aqui o painel só sabia de uma venda quando o webhook do checkout
-- chegava. Quem visitou a página e não comprou não existia.
--
-- O snippet (GET /api/t/tracker.js) grava a visita; o webhook, quando chega,
-- tenta achar a sessão que levou à compra. Três tabelas:
--
--   tracking_visitors  uma linha por navegador (cookie _stl_vid, 1 ano)
--   tracking_sessions  uma linha por visita (cookie _stl_sid, 30 min)
--   tracking_events    cada pageview, clique no checkout, saída, evento custom
--
-- Os nomes levam o prefixo tracking_ de propósito: "sessions" sozinho se
-- confunde com auth.sessions do Supabase.
--
-- Sem IP. O snippet não coleta dado pessoal, e o IP do visitante só serviria
-- para casar por "impressão digital" — que não funciona aqui, porque o webhook
-- de venda traz o IP do servidor da plataforma, não o do comprador. A cidade e
-- o estado vêm dos headers de geolocalização da Vercel, sem guardar o IP.

BEGIN;

-- ------------------------------------------------------------
-- 1. Visitantes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_sessions INT NOT NULL DEFAULT 1,
  total_pageviews INT NOT NULL DEFAULT 0,
  first_utm_source TEXT,
  first_utm_medium TEXT,
  first_utm_campaign TEXT,
  first_utm_content TEXT,
  first_referrer TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  device_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_visitors_workspace_last_seen
  ON public.tracking_visitors (workspace_id, last_seen_at DESC);

-- ------------------------------------------------------------
-- 2. Sessões
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Última atividade vista. A sessão não "termina" de forma explícita: o
  -- cookie expira depois de 30 minutos parado.
  ended_at TIMESTAMPTZ,
  -- Do início da sessão até a última saída de página (page_exit).
  duration_seconds INT,

  -- UTMs da entrada. Primeiro toque dentro da sessão: um pageview seguinte
  -- sem UTM não apaga o que veio na chegada.
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbclid TEXT,
  gclid TEXT,
  ad_id TEXT,

  landing_page TEXT NOT NULL,
  referrer TEXT,

  user_agent TEXT,
  screen_resolution TEXT,
  language TEXT,
  device_type TEXT,
  country TEXT,
  region TEXT,
  city TEXT,

  pageviews INT NOT NULL DEFAULT 0,
  had_checkout_click BOOLEAN NOT NULL DEFAULT FALSE,
  checkout_clicked_at TIMESTAMPTZ,

  -- Preenchido pelo casamento com a venda (tracking_match_sale).
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  match_method TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_workspace_started
  ON public.tracking_sessions (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_fbclid
  ON public.tracking_sessions (workspace_id, fbclid) WHERE fbclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_utm_match
  ON public.tracking_sessions (workspace_id, utm_source, utm_campaign, utm_content)
  WHERE utm_content IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_sale
  ON public.tracking_sessions (sale_id) WHERE sale_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Eventos
-- ------------------------------------------------------------
-- A tabela que mais cresce. Sem particionamento por enquanto: a retenção de
-- 90 dias (seção 8) é o que a mantém limitada.
CREATE TABLE IF NOT EXISTS public.tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  -- pageview, checkout_click, page_exit, custom
  event_type TEXT NOT NULL,
  -- Nome livre, para eventos custom (sentinel('track', 'video_play')).
  event_name TEXT,
  url TEXT,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_session
  ON public.tracking_events (workspace_id, session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tracking_events_type
  ON public.tracking_events (workspace_id, event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tracking_events_occurred_brin
  ON public.tracking_events USING brin (occurred_at);

-- ------------------------------------------------------------
-- 4. Vínculo na venda
-- ------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS matched_session_at TIMESTAMPTZ;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS match_method TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_session
  ON public.sales (workspace_id, session_id) WHERE session_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------
-- Só leitura, pelo dono da área. Toda escrita vem do backend com a service
-- role, que ignora RLS. Não há política de INSERT/UPDATE para usuários: o
-- snippet não tem login, e liberar escrita para "authenticated" só abriria
-- espaço para gravar visita falsa pelo navegador.
ALTER TABLE public.tracking_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono le os visitantes da area" ON public.tracking_visitors;
CREATE POLICY "Dono le os visitantes da area" ON public.tracking_visitors
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Dono le as sessoes da area" ON public.tracking_sessions;
CREATE POLICY "Dono le as sessoes da area" ON public.tracking_sessions
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Dono le os eventos da area" ON public.tracking_events;
CREATE POLICY "Dono le os eventos da area" ON public.tracking_events
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- ------------------------------------------------------------
-- 6. Ingestão: um lote do snippet numa ida só ao banco
-- ------------------------------------------------------------
-- O /collect roda numa função da Vercel, que congela assim que responde. Não
-- dá para responder antes e gravar depois, então a gravação precisa ser
-- rápida: visitante, sessão e eventos numa única chamada, em vez de três
-- idas e voltas pelo PostgREST.
--
-- p_ctx:    { user_agent, screen_resolution, language, device_type,
--             country, region, city }
-- p_events: [{ type, name, url, referrer, utm_source, utm_medium,
--              utm_campaign, utm_content, utm_term, fbclid, gclid, ad_id,
--              duration_seconds, page_id, props }]
--
-- O backend já normalizou tudo (tamanhos, tipos, vazios viram null). Esta
-- função só é executável pela service role.
CREATE OR REPLACE FUNCTION public.tracking_ingest(
  p_workspace_id uuid,
  p_visitor_id text,
  p_session_id text,
  p_ctx jsonb,
  p_events jsonb
)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_first jsonb;
  v_pageviews int;
  v_clicked boolean;
  v_exit boolean;
  v_exit_duration int;
  v_new_session boolean;
  v_count int;
BEGIN
  IF p_events IS NULL OR jsonb_array_length(p_events) = 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id) THEN
    RETURN 0;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE e->>'type' = 'pageview'),
    COALESCE(bool_or(e->>'type' = 'checkout_click'), false),
    COALESCE(bool_or(e->>'type' = 'page_exit'), false),
    MAX((e->>'duration_seconds')::int) FILTER (WHERE e->>'type' = 'page_exit')
  INTO v_pageviews, v_clicked, v_exit, v_exit_duration
  FROM jsonb_array_elements(p_events) e;

  -- A sessão nasce do primeiro pageview do lote. Sem pageview (um page_exit
  -- que chegou sozinho), vale o primeiro evento: ainda tem a URL.
  SELECT e INTO v_first
  FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, i)
  ORDER BY (e->>'type' = 'pageview') DESC, i
  LIMIT 1;

  INSERT INTO tracking_sessions AS s (
    workspace_id, visitor_id, session_id, started_at, ended_at, duration_seconds,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, ad_id, landing_page, referrer,
    user_agent, screen_resolution, language, device_type, country, region, city,
    pageviews, had_checkout_click, checkout_clicked_at
  ) VALUES (
    p_workspace_id, p_visitor_id, p_session_id, v_now, v_now,
    CASE WHEN v_exit THEN v_exit_duration END,
    v_first->>'utm_source', v_first->>'utm_medium', v_first->>'utm_campaign',
    v_first->>'utm_content', v_first->>'utm_term',
    v_first->>'fbclid', v_first->>'gclid', v_first->>'ad_id',
    COALESCE(v_first->>'url', ''), v_first->>'referrer',
    p_ctx->>'user_agent', p_ctx->>'screen_resolution', p_ctx->>'language',
    p_ctx->>'device_type', p_ctx->>'country', p_ctx->>'region', p_ctx->>'city',
    v_pageviews, v_clicked, CASE WHEN v_clicked THEN v_now END
  )
  ON CONFLICT (workspace_id, session_id) DO UPDATE SET
    ended_at = v_now,
    pageviews = s.pageviews + EXCLUDED.pageviews,
    had_checkout_click = s.had_checkout_click OR EXCLUDED.had_checkout_click,
    checkout_clicked_at = COALESCE(s.checkout_clicked_at, EXCLUDED.checkout_clicked_at),
    -- Duração = do início da sessão até a saída mais recente. Medida pelo
    -- relógio do servidor, que não depende do relógio do visitante.
    duration_seconds = CASE
      WHEN v_exit THEN GREATEST(
        COALESCE(s.duration_seconds, 0),
        COALESCE(EXCLUDED.duration_seconds, 0),
        EXTRACT(EPOCH FROM (v_now - s.started_at))::int
      )
      ELSE s.duration_seconds
    END,
    utm_source   = COALESCE(s.utm_source,   EXCLUDED.utm_source),
    utm_medium   = COALESCE(s.utm_medium,   EXCLUDED.utm_medium),
    utm_campaign = COALESCE(s.utm_campaign, EXCLUDED.utm_campaign),
    utm_content  = COALESCE(s.utm_content,  EXCLUDED.utm_content),
    utm_term     = COALESCE(s.utm_term,     EXCLUDED.utm_term),
    fbclid       = COALESCE(s.fbclid,       EXCLUDED.fbclid),
    gclid        = COALESCE(s.gclid,        EXCLUDED.gclid),
    ad_id        = COALESCE(s.ad_id,        EXCLUDED.ad_id),
    landing_page = CASE WHEN s.landing_page = '' THEN EXCLUDED.landing_page ELSE s.landing_page END
  RETURNING (xmax = 0) INTO v_new_session;

  INSERT INTO tracking_visitors AS v (
    workspace_id, visitor_id, first_seen_at, last_seen_at, total_sessions, total_pageviews,
    first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_referrer,
    country, region, city, device_type
  ) VALUES (
    p_workspace_id, p_visitor_id, v_now, v_now, 1, v_pageviews,
    v_first->>'utm_source', v_first->>'utm_medium', v_first->>'utm_campaign',
    v_first->>'utm_content', v_first->>'referrer',
    p_ctx->>'country', p_ctx->>'region', p_ctx->>'city', p_ctx->>'device_type'
  )
  ON CONFLICT (workspace_id, visitor_id) DO UPDATE SET
    last_seen_at = v_now,
    total_pageviews = v.total_pageviews + EXCLUDED.total_pageviews,
    total_sessions = v.total_sessions + CASE WHEN v_new_session THEN 1 ELSE 0 END,
    country = COALESCE(EXCLUDED.country, v.country),
    region = COALESCE(EXCLUDED.region, v.region),
    city = COALESCE(EXCLUDED.city, v.city),
    device_type = COALESCE(EXCLUDED.device_type, v.device_type);

  INSERT INTO tracking_events (workspace_id, session_id, visitor_id, event_type, event_name, url, metadata, occurred_at)
  SELECT
    p_workspace_id, p_session_id, p_visitor_id,
    e->>'type', e->>'name', e->>'url',
    NULLIF(jsonb_strip_nulls(jsonb_build_object(
      'duration_seconds', e->'duration_seconds',
      'page_id', e->'page_id',
      'referrer', e->'referrer',
      'props', e->'props'
    )), '{}'::jsonb),
    v_now
  FROM jsonb_array_elements(p_events) e;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_ingest(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_ingest(uuid, text, text, jsonb, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 7. Casamento venda ↔ sessão
-- ------------------------------------------------------------
-- Chamado logo depois de a venda ser gravada pelo webhook. Nunca muda a
-- atribuição por UTM (campaign_id, ad_set_id, ad_internal_id): só liga a
-- venda à visita, para mostrar a jornada e medir conversão.
--
-- Ordem, do mais para o menos confiável:
--
--   order   outra linha do mesmo pedido já foi casada (order bump da Hubla)
--   sck     o snippet escreveu stl_<session_id> no link do checkout, e a
--           plataforma devolveu no webhook. Casamento exato.
--   fbclid  o mesmo clique do Facebook na venda e na sessão.
--   utm_exact  source + campaign + content iguais, com clique no checkout
--           nas 24h anteriores à venda — e SÓ se houver uma única sessão
--           candidata. Com duas pessoas vindas do mesmo anúncio, escolher
--           uma seria chute; melhor deixar sem vínculo do que mostrar a
--           jornada de outra pessoa.
--
-- Não há casamento por e-mail nem por IP + user agent: o webhook traz o IP do
-- servidor da plataforma, não o do comprador, e o snippet não coleta e-mail.
CREATE OR REPLACE FUNCTION public.tracking_match_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_session tracking_sessions%ROWTYPE;
  v_method text;
  v_text text;
  v_sid text;
  v_fbclid text;
  v_candidates int;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.workspace_id IS NULL OR v_sale.session_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Mesmo pedido, outra linha já casada.
  IF v_sale.order_external_id IS NOT NULL THEN
    SELECT s.* INTO v_session
    FROM sales o
    JOIN tracking_sessions s
      ON s.workspace_id = o.workspace_id AND s.session_id = o.session_id
    WHERE o.workspace_id = v_sale.workspace_id
      AND o.order_external_id = v_sale.order_external_id
      AND o.id <> v_sale.id
      AND o.session_id IS NOT NULL
    LIMIT 1;
    IF FOUND THEN v_method := 'order'; END IF;
  END IF;

  -- sck: procura o marcador em qualquer lugar do que a plataforma devolveu.
  -- Cada checkout guarda o parâmetro num campo diferente do metadata; varrer
  -- o texto evita manter um mapa por plataforma.
  IF v_method IS NULL THEN
    v_text := concat_ws(' ', v_sale.metadata::text, v_sale.utm_source, v_sale.utm_medium,
                        v_sale.utm_campaign, v_sale.utm_content, v_sale.utm_term, v_sale.ad_id);
    v_sid := substring(v_text FROM 'stl_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})');
    IF v_sid IS NOT NULL THEN
      SELECT * INTO v_session FROM tracking_sessions
      WHERE workspace_id = v_sale.workspace_id AND session_id = v_sid;
      IF FOUND THEN v_method := 'sck'; END IF;
    END IF;
  END IF;

  -- fbclid: direto, ou dentro do _fbc (fb.1.<timestamp>.<fbclid>).
  IF v_method IS NULL THEN
    v_fbclid := NULLIF(COALESCE(
      v_sale.metadata->>'fbclid',
      v_sale.metadata->'tracking'->>'fbclid',
      NULLIF(split_part(COALESCE(v_sale.metadata->>'fbc', ''), '.', 4), '')
    ), '');
    IF v_fbclid IS NOT NULL THEN
      SELECT * INTO v_session FROM tracking_sessions
      WHERE workspace_id = v_sale.workspace_id
        AND fbclid = v_fbclid
        AND started_at <= v_sale.sold_at + interval '5 minutes'
        AND started_at >= v_sale.sold_at - interval '7 days'
      ORDER BY started_at DESC
      LIMIT 1;
      IF FOUND THEN v_method := 'fbclid'; END IF;
    END IF;
  END IF;

  -- UTMs exatas, candidata única.
  IF v_method IS NULL
     AND v_sale.utm_source IS NOT NULL
     AND v_sale.utm_campaign IS NOT NULL
     AND v_sale.utm_content IS NOT NULL THEN
    SELECT COUNT(*) INTO v_candidates
    FROM tracking_sessions
    WHERE workspace_id = v_sale.workspace_id
      AND utm_source = v_sale.utm_source
      AND utm_campaign = v_sale.utm_campaign
      AND utm_content = v_sale.utm_content
      AND had_checkout_click
      AND sale_id IS NULL
      AND checkout_clicked_at BETWEEN v_sale.sold_at - interval '24 hours'
                                  AND v_sale.sold_at + interval '5 minutes';

    IF v_candidates = 1 THEN
      SELECT * INTO v_session
      FROM tracking_sessions
      WHERE workspace_id = v_sale.workspace_id
        AND utm_source = v_sale.utm_source
        AND utm_campaign = v_sale.utm_campaign
        AND utm_content = v_sale.utm_content
        AND had_checkout_click
        AND sale_id IS NULL
        AND checkout_clicked_at BETWEEN v_sale.sold_at - interval '24 hours'
                                    AND v_sale.sold_at + interval '5 minutes';
      v_method := 'utm_exact';
    END IF;
  END IF;

  IF v_method IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE sales
  SET session_id = v_session.session_id,
      visitor_id = v_session.visitor_id,
      matched_session_at = now(),
      match_method = v_method
  WHERE id = p_sale_id;

  -- A sessão aponta para a primeira linha do pedido; as demais linhas apontam
  -- para a sessão pelo sales.session_id.
  UPDATE tracking_sessions
  SET sale_id = p_sale_id, matched_at = now(), match_method = v_method
  WHERE id = v_session.id AND sale_id IS NULL;

  RETURN jsonb_build_object('session_id', v_session.session_id, 'method', v_method);
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_match_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_match_sale(uuid) TO service_role;

-- ------------------------------------------------------------
-- 8. Leitura: números da página /tracking e dos cards do Dashboard
-- ------------------------------------------------------------
-- "Rejeição" segue a definição do GA4 para sessão não engajada: uma página
-- só, nenhum clique no checkout e menos de 10 segundos. A regra clássica
-- ("uma página só") não serve aqui — página de vendas é uma página só por
-- natureza, e quase toda sessão contaria como rejeição.
--
-- Vendas = pedidos aprovados no período, contados como no Dashboard
-- (DISTINCT order_external_id), casados ou não com uma sessão. É o que torna
-- a conversão comparável com o resto do painel. matched_sales diz quantas
-- desses pedidos têm jornada conhecida.
CREATE OR REPLACE FUNCTION public.tracking_stats(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_today timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_cur jsonb;
  v_prev jsonb;
  v_daily jsonb;
  v_today_visitors int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id AND user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  WITH per AS (
    SELECT 'cur' AS period, p_from AS f, p_to AS t
    UNION ALL
    SELECT 'prev', v_prev_from, p_from
  ),
  sess AS (
    SELECT per.period,
      COUNT(DISTINCT s.visitor_id) AS visitors,
      COUNT(s.id) AS sessions,
      COALESCE(SUM(s.pageviews), 0) AS pageviews,
      AVG(s.duration_seconds) FILTER (WHERE s.duration_seconds IS NOT NULL) AS avg_duration,
      COUNT(s.id) FILTER (
        WHERE s.pageviews <= 1 AND NOT s.had_checkout_click AND COALESCE(s.duration_seconds, 0) < 10
      ) AS bounced,
      COUNT(s.id) FILTER (WHERE s.had_checkout_click) AS checkout_sessions,
      COUNT(DISTINCT s.visitor_id) FILTER (WHERE s.had_checkout_click) AS checkout_visitors
    FROM per
    LEFT JOIN tracking_sessions s
      ON s.workspace_id = p_workspace_id AND s.started_at >= per.f AND s.started_at < per.t
    GROUP BY per.period
  ),
  sal AS (
    SELECT per.period,
      COUNT(DISTINCT COALESCE(x.order_external_id, x.id::text)) AS sales,
      COUNT(DISTINCT COALESCE(x.order_external_id, x.id::text)) FILTER (WHERE x.session_id IS NOT NULL) AS matched_sales
    FROM per
    LEFT JOIN sales x
      ON x.workspace_id = p_workspace_id AND x.user_id = p_user_id AND x.status = 'approved'
     AND x.sold_at >= per.f AND x.sold_at < per.t
    GROUP BY per.period
  )
  SELECT
    jsonb_object_agg(sess.period, jsonb_build_object(
      'visitors', sess.visitors,
      'sessions', sess.sessions,
      'pageviews', sess.pageviews,
      'avg_duration', COALESCE(round(sess.avg_duration), 0),
      'bounced', sess.bounced,
      'checkout_sessions', sess.checkout_sessions,
      'checkout_visitors', sess.checkout_visitors,
      'sales', sal.sales,
      'matched_sales', sal.matched_sales
    ))
  INTO v_cur
  FROM sess JOIN sal USING (period);

  v_prev := v_cur->'prev';
  v_cur := v_cur->'cur';

  SELECT COUNT(DISTINCT visitor_id) INTO v_today_visitors
  FROM tracking_sessions
  WHERE workspace_id = p_workspace_id AND started_at >= v_today;

  WITH days AS (
    SELECT generate_series(
      (p_from AT TIME ZONE 'America/Sao_Paulo')::date,
      ((p_to - interval '1 microsecond') AT TIME ZONE 'America/Sao_Paulo')::date,
      interval '1 day'
    )::date AS d
  ),
  v AS (
    SELECT (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
           COUNT(DISTINCT visitor_id) AS visitors,
           COUNT(*) FILTER (WHERE had_checkout_click) AS checkout_sessions
    FROM tracking_sessions
    WHERE workspace_id = p_workspace_id AND started_at >= p_from AND started_at < p_to
    GROUP BY 1
  ),
  s AS (
    SELECT (sold_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
           COUNT(DISTINCT COALESCE(order_external_id, id::text)) AS sales
    FROM sales
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND status = 'approved'
      AND sold_at >= p_from AND sold_at < p_to
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(days.d, 'YYYY-MM-DD'),
    'visitors', COALESCE(v.visitors, 0),
    'checkout_sessions', COALESCE(v.checkout_sessions, 0),
    'sales', COALESCE(s.sales, 0)
  ) ORDER BY days.d), '[]'::jsonb)
  INTO v_daily
  FROM days
  LEFT JOIN v ON v.d = days.d
  LEFT JOIN s ON s.d = days.d;

  RETURN jsonb_build_object(
    'current', v_cur,
    'previous', v_prev,
    'today_visitors', v_today_visitors,
    'daily', v_daily
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_stats(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_stats(uuid, uuid, timestamptz, timestamptz) TO service_role;

-- Quebra por página de entrada, origem ou campanha. Aqui as vendas são só as
-- casadas com uma sessão: é o único jeito de saber de que página ou origem
-- uma venda veio.
CREATE OR REPLACE FUNCTION public.tracking_breakdown(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_group text,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id AND user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  IF p_group NOT IN ('page', 'source', 'campaign') THEN
    RAISE EXCEPTION 'p_group invalido: %', p_group;
  END IF;

  WITH keyed AS (
    SELECT
      CASE p_group
        WHEN 'page' THEN NULLIF(landing_page, '')
        -- Sem UTM, o id de clique ainda diz a rede; depois, o domínio de
        -- quem mandou o visitante; sem nada disso, é acesso direto.
        WHEN 'source' THEN COALESCE(
          utm_source,
          CASE WHEN fbclid IS NOT NULL THEN 'facebook' WHEN gclid IS NOT NULL THEN 'google' END,
          substring(referrer FROM '^https?://(?:www\.)?([^/:?#]+)'),
          '(direto)'
        )
        WHEN 'campaign' THEN utm_campaign
      END AS key,
      s.*
    FROM tracking_sessions s
    WHERE s.workspace_id = p_workspace_id AND s.started_at >= p_from AND s.started_at < p_to
  ),
  grouped AS (
    SELECT
      COALESCE(key, '(sem valor)') AS key,
      COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(*) AS sessions,
      COALESCE(round(AVG(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL)), 0) AS avg_duration,
      COUNT(*) FILTER (
        WHERE pageviews <= 1 AND NOT had_checkout_click AND COALESCE(duration_seconds, 0) < 10
      ) AS bounced,
      COUNT(*) FILTER (WHERE had_checkout_click) AS checkout_sessions,
      COUNT(DISTINCT sale_id) AS sales
    FROM keyed
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.visitors DESC, g.key), '[]'::jsonb)
  INTO v_rows
  FROM (SELECT * FROM grouped ORDER BY visitors DESC, key LIMIT GREATEST(1, LEAST(p_limit, 200))) g;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_breakdown(uuid, uuid, timestamptz, timestamptz, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_breakdown(uuid, uuid, timestamptz, timestamptz, text, int) TO service_role;

COMMIT;

-- ------------------------------------------------------------
-- 9. Retenção
-- ------------------------------------------------------------
-- Eventos: 90 dias. Sessões sem venda: 1 ano. Sessões casadas ficam — são a
-- jornada da venda. Roda no pg_cron, e não num @Cron do backend: na Vercel
-- não existe processo de pé para disparar o agendamento.
--
-- 04:30 UTC = 01:30 em São Paulo, fora do horário de tráfego.
--
-- Fora da transação: se o pg_cron não estiver disponível, o resto da
-- migration continua valendo e o expurgo pode ser agendado depois.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'tracking-retention',
    '30 4 * * *',
    $job$
      DELETE FROM public.tracking_events WHERE occurred_at < now() - interval '90 days';
      DELETE FROM public.tracking_sessions WHERE sale_id IS NULL AND started_at < now() - interval '1 year';
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel, expurgo nao agendado (%).', SQLERRM;
END;
$$;
