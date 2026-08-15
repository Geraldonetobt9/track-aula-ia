-- Tabela de Ad Sets (Conjuntos de Anúncios)
CREATE TABLE public.ad_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  facebook_adset_id TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  spend DECIMAL(12, 2) DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cpc DECIMAL(10, 4) DEFAULT 0,
  cpm DECIMAL(10, 4) DEFAULT 0,
  ctr DECIMAL(6, 4) DEFAULT 0,
  date_start DATE,
  date_end DATE,
  synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de Ads (Anúncios)
CREATE TABLE public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ad_set_id UUID REFERENCES public.ad_sets(id) ON DELETE CASCADE NOT NULL,
  facebook_ad_id TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  spend DECIMAL(12, 2) DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cpc DECIMAL(10, 4) DEFAULT 0,
  cpm DECIMAL(10, 4) DEFAULT 0,
  ctr DECIMAL(6, 4) DEFAULT 0,
  date_start DATE,
  date_end DATE,
  synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- RLS Policies para ad_sets
CREATE POLICY "Users can view their own ad sets" ON public.ad_sets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own ad sets" ON public.ad_sets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own ad sets" ON public.ad_sets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own ad sets" ON public.ad_sets FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies para ads
CREATE POLICY "Users can view their own ads" ON public.ads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own ads" ON public.ads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own ads" ON public.ads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own ads" ON public.ads FOR DELETE USING (auth.uid() = user_id);

-- Triggers para updated_at
CREATE TRIGGER update_ad_sets_updated_at
  BEFORE UPDATE ON public.ad_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ads_updated_at
  BEFORE UPDATE ON public.ads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Índices para performance
CREATE INDEX idx_ad_sets_user_id ON public.ad_sets(user_id);
CREATE INDEX idx_ad_sets_campaign_id ON public.ad_sets(campaign_id);
CREATE INDEX idx_ad_sets_facebook_adset_id ON public.ad_sets(facebook_adset_id);
CREATE INDEX idx_ads_user_id ON public.ads(user_id);
CREATE INDEX idx_ads_ad_set_id ON public.ads(ad_set_id);
CREATE INDEX idx_ads_facebook_ad_id ON public.ads(facebook_ad_id);

-- Adicionar campo synced_at na tabela campaigns se não existir
ALTER TABLE public.campaigns 
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;