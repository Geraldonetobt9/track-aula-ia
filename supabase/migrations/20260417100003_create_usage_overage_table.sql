-- supabase/migrations/20260417100003_create_usage_overage_table.sql

CREATE TABLE public.usage_overage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  price_cents integer NOT NULL,

  -- Populado por StripeOverageService.sendMeterEvent apos envio bem-sucedido do meter event ao Stripe.
  reported_to_stripe_at   timestamptz,
  stripe_usage_record_id  text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_usage_overage_sale ON public.usage_overage(sale_id);
CREATE INDEX idx_usage_overage_user_period
  ON public.usage_overage(user_id, period_start, period_end);
CREATE INDEX idx_usage_overage_unreported
  ON public.usage_overage(subscription_id)
  WHERE reported_to_stripe_at IS NULL;

ALTER TABLE public.usage_overage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own overage"
  ON public.usage_overage FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.usage_overage IS
  'Uma linha por venda aprovada que excedeu o max_sales_monthly. Base para cobrança via Stripe.';
