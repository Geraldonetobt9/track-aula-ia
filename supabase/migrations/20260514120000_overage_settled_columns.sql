-- supabase/migrations/20260514120000_overage_settled_columns.sql
--
-- Adiciona colunas pra marcar overage rows que foram liquidadas (settled)
-- dentro de uma invoice avulsa no momento de upgrade de plano.
--
-- Contexto: quando o usuário faz upgrade no meio do ciclo, o sistema cobra
-- o overage acumulado sob a regra do NOVO plano (limite e preço novos)
-- como linha extra na invoice da diff. As rows de usage_overage do ciclo
-- atual são marcadas com settled_by_invoice_id pra que:
--   1. O reconciliation cron não tente re-disparar meter events delas.
--   2. Tenhamos paper trail histórico (qual invoice resolveu cada row).

ALTER TABLE public.usage_overage
  ADD COLUMN IF NOT EXISTS settled_at            timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_invoice_id text;

COMMENT ON COLUMN public.usage_overage.settled_at IS
  'Timestamp em que a row foi liquidada via invoice extra no upgrade. NULL para rows ainda no fluxo normal de meter events.';
COMMENT ON COLUMN public.usage_overage.settled_by_invoice_id IS
  'Stripe Invoice ID (in_xxx) que cobrou esta overage row. Set junto com settled_at.';

-- Index parcial pra o cron filtrar rapidamente as pendentes.
CREATE INDEX IF NOT EXISTS idx_usage_overage_unsettled_unreported
  ON public.usage_overage (id)
  WHERE reported_to_stripe_at IS NULL AND settled_at IS NULL;
