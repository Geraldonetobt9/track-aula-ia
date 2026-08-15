-- Add funnel metrics columns to daily_ad_spend table
ALTER TABLE public.daily_ad_spend
ADD COLUMN IF NOT EXISTS link_clicks integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS landing_page_views integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS initiate_checkouts integer DEFAULT 0;