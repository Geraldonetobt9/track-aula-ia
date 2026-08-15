-- supabase/migrations/20260417100001_create_subscriptions_table.sql

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plan_rules(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','trialing','past_due','canceled','paused')),
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,

  -- Preenchido lazy no 1o upgrade (customer.subscription.created webhook via StripeWebhookService).
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text UNIQUE,

  -- Espelha downgrade agendado no Customer Portal Stripe (populado por customer.subscription.updated).
  scheduled_plan_id    uuid REFERENCES public.plan_rules(id),
  scheduled_changes_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_period_end ON public.subscriptions(current_period_end);
CREATE INDEX idx_subscriptions_scheduled_changes
  ON public.subscriptions(scheduled_changes_at)
  WHERE scheduled_changes_at IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.subscriptions IS
  'Fonte de verdade do plano/ciclo de cada usuário. Preparada para integração com Stripe.';
