-- Add columns to sales table for Facebook Ads attribution
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS ad_id text,
ADD COLUMN IF NOT EXISTS ad_set_id uuid REFERENCES public.ad_sets(id),
ADD COLUMN IF NOT EXISTS ad_internal_id uuid REFERENCES public.ads(id);

-- Create unique constraint for upsert on webhooks
-- First check if it exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_external_id_user_id_unique'
  ) THEN
    ALTER TABLE public.sales 
    ADD CONSTRAINT sales_external_id_user_id_unique 
    UNIQUE (external_id, user_id);
  END IF;
END $$;

-- Create index for faster matching queries
CREATE INDEX IF NOT EXISTS idx_sales_ad_id ON public.sales(ad_id);
CREATE INDEX IF NOT EXISTS idx_sales_ad_set_id ON public.sales(ad_set_id);
CREATE INDEX IF NOT EXISTS idx_sales_ad_internal_id ON public.sales(ad_internal_id);
CREATE INDEX IF NOT EXISTS idx_sales_campaign_id ON public.sales(campaign_id);