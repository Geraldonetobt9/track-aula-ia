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
