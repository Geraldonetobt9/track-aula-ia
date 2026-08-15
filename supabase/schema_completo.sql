-- ============================================================
-- SCHEMA COMPLETO — Dashboard Anibal
-- ============================================================
-- ARQUIVO GERADO. Nao edite aqui: edite os arquivos de
-- migrations/ e gere de novo com scripts/gerar-schema.sh
--
-- Cole tudo isto no SQL Editor de um projeto Supabase NOVO E VAZIO
-- e execute uma vez so.
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>> 0001_extensions_and_helpers.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- 0001 — Extensões e funções auxiliares
-- ============================================================
-- Roda uma vez, em um projeto Supabase novo e vazio.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Mantém updated_at sempre correto sem depender do código da aplicação.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Extrai o primeiro trecho numérico (>= 6 dígitos) de uma string com | ou /.
-- Usado na atribuição de vendas: o ad_id às vezes chega dentro do utm_content
-- no formato "campanha|conjunto|123456789".
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

-- >>>>>>>>>>>>>>>>>>>> 0002_users_and_settings.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- 0002 — Usuários permitidos e configurações globais
-- ============================================================
-- Não existe cadastro público. As contas são criadas à mão pelo admin, no
-- painel do Supabase (Authentication > Users > Add user), com o signup por
-- e-mail desligado.
--
-- Todos os usuários enxergam os mesmos dados: não há separação por usuário,
-- workspace, plano ou papel. A lista existe para responder uma pergunta só —
-- "esta pessoa pode entrar?".

-- ------------------------------------------------------------
-- app_users — quem tem acesso.
-- ------------------------------------------------------------
CREATE TABLE public.app_users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  name       text,
  -- Desligar aqui tira o acesso na hora, sem apagar a conta no Auth nem perder
  -- o histórico. Apagar do Auth também funciona, mas é irreversível.
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_users_active ON public.app_users (user_id) WHERE is_active = true;

CREATE TRIGGER touch_app_users
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- is_allowed_user() — usada por TODAS as policies de RLS.
-- ------------------------------------------------------------
-- SECURITY DEFINER porque app_users tem RLS: a policy precisa poder ler a
-- tabela sem cair em recursão. STABLE e com auth.uid() dentro de subselect para
-- o Postgres avaliar uma vez por statement, não uma vez por linha.
CREATE OR REPLACE FUNCTION public.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE user_id = (SELECT auth.uid()) AND is_active
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_allowed_user() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_allowed_user() TO authenticated, service_role;

-- ------------------------------------------------------------
-- Toda conta criada pelo admin entra na lista automaticamente.
-- ------------------------------------------------------------
-- Com o signup desligado no painel, a única origem de um INSERT em auth.users é
-- o próprio admin. Então registrar aqui é seguro: quem chegou até este ponto já
-- foi autorizado por quem tem acesso ao painel do Supabase.
--
-- Se o signup for reaberto um dia, esta é a linha a mudar: passe a inserir com
-- is_active = false e libere cada um à mão.
CREATE OR REPLACE FUNCTION public.register_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_users (user_id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.register_new_user();

-- Mantém o e-mail em sincronia quando alguém o troca pelo Supabase Auth.
CREATE OR REPLACE FUNCTION public.sync_user_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_users SET email = NEW.email WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_user_email();

-- ------------------------------------------------------------
-- app_settings — o que antes eram colunas espalhadas em workspaces.
-- ------------------------------------------------------------
-- Linha única, garantida pelo PK booleano com CHECK.
CREATE TABLE public.app_settings (
  id                      boolean     PRIMARY KEY DEFAULT true CHECK (id),
  ad_spend_tax_percentage numeric     NOT NULL DEFAULT 0
                            CHECK (ad_spend_tax_percentage >= 0 AND ad_spend_tax_percentage <= 100),
  timezone                text        NOT NULL DEFAULT 'America/Sao_Paulo',
  currency                text        NOT NULL DEFAULT 'BRL',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER touch_app_settings
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A linha única já nasce criada, para o app nunca precisar tratar "não existe".
INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Não existe uma tabela app_secrets: os únicos segredos do sistema são o token
-- do Meta (em meta_credentials) e os tokens dos checkouts (em checkout_secrets),
-- e os dois já ficam isolados nas suas próprias tabelas sem policy de RLS.

-- >>>>>>>>>>>>>>>>>>>> 0003_meta_ads.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> 0004_checkouts_and_sales.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- 0004 — Integrações de checkout, vendas e fila de webhooks
-- ============================================================

-- ------------------------------------------------------------
-- checkout_integrations — dados NÃO sensíveis, o dashboard pode ler.
-- ------------------------------------------------------------
CREATE TABLE public.checkout_integrations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform             text        NOT NULL CHECK (platform IN (
                         'hotmart', 'kiwify', 'kirvano', 'guru', 'perfectpay', 'ticto',
                         'payt', 'cakto', 'hubla', 'cartpanda', 'ggcheckout', 'lastlink',
                         'eduzz', 'mundpay', 'monetizze', 'greenn'
                       )),
  name                 text        NOT NULL,
  is_active            boolean     NOT NULL DEFAULT true,
  -- Algumas plataformas mandam o valor bruto e a comissão do produtor separados.
  -- Quando ligado, a venda registra a comissão em vez do valor cheio.
  use_commission_value boolean     NOT NULL DEFAULT false,
  last_webhook_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkout_integrations_active
  ON public.checkout_integrations (is_active) WHERE is_active = true;

CREATE TRIGGER touch_checkout_integrations
  BEFORE UPDATE ON public.checkout_integrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- checkout_secrets — tabela separada, RLS sem policies.
-- ------------------------------------------------------------
-- No modelo antigo o webhook_secret e o api_token ficavam na mesma linha da
-- integração, e a tela precisava de uma função mask_secret() para não vazá-los.
-- Separando em outra tabela sem policy nenhuma, o segredo simplesmente não é
-- alcançável pela chave anon — não há o que mascarar.
CREATE TABLE public.checkout_secrets (
  integration_id uuid        PRIMARY KEY
                   REFERENCES public.checkout_integrations(id) ON DELETE CASCADE,
  webhook_secret text,        -- validação HMAC/assinatura do webhook recebido
  api_token      text,        -- cifrado com AES-256-GCM pelo backend
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_checkout_secrets_webhook_secret
  ON public.checkout_secrets (webhook_secret)
  WHERE webhook_secret IS NOT NULL;

CREATE TRIGGER touch_checkout_secrets
  BEFORE UPDATE ON public.checkout_secrets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- sales
-- ------------------------------------------------------------
-- Saíram: user_id, workspace_id e blocked_by_limit (esta última existia só para
-- cortar vendas acima do limite do plano — não há mais plano).
CREATE TABLE public.sales (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_integration_id uuid        REFERENCES public.checkout_integrations(id) ON DELETE SET NULL,
  external_id             text,       -- id da venda na plataforma de origem
  -- Atribuição: preenchida pelo matcher a partir das UTMs / ad_id.
  campaign_id             uuid        REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ad_set_id               uuid        REFERENCES public.ad_sets(id)   ON DELETE SET NULL,
  ad_internal_id          uuid        REFERENCES public.ads(id)       ON DELETE SET NULL,
  facebook_ad_id          text,       -- id cru vindo da UTM, antes de resolver
  -- Cliente
  customer_name           text,
  customer_email          text,
  customer_phone          text,
  customer_doc            text,
  customer_city           text,
  customer_state          text,
  customer_country        text        DEFAULT 'BR',
  -- Venda
  product_name            text,
  amount                  numeric     NOT NULL,
  currency                text        NOT NULL DEFAULT 'BRL',
  status                  text        NOT NULL DEFAULT 'approved'
                            CHECK (status IN ('pending', 'approved', 'refunded', 'chargeback')),
  payment_method          text,
  source                  text        NOT NULL DEFAULT 'webhook'
                            CHECK (source IN ('webhook', 'import', 'manual')),
  -- UTMs
  utm_source              text,
  utm_medium              text,
  utm_campaign            text,
  utm_content             text,
  utm_term                text,
  metadata                jsonb,
  sold_at                 timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Idempotência do webhook: a mesma venda reenviada não duplica.
CREATE UNIQUE INDEX idx_sales_external
  ON public.sales (checkout_integration_id, external_id)
  WHERE external_id IS NOT NULL;

-- Consulta dominante: período + status.
CREATE INDEX idx_sales_sold_at        ON public.sales (sold_at DESC);
CREATE INDEX idx_sales_status_sold_at ON public.sales (status, sold_at DESC);

-- Parcial: o dashboard só soma vendas aprovadas.
CREATE INDEX idx_sales_approved
  ON public.sales (sold_at DESC) WHERE status = 'approved';

CREATE INDEX idx_sales_campaign       ON public.sales (campaign_id)    WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_sales_ad_internal    ON public.sales (ad_internal_id) WHERE ad_internal_id IS NOT NULL;
CREATE INDEX idx_sales_checkout       ON public.sales (checkout_integration_id);
CREATE INDEX idx_sales_product        ON public.sales (product_name);
CREATE INDEX idx_sales_state          ON public.sales (customer_state) WHERE customer_state IS NOT NULL;
CREATE INDEX idx_sales_sold_at_brin   ON public.sales USING BRIN (sold_at);

CREATE TRIGGER touch_sales
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- webhook_queue — o webhook responde 200 na hora, processa depois.
-- ------------------------------------------------------------
CREATE TABLE public.webhook_queue (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      text        NOT NULL,
  payload       jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts      integer     NOT NULL DEFAULT 0,
  max_attempts  integer     NOT NULL DEFAULT 3,
  error_message text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Índice do worker: pega o próximo lote pendente e vencido.
CREATE INDEX idx_webhook_queue_pending
  ON public.webhook_queue (next_retry_at)
  WHERE status = 'pending';

CREATE INDEX idx_webhook_queue_created_brin
  ON public.webhook_queue USING BRIN (created_at);

-- >>>>>>>>>>>>>>>>>>>> 0005_financial.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- 0005 — Financeiro
-- ============================================================

-- ------------------------------------------------------------
-- company_costs — custos recorrentes aplicados sobre o faturamento.
-- ------------------------------------------------------------
-- 'percentage' incide sobre a receita do período; 'fixed' é um valor mensal.
CREATE TABLE public.company_costs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  type       text        NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value      numeric     NOT NULL CHECK (value >= 0),
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_costs_active
  ON public.company_costs (is_active) WHERE is_active = true;

CREATE TRIGGER touch_company_costs
  BEFORE UPDATE ON public.company_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- financial_entries — lançamentos manuais por mês de referência.
-- ------------------------------------------------------------
-- 'tax' é um imposto em valor, digitado à mão, e convive com o percentual sobre
-- ads que fica em app_settings.ad_spend_tax_percentage: um incide sobre o gasto
-- de mídia, o outro é subtraído do lucro por conta própria.
CREATE TABLE public.financial_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text        NOT NULL CHECK (type IN ('expense', 'revenue', 'tax')),
  name            text        NOT NULL,
  amount          numeric     NOT NULL DEFAULT 0,
  reference_month date        NOT NULL,   -- sempre o dia 1 do mês
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_entries_month_type
  ON public.financial_entries (reference_month, type);

CREATE TRIGGER touch_financial_entries
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- >>>>>>>>>>>>>>>>>>>> 0006_automation_rules.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- 0006 — Regras de automação
-- ============================================================
-- Avaliam métricas de um período e agem sobre campanha/conjunto/anúncio
-- (pausar, ativar, mexer no orçamento).

CREATE TABLE public.automation_rules (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  is_active         boolean     NOT NULL DEFAULT false,
  -- Antes apontava para uma "conexão"; agora, para a conta de anúncio.
  -- NULL = a regra vale para todas as contas ativas.
  ad_account_id     uuid        REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  target_entity     text        NOT NULL CHECK (target_entity IN ('campaign', 'adset', 'ad')),
  target_status     text        NOT NULL CHECK (target_status IN ('active', 'paused', 'any')),
  name_filter       text,       -- filtro opcional por trecho do nome
  action_type       text        NOT NULL CHECK (action_type IN
                        ('activate', 'pause', 'increase_budget', 'decrease_budget')),
  budget_adjustment jsonb,      -- { "type": "percent" | "fixed", "value": number }
  evaluation_period text        NOT NULL CHECK (evaluation_period IN
                        ('today', 'yesterday', 'last_7d', 'last_30d', 'custom')),
  custom_start_date date,       -- usado quando evaluation_period = 'custom'
  frequency_minutes integer     NOT NULL CHECK (frequency_minutes IN
                        (10, 15, 30, 60, 120, 180, 360, 1440)),
  daily_run_time    time,       -- horário fixo, para regras diárias
  last_executed_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Índice do agendador: quais regras estão vencidas agora.
CREATE INDEX idx_automation_rules_due
  ON public.automation_rules (last_executed_at)
  WHERE is_active = true;

CREATE TRIGGER touch_automation_rules
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Condições em AND: todas precisam bater para a ação disparar.
CREATE TABLE public.automation_rule_conditions (
  id       uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id  uuid    NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  metric   text    NOT NULL CHECK (metric IN (
             'spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin',
             'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions'
           )),
  operator text    NOT NULL CHECK (operator IN ('gt', 'lt', 'gte', 'lte')),
  value    numeric NOT NULL
);

CREATE INDEX idx_rule_conditions_rule ON public.automation_rule_conditions (rule_id);

-- Histórico. Append-only: é o que a tela de histórico mostra.
CREATE TABLE public.automation_rule_executions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id            uuid        NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  entity_facebook_id text        NOT NULL,
  entity_name        text,
  action_taken       text        NOT NULL,
  metrics_snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status             text        NOT NULL CHECK (status IN ('success', 'error')),
  error_message      text,
  executed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rule_executions_rule_date
  ON public.automation_rule_executions (rule_id, executed_at DESC);

CREATE INDEX idx_rule_executions_date_brin
  ON public.automation_rule_executions USING BRIN (executed_at);

-- >>>>>>>>>>>>>>>>>>>> 0008_sync_and_jobs.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> 0009_rpc_aggregations.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- 0009 — Agregações server-side (RPC)
-- ============================================================
-- Cada tela puxa tudo o que precisa em uma ida só ao banco. Isso existe por dois
-- motivos: somar 50 mil vendas no Postgres é mais rápido do que trazer as linhas
-- e somar em JS, e o PostgREST corta o resultado em 1000 linhas por padrão —
-- somar no Node dava número errado silenciosamente quando passava disso.
--
-- Estas funções não recebem mais p_user_id nem p_workspace_id: só existe um dono
-- e uma base. Elas são concedidas apenas ao service_role, ou seja, só o backend
-- executa. Nem a chave anon nem o usuário logado conseguem chamá-las direto.

-- ------------------------------------------------------------
-- dashboard_metrics — tela inicial.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  p_from          timestamptz DEFAULT NULL,
  p_to            timestamptz DEFAULT NULL,
  p_checkout_ids  uuid[]      DEFAULT NULL,
  p_product_names text[]      DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_gross    numeric := 0;
  v_count    int     := 0;
  v_lifetime numeric := 0;
  v_ad_spend numeric := 0;
  v_chart    jsonb   := '[]'::jsonb;
  v_regions  jsonb   := '[]'::jsonb;
  v_recent   jsonb   := '[]'::jsonb;
BEGIN
  -- Faturamento e quantidade no período (só aprovadas).
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO v_gross, v_count
  FROM public.sales
  WHERE status = 'approved'
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to   IS NULL OR sold_at <  p_to)
    AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names));

  -- Acumulado de todos os tempos: ignora os filtros de propósito, alimenta a
  -- barra de meta.
  SELECT COALESCE(SUM(amount), 0)
  INTO v_lifetime
  FROM public.sales
  WHERE status = 'approved';

  -- Gasto com Meta Ads no período, para o ROI da tela.
  SELECT COALESCE(SUM(i.spend), 0)
  INTO v_ad_spend
  FROM public.ad_insights_daily i
  WHERE (p_from IS NULL OR i.date >= p_from::date)
    AND (p_to   IS NULL OR i.date <  p_to::date);

  -- Série do gráfico: receita por dia.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', r) ORDER BY d), '[]'::jsonb)
  INTO v_chart
  FROM (
    SELECT to_char(sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, SUM(amount) AS r
    FROM public.sales
    WHERE status = 'approved'
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to   IS NULL OR sold_at <  p_to)
      AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY d
  ) c;

  -- Distribuição por estado. O percentual é calculado na tela.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'state', state, 'sales', sales_count, 'revenue', revenue
         ) ORDER BY sales_count DESC), '[]'::jsonb)
  INTO v_regions
  FROM (
    SELECT customer_state AS state, COUNT(*) AS sales_count, SUM(amount) AS revenue
    FROM public.sales
    WHERE status = 'approved'
      AND customer_state IS NOT NULL AND customer_state <> ''
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to   IS NULL OR sold_at <  p_to)
      AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY customer_state
  ) r;

  -- Últimas vendas.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'product_name', product_name, 'sold_at', sold_at, 'amount', amount
         ) ORDER BY sold_at DESC, id DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT id, product_name, sold_at, amount
    FROM public.sales
    WHERE status = 'approved'
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to   IS NULL OR sold_at <  p_to)
      AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    ORDER BY sold_at DESC, id DESC
    LIMIT 9
  ) rs;

  RETURN jsonb_build_object(
    'gross_revenue',    v_gross,
    'sales_count',      v_count,
    'lifetime_revenue', v_lifetime,
    'ad_spend',         v_ad_spend,
    'chart_data',       v_chart,
    'regions',          v_regions,
    'recent_sales',     v_recent
  );
END;
$$;

-- ------------------------------------------------------------
-- sales_grouped_by_ad — atribuição de vendas por anúncio.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_grouped_by_ad(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  ad_id            text,
  approved_count   int,
  approved_revenue numeric,
  refunded_count   int,
  refunded_revenue numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH extracted AS (
    SELECT
      COALESCE(
        public.extract_numeric_ad_id(s.facebook_ad_id),
        public.extract_numeric_ad_id(s.utm_term),
        public.extract_numeric_ad_id(s.utm_content)
      ) AS extracted_ad_id,
      s.status,
      s.amount
    FROM public.sales s
    WHERE s.status IN ('approved', 'refunded')
      AND (s.facebook_ad_id IS NOT NULL OR s.utm_content IS NOT NULL OR s.utm_term IS NOT NULL)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to   IS NULL OR s.sold_at <  p_to)
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

-- ------------------------------------------------------------
-- sales_summary — tela de vendas inteira em uma chamada.
-- ------------------------------------------------------------
-- A chave de agrupamento de "Vendas por Anúncio" é, nesta ordem:
--   utm_content (a UTM do clique) -> nome do anúncio -> id cru -> 'Sem anúncio'.
-- Nome de conjunto e de campanha NÃO entram como fallback: o card é por anúncio.
CREATE OR REPLACE FUNCTION public.sales_summary(
  p_from          timestamptz DEFAULT NULL,
  p_to            timestamptz DEFAULT NULL,
  p_statuses      text[]      DEFAULT NULL,
  p_checkout_ids  uuid[]      DEFAULT NULL,
  p_product_names text[]      DEFAULT NULL,
  p_campaign_ids  uuid[]      DEFAULT NULL,
  p_q             text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_q_pattern       text := CASE WHEN p_q IS NULL OR length(trim(p_q)) = 0
                                 THEN NULL ELSE '%' || trim(p_q) || '%' END;
  v_approved_count  int     := 0;
  v_gross_revenue   numeric := 0;
  v_avg_ticket      numeric := 0;
  v_refunds_count   int     := 0;
  v_total_count     int     := 0;
  v_refund_rate     numeric := 0;
  v_by_product      jsonb   := '[]'::jsonb;
  v_by_ad           jsonb   := '[]'::jsonb;
  v_refunds_by_state jsonb  := '[]'::jsonb;
  v_refunded_sample jsonb   := '[]'::jsonb;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_approved_count, v_gross_revenue
  FROM public.sales
  WHERE status = 'approved'
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to   IS NULL OR sold_at <  p_to)
    AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids  IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (v_q_pattern IS NULL
         OR customer_email ILIKE v_q_pattern
         OR customer_name  ILIKE v_q_pattern
         OR product_name   ILIKE v_q_pattern);

  SELECT COUNT(*)
  INTO v_refunds_count
  FROM public.sales
  WHERE status = 'refunded'
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to   IS NULL OR sold_at <  p_to)
    AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids  IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (v_q_pattern IS NULL
         OR customer_email ILIKE v_q_pattern
         OR customer_name  ILIKE v_q_pattern
         OR product_name   ILIKE v_q_pattern);

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
      'count',        COUNT(*),
      'revenue',      COALESCE(SUM(amount), 0)
    ) AS row
    FROM public.sales
    WHERE status = 'approved'
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to   IS NULL OR sold_at <  p_to)
      AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids  IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (v_q_pattern IS NULL
           OR customer_email ILIKE v_q_pattern
           OR customer_name  ILIKE v_q_pattern
           OR product_name   ILIKE v_q_pattern)
    GROUP BY product_name
    ORDER BY SUM(amount) DESC NULLS LAST
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_ad
  FROM (
    SELECT jsonb_build_object(
      'name',    COALESCE(NULLIF(TRIM(s.utm_content), ''), a.name,
                          NULLIF(s.facebook_ad_id, ''), 'Sem anúncio'),
      'count',   COUNT(*),
      'revenue', COALESCE(SUM(s.amount), 0)
    ) AS row
    FROM public.sales s
    LEFT JOIN public.ads a ON s.ad_internal_id = a.id
    WHERE s.status = 'approved'
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to   IS NULL OR s.sold_at <  p_to)
      AND (p_checkout_ids  IS NULL OR s.checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR s.product_name = ANY(p_product_names))
      AND (p_campaign_ids  IS NULL OR s.campaign_id = ANY(p_campaign_ids))
      AND (v_q_pattern IS NULL
           OR s.customer_email ILIKE v_q_pattern
           OR s.customer_name  ILIKE v_q_pattern
           OR s.product_name   ILIKE v_q_pattern)
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
    WHERE status = 'refunded'
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to   IS NULL OR sold_at <  p_to)
      AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids  IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (v_q_pattern IS NULL
           OR customer_email ILIKE v_q_pattern
           OR customer_name  ILIKE v_q_pattern
           OR product_name   ILIKE v_q_pattern)
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 3
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunded_sample
  FROM (
    SELECT jsonb_build_object(
      'customer_name',  customer_name,
      'customer_state', customer_state,
      'amount',         amount
    ) AS row
    FROM public.sales
    WHERE status = 'refunded'
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to   IS NULL OR sold_at <  p_to)
      AND (p_checkout_ids  IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids  IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (v_q_pattern IS NULL
           OR customer_email ILIKE v_q_pattern
           OR customer_name  ILIKE v_q_pattern
           OR product_name   ILIKE v_q_pattern)
    ORDER BY sold_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object(
    'metrics', jsonb_build_object(
      'approved_count', v_approved_count,
      'gross_revenue',  v_gross_revenue,
      'avg_ticket',     v_avg_ticket,
      'refunds_count',  v_refunds_count,
      'refund_rate',    v_refund_rate
    ),
    'by_product',       v_by_product,
    'by_ad',            v_by_ad,
    'refunds_by_state', v_refunds_by_state,
    'refunded_sample',  v_refunded_sample
  );
END;
$$;

-- ------------------------------------------------------------
-- Permissões
-- ------------------------------------------------------------
-- Só o backend (service_role) executa. O frontend passa pela API, nunca chama
-- estas funções direto com a chave anon.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.dashboard_metrics(timestamptz, timestamptz, uuid[], text[])',
    'public.sales_grouped_by_ad(timestamptz, timestamptz)',
    'public.sales_summary(timestamptz, timestamptz, text[], uuid[], text[], uuid[], text)',
    'public.extract_numeric_ad_id(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

-- >>>>>>>>>>>>>>>>>>>> 0010_rls_policies.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- 0010 — Row Level Security
-- ============================================================
-- O modelo é simples e fechado:
--
--   1. RLS ligado em TODAS as tabelas, sem exceção.
--   2. O usuário logado (role `authenticated`) tem SOMENTE LEITURA, e só se
--      estiver na lista de permitidos — is_allowed_user(). Toda escrita passa
--      pelo backend, que usa a service_role e valida o token antes.
--   3. Tabelas de segredo (tokens, chaves de webhook, fila de webhook) ficam com
--      RLS ligado e NENHUMA policy. Sem policy, ninguém passa: nem a chave anon,
--      nem o usuário logado. Só a service_role, que ignora RLS por definição.
--
-- Por que leitura direta e escrita pela API: as telas leem muita coisa e o
-- PostgREST faz isso bem; escrita precisa de validação, atribuição e chamada ao
-- Meta, que é trabalho de backend. Deixar o frontend escrever direto no banco
-- seria dar poder que ele não precisa ter.

-- ------------------------------------------------------------
-- 1. Liga RLS em tudo
-- ------------------------------------------------------------
ALTER TABLE public.app_users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_credentials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_accounts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_sets                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_insights_daily          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_integrations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_secrets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_queue              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_costs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs            ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. Leitura para os usuários permitidos
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_users', 'app_settings', 'ad_accounts', 'campaigns', 'ad_sets', 'ads',
    'ad_insights_daily', 'checkout_integrations', 'sales', 'company_costs',
    'financial_entries', 'automation_rules', 'automation_rule_conditions',
    'automation_rule_executions', 'sync_state', 'sync_logs',
    'processing_jobs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY user_read ON public.%I FOR SELECT TO authenticated USING (public.is_allowed_user())',
      t
    );
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 3. Tabelas de segredo: RLS ligado, nenhuma policy, grants removidos
-- ------------------------------------------------------------
-- O REVOKE é redundante em relação ao RLS (sem policy já bloqueia), mas custa
-- nada e protege contra alguém criar uma policy aqui sem pensar depois.
REVOKE ALL ON public.meta_credentials FROM anon, authenticated;
REVOKE ALL ON public.checkout_secrets FROM anon, authenticated;
REVOKE ALL ON public.webhook_queue    FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4. Escrita: nunca pela chave anon
-- ------------------------------------------------------------
-- Sem policies de INSERT/UPDATE/DELETE, qualquer escrita vinda do browser é
-- rejeitada pelo RLS. O backend usa a service_role e não é afetado.
--
-- Se um dia alguma tela precisar escrever direto, a policy correta é:
--
--   CREATE POLICY user_write ON public.<tabela>
--     FOR ALL TO authenticated
--     USING (public.is_allowed_user()) WITH CHECK (public.is_allowed_user());
--
-- Nunca use USING (true): isso libera a tabela para qualquer usuário
-- autenticado que venha a existir no projeto.

-- ------------------------------------------------------------
-- 5. Trava de novas tabelas
-- ------------------------------------------------------------
-- Event trigger: toda tabela nova em `public` já nasce com RLS ligado. Evita o
-- erro clássico de criar uma tabela, esquecer o ALTER e deixá-la aberta.
CREATE OR REPLACE FUNCTION public.force_rls_on_new_tables()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
             WHERE command_tag = 'CREATE TABLE' AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
  END LOOP;
END;
$$;

-- Event trigger exige superusuário, e dependendo do plano o papel `postgres` do
-- Supabase não tem esse direito. Se não der, a migration continua: é uma rede de
-- proteção, não um requisito. O aviso fica no log para você saber que não pegou.
DO $$
BEGIN
  CREATE EVENT TRIGGER force_rls
    ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE')
    EXECUTE FUNCTION public.force_rls_on_new_tables();
EXCEPTION
  WHEN insufficient_privilege OR duplicate_object THEN
    RAISE NOTICE 'Event trigger force_rls não criado (%). Ligue RLS à mão em tabelas novas.', SQLERRM;
END;
$$;
