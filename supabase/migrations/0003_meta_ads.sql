-- ============================================================
-- 0003 — Meta Ads (token colado + contas de anúncio)
-- ============================================================
-- Mudança em relação ao modelo antigo: não existe mais OAuth de app Facebook e
-- não existe mais uma linha de "conexão" por conta de anúncio repetindo o mesmo
-- token. Agora são duas coisas separadas:
--
--   meta_credentials  -> UM token, colado pelo cliente
--   ad_accounts       -> as contas descobertas a partir desse token
--
-- Conectar = colar o token. O backend chama /me/adaccounts e popula ad_accounts.

-- ------------------------------------------------------------
-- meta_credentials — RLS ligado, ZERO policies: só o backend lê o token.
-- ------------------------------------------------------------
CREATE TABLE public.meta_credentials (
  id                 boolean     PRIMARY KEY DEFAULT true CHECK (id),
  access_token       text        NOT NULL,   -- cifrado com AES-256-GCM pelo backend
  facebook_user_id   text,
  facebook_user_name text,
  token_expires_at   timestamptz,            -- null = token sem expiração declarada
  scopes             text[],
  is_valid           boolean     NOT NULL DEFAULT false,
  last_validated_at  timestamptz,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.meta_credentials.access_token IS
  'Token do Meta cifrado em repouso (AES-256-GCM, chave em ENCRYPTION_KEY). Nunca sai do backend em texto puro.';

CREATE TRIGGER touch_meta_credentials
  BEFORE UPDATE ON public.meta_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- ad_accounts — descobertas automaticamente a partir do token.
-- ------------------------------------------------------------
CREATE TABLE public.ad_accounts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    text        NOT NULL UNIQUE,   -- 'act_1234567890'
  name          text,
  status        integer,                       -- account_status do Graph (1 = ativa)
  currency      text,
  timezone_name text,
  business_name text,
  -- O cliente escolhe quais contas o dashboard sincroniza. Nem toda conta que
  -- o token enxerga interessa.
  is_active     boolean     NOT NULL DEFAULT false,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_accounts_active ON public.ad_accounts (is_active) WHERE is_active = true;

CREATE TRIGGER touch_ad_accounts
  BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- Hierarquia: campanha -> conjunto -> anúncio
-- ------------------------------------------------------------
-- As métricas (spend, clicks, ctr...) saíram destas tabelas. Elas ficam só em
-- ad_insights_daily; agregar por período é uma soma, e duplicar o número em
-- duas tabelas era a principal fonte de divergência no modelo antigo.
CREATE TABLE public.campaigns (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id   uuid        NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  facebook_id     text        NOT NULL UNIQUE,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'archived', 'deleted')),
  objective       text,
  daily_budget    numeric,
  lifetime_budget numeric,
  synced_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_account_status ON public.campaigns (ad_account_id, status);

CREATE TRIGGER touch_campaigns
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ad_sets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  facebook_id     text        NOT NULL UNIQUE,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'archived', 'deleted')),
  daily_budget    numeric,
  lifetime_budget numeric,
  synced_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_sets_campaign ON public.ad_sets (campaign_id, status);

CREATE TRIGGER touch_ad_sets
  BEFORE UPDATE ON public.ad_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ads (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_set_id     uuid        NOT NULL REFERENCES public.ad_sets(id) ON DELETE CASCADE,
  facebook_id   text        NOT NULL UNIQUE,
  name          text        NOT NULL,
  status        text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'archived', 'deleted')),
  thumbnail_url text,
  synced_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ads_ad_set ON public.ads (ad_set_id, status);

CREATE TRIGGER touch_ads
  BEFORE UPDATE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- ad_insights_daily — a ÚNICA fonte de números do Meta.
-- ------------------------------------------------------------
-- Substitui daily_ad_spend. cpc/cpm/ctr saíram: são derivados de spend,
-- clicks e impressions, e guardá-los só criava chance de ficarem inconsistentes.
CREATE TABLE public.ad_insights_daily (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date               date        NOT NULL,
  ad_account_id      uuid        NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  campaign_id        uuid        REFERENCES public.campaigns(id) ON DELETE CASCADE,
  ad_set_id          uuid        REFERENCES public.ad_sets(id)   ON DELETE CASCADE,
  ad_id              uuid        REFERENCES public.ads(id)       ON DELETE CASCADE,
  facebook_ad_id     text        NOT NULL,
  spend              numeric     NOT NULL DEFAULT 0,
  impressions        integer     NOT NULL DEFAULT 0,
  clicks             integer     NOT NULL DEFAULT 0,
  link_clicks        integer     NOT NULL DEFAULT 0,
  landing_page_views integer     NOT NULL DEFAULT 0,
  initiate_checkouts integer     NOT NULL DEFAULT 0,
  conversions        integer     NOT NULL DEFAULT 0,
  purchase_value     numeric     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Alvo do upsert do sincronizador: re-sincronizar um dia sobrescreve, não duplica.
CREATE UNIQUE INDEX idx_insights_day_ad ON public.ad_insights_daily (date, facebook_ad_id);

-- Consulta dominante do dashboard: somar por período.
CREATE INDEX idx_insights_account_date  ON public.ad_insights_daily (ad_account_id, date);
CREATE INDEX idx_insights_campaign_date ON public.ad_insights_daily (campaign_id, date);
CREATE INDEX idx_insights_ad_set_date   ON public.ad_insights_daily (ad_set_id, date);
CREATE INDEX idx_insights_ad_date       ON public.ad_insights_daily (ad_id, date);

-- BRIN: a tabela só cresce em ordem de data, e o índice fica ~10x menor.
CREATE INDEX idx_insights_date_brin ON public.ad_insights_daily USING BRIN (date);

CREATE TRIGGER touch_ad_insights_daily
  BEFORE UPDATE ON public.ad_insights_daily
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
