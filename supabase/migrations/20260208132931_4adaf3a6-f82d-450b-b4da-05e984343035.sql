-- Add api_token column for Guru Digital webhook authentication
-- This is separate from webhook_secret which is the security token
ALTER TABLE checkout_integrations
ADD COLUMN IF NOT EXISTS api_token text;