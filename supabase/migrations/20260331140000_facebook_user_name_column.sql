-- Add facebook_user_name to store the Facebook profile name
-- This allows the UI to display connections grouped by profile
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS facebook_user_name text;

-- Backfill: copy account_name into facebook_user_name where facebook_user_id exists
-- but facebook_user_name is null (best-effort for existing rows)
UPDATE public.facebook_connections
SET facebook_user_name = account_name
WHERE facebook_user_id IS NOT NULL
  AND facebook_user_name IS NULL
  AND account_name IS NOT NULL;
