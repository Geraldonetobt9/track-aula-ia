-- Drop existing check constraint and recreate with 'guru' included
ALTER TABLE public.checkout_integrations 
DROP CONSTRAINT IF EXISTS checkout_integrations_plataform_check;

ALTER TABLE public.checkout_integrations 
DROP CONSTRAINT IF EXISTS checkout_integrations_platform_check;

-- Add new constraint with all platforms including guru
ALTER TABLE public.checkout_integrations 
ADD CONSTRAINT checkout_integrations_platform_check 
CHECK (platform IN ('hotmart', 'kiwify', 'kirvano', 'guru'));