-- Create table for daily ad spend tracking
CREATE TABLE public.daily_ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  ad_set_id uuid REFERENCES public.ad_sets(id) ON DELETE CASCADE,
  ad_id uuid REFERENCES public.ads(id) ON DELETE CASCADE,
  facebook_campaign_id text,
  facebook_adset_id text,
  facebook_ad_id text,
  date date NOT NULL,
  spend numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  cpc numeric DEFAULT 0,
  cpm numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Constraint for uniqueness: one record per entity per day
  UNIQUE(user_id, facebook_campaign_id, facebook_adset_id, facebook_ad_id, date)
);

-- Indexes for efficient period queries
CREATE INDEX idx_daily_ad_spend_user_date ON public.daily_ad_spend(user_id, date);
CREATE INDEX idx_daily_ad_spend_campaign_date ON public.daily_ad_spend(campaign_id, date);
CREATE INDEX idx_daily_ad_spend_adset_date ON public.daily_ad_spend(ad_set_id, date);
CREATE INDEX idx_daily_ad_spend_ad_date ON public.daily_ad_spend(ad_id, date);

-- Enable Row Level Security
ALTER TABLE public.daily_ad_spend ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own daily spend"
  ON public.daily_ad_spend FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own daily spend"
  ON public.daily_ad_spend FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own daily spend"
  ON public.daily_ad_spend FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own daily spend"
  ON public.daily_ad_spend FOR DELETE 
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all daily spend"
  ON public.daily_ad_spend FOR SELECT 
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_daily_ad_spend_updated_at
  BEFORE UPDATE ON public.daily_ad_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();