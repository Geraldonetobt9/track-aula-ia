-- ============================================================
-- 0008 — Estado de sincronização e jobs
-- ============================================================

-- ------------------------------------------------------------
-- sync_state — linha única. Antes era sync_schedules, uma por workspace.
-- ------------------------------------------------------------
CREATE TABLE public.sync_state (
  id                    boolean     PRIMARY KEY DEFAULT true CHECK (id),
  is_active             boolean     NOT NULL DEFAULT true,
  interval_minutes      integer     NOT NULL DEFAULT 30 CHECK (interval_minutes >= 5),
  last_sync_at          timestamptz,
  next_sync_at          timestamptz,
  last_status           text        NOT NULL DEFAULT 'pending'
                          CHECK (last_status IN ('pending', 'running', 'success', 'error')),
  last_error            text,
  last_duration_ms      integer,
  consecutive_errors    integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER touch_sync_state
  BEFORE UPDATE ON public.sync_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.sync_state (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- sync_logs — histórico das sincronizações.
-- ------------------------------------------------------------
CREATE TABLE public.sync_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type       text        NOT NULL DEFAULT 'meta_ads',
  status          text        NOT NULL CHECK (status IN ('running', 'success', 'error')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     integer,
  campaigns_synced integer    NOT NULL DEFAULT 0,
  ad_sets_synced  integer     NOT NULL DEFAULT 0,
  ads_synced      integer     NOT NULL DEFAULT 0,
  insights_synced integer     NOT NULL DEFAULT 0,
  sales_rematched integer     NOT NULL DEFAULT 0,
  error_message   text
);

CREATE INDEX idx_sync_logs_started ON public.sync_logs (started_at DESC);
CREATE INDEX idx_sync_logs_started_brin ON public.sync_logs USING BRIN (started_at);

-- ------------------------------------------------------------
-- processing_jobs — trabalho assíncrono com barra de progresso.
-- ------------------------------------------------------------
-- Usado pela sincronização sob demanda e pela importação de vendas: o request
-- devolve um job_id na hora e a tela faz polling.
CREATE TABLE public.processing_jobs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type   text        NOT NULL DEFAULT 'sync',
  status     text        NOT NULL DEFAULT 'processing'
               CHECK (status IN ('processing', 'done', 'error')),
  progress   integer     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result     jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_processing_jobs_created ON public.processing_jobs (created_at DESC);

CREATE TRIGGER touch_processing_jobs
  BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
