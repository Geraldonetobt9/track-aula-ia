-- Add OAuth-specific columns to facebook_connections
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS facebook_user_id TEXT;

-- Make app_id and app_secret nullable (OAuth flow doesn't use per-user app credentials)
ALTER TABLE public.facebook_connections
  ALTER COLUMN app_id DROP NOT NULL,
  ALTER COLUMN app_secret DROP NOT NULL;

-- Index facebook_user_id for lookups during OAuth callback
-- Note: not using CONCURRENTLY here because Supabase runs migrations inside a transaction
CREATE INDEX IF NOT EXISTS idx_facebook_connections_fb_user_id
  ON public.facebook_connections (facebook_user_id)
  WHERE facebook_user_id IS NOT NULL;

COMMENT ON COLUMN public.facebook_connections.token_expires_at IS 'Expiry of the long-lived OAuth token (60 days from exchange)';
COMMENT ON COLUMN public.facebook_connections.facebook_user_id IS 'Facebook user ID that authorized the token';
