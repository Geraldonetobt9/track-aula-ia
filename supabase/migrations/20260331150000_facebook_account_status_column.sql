-- Store the Facebook account_status (1=Active, 2=Disabled, 3=Unsettled, etc.)
-- so the UI can display it without a live API call
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS account_status integer;
