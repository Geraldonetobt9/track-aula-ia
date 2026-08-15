-- supabase/migrations/20260419100001_create_stripe_webhook_events.sql

CREATE TABLE public.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);

CREATE INDEX idx_stripe_webhook_events_type_time
  ON public.stripe_webhook_events(type, processed_at DESC);

COMMENT ON TABLE public.stripe_webhook_events IS
  'Idempotency guard. Every Stripe webhook stored by event.id so we never reprocess.';

-- Backend-only table. Users never read from this. Enable RLS with no policies
-- so authenticated/anon role has zero access; service role (backend) bypasses RLS.
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
