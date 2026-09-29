-- ============================================================
-- Meta Conversions API: PageView, InitiateCheckout e Purchase pelo servidor
-- ============================================================
-- Substitui o desenho dos containers do sGTM (Stape Store Writer + Lookup +
-- tag do Facebook) pelo próprio painel:
--
--   página  → snippet no subdomínio do cliente → sessão com fbp, fbc, IP,
--             user agent, cidade, estado → PageView / InitiateCheckout na CAPI
--   webhook → venda → sessão achada pelo indexador stl_<sessão> → Purchase
--
-- O indexador vai no parâmetro que a plataforma devolve no webhook (sck, src,
-- xcod, trk ou utm_term), escolhido em Integrações.
--
-- Muda uma decisão da migration anterior: o IP passa a ser gravado. A CAPI
-- precisa dele (client_ip_address) para casar o evento com a pessoa. Fica 90
-- dias e é apagado (seção 5).

BEGIN;

-- ------------------------------------------------------------
-- 1. Configuração da área
-- ------------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS tracking_platform TEXT,
  ADD COLUMN IF NOT EXISTS tracking_param TEXT NOT NULL DEFAULT 'sck',
  ADD COLUMN IF NOT EXISTS tracking_domain TEXT,
  ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT,
  -- Cifrado pelo EncryptionService do backend, como o token do Meta Ads.
  ADD COLUMN IF NOT EXISTS meta_capi_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_test_event_code TEXT,
  -- Dispara também o pixel do navegador (fbq) com o mesmo event_id, para o
  -- Meta deduplicar. Desligado: só servidor.
  ADD COLUMN IF NOT EXISTS meta_mirror_browser BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_tracking_param_check;
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_tracking_param_check
  CHECK (tracking_param IN ('sck', 'src', 'xcod', 'trk', 'utm_term'));

-- ------------------------------------------------------------
-- 2. Dados de navegação na sessão
-- ------------------------------------------------------------
ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS fbp TEXT,
  ADD COLUMN IF NOT EXISTS fbc TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- ------------------------------------------------------------
-- 3. Ingestão: agora com fbp, fbc, IP e event_id
-- ------------------------------------------------------------
-- Igual à versão anterior, mais:
--   p_ctx.fbp, p_ctx.fbc, p_ctx.ip_address  → sessão
--   evento.event_id                          → metadata do evento
--
-- fbc: o mais recente vence (um clique novo no anúncio troca o fbc).
-- fbp: o primeiro fica (identifica o navegador, não muda).
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

  SELECT e INTO v_first
  FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, i)
  ORDER BY (e->>'type' = 'pageview') DESC, i
  LIMIT 1;

  INSERT INTO tracking_sessions AS s (
    workspace_id, visitor_id, session_id, started_at, ended_at, duration_seconds,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, ad_id, landing_page, referrer,
    user_agent, screen_resolution, language, device_type, country, region, city,
    fbp, fbc, ip_address,
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
    p_ctx->>'fbp', p_ctx->>'fbc', p_ctx->>'ip_address',
    v_pageviews, v_clicked, CASE WHEN v_clicked THEN v_now END
  )
  ON CONFLICT (workspace_id, session_id) DO UPDATE SET
    ended_at = v_now,
    pageviews = s.pageviews + EXCLUDED.pageviews,
    had_checkout_click = s.had_checkout_click OR EXCLUDED.had_checkout_click,
    checkout_clicked_at = COALESCE(s.checkout_clicked_at, EXCLUDED.checkout_clicked_at),
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
    fbp          = COALESCE(s.fbp,          EXCLUDED.fbp),
    fbc          = COALESCE(EXCLUDED.fbc,   s.fbc),
    ip_address   = COALESCE(EXCLUDED.ip_address, s.ip_address),
    user_agent   = COALESCE(EXCLUDED.user_agent, s.user_agent),
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
      'event_id', e->'event_id',
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
-- 4. Registro dos envios à CAPI
-- ------------------------------------------------------------
-- Um evento por linha. A unicidade (área, nome, event_id) é o que impede um
-- webhook reenviado pela plataforma de mandar o mesmo Purchase duas vezes: o
-- backend reserva a linha antes de enviar e só envia se a reserva entrou.
--
-- payload guarda o evento como foi (ou será) enviado: dados pessoais já em
-- SHA-256, e IP e user agent em claro, como o Meta exige. Serve para o
-- reenvio e para depurar; sai pela retenção.
CREATE TABLE IF NOT EXISTS public.capi_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  session_id TEXT,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  -- pending (reservado, envio em curso), sent, failed
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  response JSONB,
  fbtrace_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (workspace_id, event_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_capi_events_workspace_created
  ON public.capi_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_retry
  ON public.capi_events (status, created_at) WHERE status IN ('failed', 'pending');

ALTER TABLE public.capi_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono le os envios da area" ON public.capi_events;
CREATE POLICY "Dono le os envios da area" ON public.capi_events
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

COMMIT;

-- ------------------------------------------------------------
-- 5. Retenção
-- ------------------------------------------------------------
-- Substitui o job da migration anterior (cron.schedule atualiza pelo nome).
--   eventos de rastreio: 90 dias
--   IP da sessão: apagado aos 90 dias, a sessão fica
--   sessões sem venda: 1 ano
--   envios à CAPI: 30 dias (PageView/InitiateCheckout), 180 dias (Purchase)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'tracking-retention',
    '30 4 * * *',
    $job$
      DELETE FROM public.tracking_events WHERE occurred_at < now() - interval '90 days';
      UPDATE public.tracking_sessions SET ip_address = NULL
        WHERE ip_address IS NOT NULL AND started_at < now() - interval '90 days';
      DELETE FROM public.tracking_sessions WHERE sale_id IS NULL AND started_at < now() - interval '1 year';
      DELETE FROM public.capi_events
        WHERE (event_name <> 'Purchase' AND created_at < now() - interval '30 days')
           OR created_at < now() - interval '180 days';
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel, expurgo nao agendado (%).', SQLERRM;
END;
$$;
