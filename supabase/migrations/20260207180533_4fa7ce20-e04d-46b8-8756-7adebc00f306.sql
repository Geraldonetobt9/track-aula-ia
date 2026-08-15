-- Add webhook_url column to checkout_integrations if not exists
ALTER TABLE public.checkout_integrations 
ADD COLUMN IF NOT EXISTS webhook_url text;

-- Add comment for clarity
COMMENT ON COLUMN public.checkout_integrations.webhook_url IS 'Auto-generated webhook URL for the checkout platform';