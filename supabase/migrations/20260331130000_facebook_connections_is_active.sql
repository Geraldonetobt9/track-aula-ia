-- Add is_active column so users can toggle which ad accounts are tracked
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- Add account_name to store the human-readable name from Facebook
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS account_name TEXT;

-- Index for quickly fetching active connections
CREATE INDEX IF NOT EXISTS idx_facebook_connections_user_active
  ON public.facebook_connections (user_id, is_active)
  WHERE is_active = true;

COMMENT ON COLUMN public.facebook_connections.is_active IS 'Whether this ad account is actively tracked for metrics/campaigns';
COMMENT ON COLUMN public.facebook_connections.account_name IS 'Human-readable name of the ad account from Facebook';
