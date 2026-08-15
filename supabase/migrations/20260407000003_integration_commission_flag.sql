-- Add use_commission_value flag to checkout_integrations
-- When true, webhook processors record the producer's net commission instead of the gross sale amount
ALTER TABLE public.checkout_integrations
ADD COLUMN use_commission_value BOOLEAN NOT NULL DEFAULT false;
