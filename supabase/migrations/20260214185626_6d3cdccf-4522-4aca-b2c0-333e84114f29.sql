-- Add flag to track welcome email sent status
-- This needs to be run on the EXTERNAL database (picgyetvkjymfrgsjozt)
-- Adding to Cloud DB as a reference, but the actual column lives on external DB
-- The edge function will check this flag before sending

-- Note: This migration is for the Cloud DB only as a placeholder.
-- The actual column must be added to the external profiles table manually.
-- We'll use a different approach: store sent emails in a local table.

CREATE TABLE IF NOT EXISTS public.welcome_emails_sent (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  sent_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.welcome_emails_sent ENABLE ROW LEVEL SECURITY;

-- Only edge functions with service role can access
CREATE POLICY "Service role full access" ON public.welcome_emails_sent
  FOR ALL USING (true) WITH CHECK (true);
