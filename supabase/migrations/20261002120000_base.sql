-- ============================================================
-- BASE — o banco inteiro do painel, até 2026-10-02
-- ============================================================
-- Consolida as 97 migrations de 2026-02 a 2026-10-02 num arquivo só, na
-- ordem e com os ajustes que o banco novo precisa (o que era o
-- schema_completo.sql nessa data). As migrations originais continuam no
-- histórico do git.
--
-- Mudanças novas no banco: crie uma migration com data depois desta, em
-- supabase/migrations/, e rode node scripts/gerar-schema.js. Não edite este
-- arquivo para mudar o banco: quem já tem o painel no ar não o roda de novo.
--
-- Os comentários ">>>>>>>>>> arquivo.sql <<<<<<<<<<" marcam de qual
-- migration original veio cada trecho.
-- ============================================================

-- PULADA: 20260401000002_phase1_backfill_workspace_id.sql
--   backfill de dados: no-op em banco vazio, e usa CREATE TEMP, que nao sobrevive ao pooler

-- >>>>>>>>>>>>>>>>>>>> 20260207164829_f7bd9234-bc6b-4818-acbd-80f95e1e9aee.sql <<<<<<<<<<<<<<<<<<<<

-- Create facebook_connections table for storing developer app credentials
CREATE TABLE public.facebook_connections (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    app_id TEXT NOT NULL,
    app_secret TEXT NOT NULL,
    access_token TEXT NOT NULL,
    ad_account_id TEXT NOT NULL,
    is_valid BOOLEAN DEFAULT false,
    last_validated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

-- Enable Row Level Security
ALTER TABLE public.facebook_connections ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own facebook connection" 
ON public.facebook_connections 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own facebook connection" 
ON public.facebook_connections 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own facebook connection" 
ON public.facebook_connections 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own facebook connection" 
ON public.facebook_connections 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_facebook_connections_updated_at
BEFORE UPDATE ON public.facebook_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- >>>>>>>>>>>>>>>>>>>> 20260207170422_f6e24644-d458-40ec-a50e-ec3f8b28ca0c.sql <<<<<<<<<<<<<<<<<<<<

-- 1. Create app_role enum for role-based access control
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'enterprise')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 4. Create checkout_integrations table for webhook configurations
CREATE TABLE public.checkout_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('hotmart', 'kiwify', 'kirvano', 'other')),
  webhook_secret TEXT,
  is_active BOOLEAN DEFAULT true,
  last_webhook_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 5. Create campaigns table for Facebook Ads campaigns
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  facebook_campaign_id TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  objective TEXT,
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

-- 6. Create sales table for checkout transactions
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  checkout_integration_id UUID REFERENCES public.checkout_integrations(id) ON DELETE SET NULL,
  external_id TEXT,
  customer_email TEXT,
  customer_name TEXT,
  product_name TEXT,
  amount DECIMAL(12, 2) NOT NULL,
  currency TEXT DEFAULT 'BRL',
  status TEXT DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'refunded', 'chargeback')),
  payment_method TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  sold_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 7. Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- 8. Create security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 9. Create function to handle new user signup (auto-create profile)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

-- 10. Create trigger for auto-creating profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 11. RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- 12. RLS Policies for user_roles (read-only for users, admin can manage)
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- 13. RLS Policies for checkout_integrations
CREATE POLICY "Users can view their own checkout integrations"
  ON public.checkout_integrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own checkout integrations"
  ON public.checkout_integrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own checkout integrations"
  ON public.checkout_integrations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own checkout integrations"
  ON public.checkout_integrations FOR DELETE
  USING (auth.uid() = user_id);

-- 14. RLS Policies for campaigns
CREATE POLICY "Users can view their own campaigns"
  ON public.campaigns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own campaigns"
  ON public.campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns"
  ON public.campaigns FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns"
  ON public.campaigns FOR DELETE
  USING (auth.uid() = user_id);

-- 15. RLS Policies for sales
CREATE POLICY "Users can view their own sales"
  ON public.sales FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sales"
  ON public.sales FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sales"
  ON public.sales FOR UPDATE
  USING (auth.uid() = user_id);

-- 16. Create updated_at triggers
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_checkout_integrations_updated_at
  BEFORE UPDATE ON public.checkout_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 17. Create indexes for performance
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_checkout_integrations_user_id ON public.checkout_integrations(user_id);
CREATE INDEX idx_campaigns_user_id ON public.campaigns(user_id);
CREATE INDEX idx_campaigns_facebook_id ON public.campaigns(facebook_campaign_id);
CREATE INDEX idx_sales_user_id ON public.sales(user_id);
CREATE INDEX idx_sales_campaign_id ON public.sales(campaign_id);
CREATE INDEX idx_sales_sold_at ON public.sales(sold_at);

-- >>>>>>>>>>>>>>>>>>>> 20260207173134_a9a2220c-cd0f-4958-9d61-436a12bc156f.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> 20260207180533_4fa7ce20-e04d-46b8-8756-7adebc00f306.sql <<<<<<<<<<<<<<<<<<<<

-- Add webhook_url column to checkout_integrations if not exists
ALTER TABLE public.checkout_integrations 
ADD COLUMN IF NOT EXISTS webhook_url text;

-- Add comment for clarity
COMMENT ON COLUMN public.checkout_integrations.webhook_url IS 'Auto-generated webhook URL for the checkout platform';

-- >>>>>>>>>>>>>>>>>>>> 20260207183016_1cf7060e-bfcd-432c-ace8-adff4779d377.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> 20260207185008_f1aa4473-5376-4dcc-a912-ed37ad6c648b.sql <<<<<<<<<<<<<<<<<<<<

-- Create sync_schedules table for managing automatic sync scheduling
CREATE TABLE public.sync_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sync_type text NOT NULL DEFAULT 'facebook_ads',
  interval_minutes integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  last_sync_status text DEFAULT 'pending',
  last_sync_error text,
  last_sync_duration_ms integer,
  synced_campaigns integer DEFAULT 0,
  synced_ad_sets integer DEFAULT 0,
  synced_ads integer DEFAULT 0,
  consecutive_errors integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sync_type)
);

-- Create sync_logs table for detailed sync history
CREATE TABLE public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sync_schedule_id uuid REFERENCES public.sync_schedules(id) ON DELETE SET NULL,
  sync_type text NOT NULL DEFAULT 'facebook_ads',
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  campaigns_synced integer DEFAULT 0,
  ad_sets_synced integer DEFAULT 0,
  ads_synced integer DEFAULT 0,
  sales_rematched integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.sync_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for sync_schedules
CREATE POLICY "Users can view their own sync schedules"
  ON public.sync_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own sync schedules"
  ON public.sync_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sync schedules"
  ON public.sync_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sync schedules"
  ON public.sync_schedules FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for sync_logs
CREATE POLICY "Users can view their own sync logs"
  ON public.sync_logs FOR SELECT USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_sync_logs_created_at ON public.sync_logs(created_at);
CREATE INDEX idx_sync_logs_user_id ON public.sync_logs(user_id, created_at DESC);
CREATE INDEX idx_sync_schedules_next_sync ON public.sync_schedules(next_sync_at) WHERE is_active = true;

-- Trigger for updated_at on sync_schedules
CREATE TRIGGER update_sync_schedules_updated_at
  BEFORE UPDATE ON public.sync_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- >>>>>>>>>>>>>>>>>>>> 20260207192039_bd13ed10-225a-44df-a658-4209025e0cae.sql <<<<<<<<<<<<<<<<<<<<

-- Add admin RLS policies for viewing all data

-- sync_schedules: admin can view all
CREATE POLICY "Admins can view all sync schedules"
  ON sync_schedules FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- sync_logs: admin can view all  
CREATE POLICY "Admins can view all sync logs"
  ON sync_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- sales: admin can view all
CREATE POLICY "Admins can view all sales"
  ON sales FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- campaigns: admin can view all
CREATE POLICY "Admins can view all campaigns"
  ON campaigns FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ad_sets: admin can view all
CREATE POLICY "Admins can view all ad sets"
  ON ad_sets FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ads: admin can view all
CREATE POLICY "Admins can view all ads"
  ON ads FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- checkout_integrations: admin can view all
CREATE POLICY "Admins can view all checkout integrations"
  ON checkout_integrations FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- facebook_connections: admin can view all (tokens will be filtered in Edge Function)
CREATE POLICY "Admins can view all facebook connections"
  ON facebook_connections FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- >>>>>>>>>>>>>>>>>>>> 20260207204139_fc82ebea-beaf-44a7-8e54-29a655b008bb.sql <<<<<<<<<<<<<<<<<<<<

-- Add new columns to sales table for Guru Digital and enhanced tracking
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS customer_phone text,
ADD COLUMN IF NOT EXISTS customer_doc text,
ADD COLUMN IF NOT EXISTS checkout_source text,
ADD COLUMN IF NOT EXISTS metadata jsonb;

-- >>>>>>>>>>>>>>>>>>>> 20260207204753_8d742354-5f43-41b7-8191-4f92057f6e64.sql <<<<<<<<<<<<<<<<<<<<

-- Drop existing check constraint and recreate with 'guru' included
ALTER TABLE public.checkout_integrations 
DROP CONSTRAINT IF EXISTS checkout_integrations_plataform_check;

ALTER TABLE public.checkout_integrations 
DROP CONSTRAINT IF EXISTS checkout_integrations_platform_check;

-- Add new constraint with all platforms including guru
ALTER TABLE public.checkout_integrations 
ADD CONSTRAINT checkout_integrations_platform_check 
CHECK (platform IN ('hotmart', 'kiwify', 'kirvano', 'guru'));

-- >>>>>>>>>>>>>>>>>>>> 20260207210827_3d47201c-2e1f-48eb-98c4-21e37f5b7e8f.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> 20260207212314_94fcbbe0-1415-4972-8c31-4c0233f630eb.sql <<<<<<<<<<<<<<<<<<<<

-- Fix unique constraint to handle NULLs correctly using COALESCE
-- Drop the existing constraint if it exists
ALTER TABLE daily_ad_spend DROP CONSTRAINT IF EXISTS daily_ad_spend_user_id_facebook_campaign_id_facebook_adset__key;

-- Drop any existing unique index
DROP INDEX IF EXISTS idx_daily_ad_spend_unique;
DROP INDEX IF EXISTS daily_ad_spend_user_id_facebook_campaign_id_facebook_adset__key;

-- Create unique index that treats NULLs correctly
CREATE UNIQUE INDEX idx_daily_ad_spend_unique 
ON daily_ad_spend (
  user_id, 
  COALESCE(facebook_campaign_id, ''), 
  COALESCE(facebook_adset_id, ''), 
  COALESCE(facebook_ad_id, ''), 
  date
);

-- >>>>>>>>>>>>>>>>>>>> 20260208130254_5dfe4f76-3668-4afc-a62e-741c30f6df46.sql <<<<<<<<<<<<<<<<<<<<

-- Create processing_jobs table for background job tracking
CREATE TABLE public.processing_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'sync',
  status TEXT NOT NULL DEFAULT 'processing',
  progress INTEGER DEFAULT 0,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

-- Users can view their own jobs
CREATE POLICY "Users can view their own jobs" 
ON public.processing_jobs 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users can insert their own jobs
CREATE POLICY "Users can insert their own jobs" 
ON public.processing_jobs 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for edge functions)
CREATE POLICY "Service role full access" 
ON public.processing_jobs 
FOR ALL 
USING (auth.role() = 'service_role');

-- Add index for faster lookups
CREATE INDEX idx_processing_jobs_user_status ON public.processing_jobs(user_id, status);

-- Trigger for updated_at
CREATE TRIGGER update_processing_jobs_updated_at
BEFORE UPDATE ON public.processing_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- >>>>>>>>>>>>>>>>>>>> 20260208132931_4adaf3a6-f82d-450b-b4da-05e984343035.sql <<<<<<<<<<<<<<<<<<<<

-- Add api_token column for Guru Digital webhook authentication
-- This is separate from webhook_secret which is the security token
ALTER TABLE checkout_integrations
ADD COLUMN IF NOT EXISTS api_token text;

-- >>>>>>>>>>>>>>>>>>>> 20260208143126_bfc5a7f1-cc8c-4ddf-b4fe-e28ae833e0d4.sql <<<<<<<<<<<<<<<<<<<<

-- Add budget columns to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS daily_budget numeric;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS lifetime_budget numeric;

-- Add budget columns to ad_sets table
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS daily_budget numeric;
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS lifetime_budget numeric;

-- Add comments for documentation
COMMENT ON COLUMN campaigns.daily_budget IS 'Daily budget in BRL (converted from cents)';
COMMENT ON COLUMN campaigns.lifetime_budget IS 'Lifetime budget in BRL (converted from cents)';
COMMENT ON COLUMN ad_sets.daily_budget IS 'Daily budget in BRL (converted from cents)';
COMMENT ON COLUMN ad_sets.lifetime_budget IS 'Lifetime budget in BRL (converted from cents)';

-- >>>>>>>>>>>>>>>>>>>> 20260208182137_3046036f-4178-442d-95b2-101a7eb28fea.sql <<<<<<<<<<<<<<<<<<<<

-- Add funnel metrics columns to daily_ad_spend table
ALTER TABLE public.daily_ad_spend
ADD COLUMN IF NOT EXISTS link_clicks integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS landing_page_views integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS initiate_checkouts integer DEFAULT 0;

-- >>>>>>>>>>>>>>>>>>>> 20260211105642_4c8e4a20-9714-4d94-bf37-d2ab14a84738.sql <<<<<<<<<<<<<<<<<<<<


CREATE TABLE public.company_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.company_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own costs"
ON public.company_costs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own costs"
ON public.company_costs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own costs"
ON public.company_costs FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own costs"
ON public.company_costs FOR UPDATE
USING (auth.uid() = user_id);


-- >>>>>>>>>>>>>>>>>>>> 20260211131205_0f8aa0ed-5ead-48b0-9be2-820164d5278b.sql <<<<<<<<<<<<<<<<<<<<

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 20260214142955_d0a2e033-ee68-4ebb-ae52-2aa8f3ab378f.sql <<<<<<<<<<<<<<<<<<<<


-- Create plan_rules table
CREATE TABLE public.plan_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan TEXT NOT NULL UNIQUE,
  max_campaigns INTEGER NOT NULL DEFAULT -1,
  max_sales INTEGER NOT NULL DEFAULT -1,
  max_checkout_integrations INTEGER NOT NULL DEFAULT 1,
  max_ad_accounts INTEGER NOT NULL DEFAULT 1,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  feature_sales_globe BOOLEAN NOT NULL DEFAULT false,
  feature_advanced_reports BOOLEAN NOT NULL DEFAULT false,
  feature_conversion_funnel BOOLEAN NOT NULL DEFAULT false,
  feature_auto_sync BOOLEAN NOT NULL DEFAULT false,
  feature_api_access BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.plan_rules ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read plan rules
CREATE POLICY "Authenticated users can read plan rules"
ON public.plan_rules FOR SELECT
USING (auth.role() = 'authenticated');

-- Only admins can modify (via service role or edge functions)
CREATE POLICY "Service role can manage plan rules"
ON public.plan_rules FOR ALL
USING (auth.jwt() ->> 'role' = 'admin');

-- Insert all plans
INSERT INTO public.plan_rules (plan, max_campaigns, max_sales, max_checkout_integrations, max_ad_accounts, sync_interval_minutes, feature_sales_globe, feature_advanced_reports, feature_conversion_funnel, feature_auto_sync, feature_api_access) VALUES
  ('free', -1, 50, 1, 1, 60, true, true, true, true, false),
  ('starter', -1, 500, 1, 1, 30, true, true, true, true, false),
  ('pro', -1, 1500, 3, 1, 15, true, true, true, true, false),
  ('enterprise', -1, 5000, 5, 1, 10, true, true, true, true, false),
  ('ilimited', -1, -1, -1, -1, 5, true, true, true, true, true);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_plan_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_plan_rules_updated_at
BEFORE UPDATE ON public.plan_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_plan_rules_updated_at();


-- >>>>>>>>>>>>>>>>>>>> 20260214185626_6d3cdccf-4522-4aca-b2c0-333e84114f29.sql <<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>> 20260216142953_8a29d9f1-390f-4aa9-a6fe-da4aacd88704.sql <<<<<<<<<<<<<<<<<<<<


-- Create workspaces table
CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own workspaces"
  ON public.workspaces FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workspaces"
  ON public.workspaces FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workspaces"
  ON public.workspaces FOR DELETE
  USING (auth.uid() = user_id);

-- Mapping: workspace <-> facebook_connection (external IDs stored as text)
CREATE TABLE public.workspace_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  facebook_connection_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, facebook_connection_id)
);

ALTER TABLE public.workspace_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace connections via workspace ownership"
  ON public.workspace_connections FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid())
  );

-- Mapping: workspace <-> checkout_integration (external IDs stored as text)
CREATE TABLE public.workspace_checkout_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  checkout_integration_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, checkout_integration_id)
);

ALTER TABLE public.workspace_checkout_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace checkout integrations via workspace ownership"
  ON public.workspace_checkout_integrations FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid())
  );

-- Add max_workspaces to plan_rules
ALTER TABLE public.plan_rules ADD COLUMN max_workspaces INTEGER NOT NULL DEFAULT 1;

-- Trigger for updated_at on workspaces
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.update_plan_rules_updated_at();


-- >>>>>>>>>>>>>>>>>>>> 20260311153232_c0b0a860-1156-4e33-97cb-d9e48a831dd5.sql <<<<<<<<<<<<<<<<<<<<

CREATE TABLE public.workspace_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, product_name)
);

ALTER TABLE public.workspace_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace products via workspace ownership"
  ON public.workspace_products
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE workspaces.id = workspace_products.workspace_id
      AND workspaces.user_id = auth.uid()
  ));

-- >>>>>>>>>>>>>>>>>>>> 20260314161731_25fd6193-4389-4939-a513-d59a5f68302d.sql <<<<<<<<<<<<<<<<<<<<

CREATE TABLE public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('expense', 'revenue')),
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  reference_month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage financial entries via workspace ownership"
  ON public.financial_entries FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE workspaces.id = financial_entries.workspace_id
      AND workspaces.user_id = auth.uid()
  ));

-- >>>>>>>>>>>>>>>>>>>> 20260314162943_dc4575c4-84f6-4667-9da2-8abf10cdb270.sql <<<<<<<<<<<<<<<<<<<<


DROP POLICY "Users manage financial entries via workspace ownership" ON public.financial_entries;

CREATE POLICY "Users can select financial entries" ON public.financial_entries
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM workspaces
  WHERE workspaces.id = financial_entries.workspace_id
  AND workspaces.user_id = auth.uid()
));

CREATE POLICY "Users can insert financial entries" ON public.financial_entries
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM workspaces
    WHERE workspaces.id = financial_entries.workspace_id
    AND workspaces.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete financial entries" ON public.financial_entries
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM workspaces
  WHERE workspaces.id = financial_entries.workspace_id
  AND workspaces.user_id = auth.uid()
));


-- >>>>>>>>>>>>>>>>>>>> 20260314164547_51a3aec7-d047-4719-9a79-7ec40384f453.sql <<<<<<<<<<<<<<<<<<<<

CREATE POLICY "Users can update financial entries"
ON public.financial_entries
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspaces
    WHERE workspaces.id = financial_entries.workspace_id
    AND workspaces.user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM workspaces
    WHERE workspaces.id = financial_entries.workspace_id
    AND workspaces.user_id = auth.uid()
  )
);

-- >>>>>>>>>>>>>>>>>>>> 20260317151605_0759ad15-d5d2-4541-b453-7ec24a37c3c0.sql <<<<<<<<<<<<<<<<<<<<


-- Create webhook queue table for async processing
CREATE TABLE public.webhook_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for efficient polling
CREATE INDEX idx_webhook_queue_pending ON public.webhook_queue (status, next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_webhook_queue_created ON public.webhook_queue (created_at);

-- Enable RLS
ALTER TABLE public.webhook_queue ENABLE ROW LEVEL SECURITY;

-- Only service role can access (edge functions use service role)
-- No public policies needed since this is internal infrastructure


-- >>>>>>>>>>>>>>>>>>>> 20260317151748_01387a93-8ec8-40a5-a750-181c8a30cee8.sql <<<<<<<<<<<<<<<<<<<<


-- Enable required extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- >>>>>>>>>>>>>>>>>>>> 20260330110000_schema_drift_backfill.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Desvio de schema: colunas que existem no banco mas em nenhuma migration
-- ============================================================
-- O banco original acumulou colunas criadas fora do controle de versão —
-- pelo painel do Supabase, provavelmente. O resultado é que replayar as
-- migrations num banco vazio NÃO reproduz o schema real: migrations
-- posteriores referenciam colunas que nenhuma delas cria, e a aplicação
-- quebra com "column ... does not exist".
--
-- Foi assim que apareceu o erro 42703 em campaigns.facebook_connection_id.
--
-- Este arquivo fecha o buraco. As colunas vêm do dump real (SQL_DATABASE.md),
-- e ele roda antes da primeira migration que as usa (20260330120000).
--
-- Cada bloco checa se a tabela existe. Sem isso, a ordem entre este arquivo e
-- a criação de cada tabela viraria uma dependência frágil, e um ALTER numa
-- tabela ainda inexistente derrubaria o script inteiro.

DO $$
BEGIN
  -- ----------------------------------------------------------
  -- Vínculo com a conexão do Facebook, na hierarquia e nas métricas
  -- ----------------------------------------------------------
  IF to_regclass('public.campaigns') IS NOT NULL THEN
    ALTER TABLE public.campaigns
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid;
  END IF;

  IF to_regclass('public.ad_sets') IS NOT NULL THEN
    ALTER TABLE public.ad_sets
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid;
  END IF;

  IF to_regclass('public.ads') IS NOT NULL THEN
    ALTER TABLE public.ads
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid;
  END IF;

  IF to_regclass('public.daily_ad_spend') IS NOT NULL THEN
    ALTER TABLE public.daily_ad_spend
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid,
      ADD COLUMN IF NOT EXISTS purchase_value numeric DEFAULT 0;
  END IF;

  -- ----------------------------------------------------------
  -- Credenciais de app do Facebook
  -- ----------------------------------------------------------
  -- A migration de simplificação derruba as duas no fim. Elas existem aqui
  -- porque migrations intermediárias as referenciam.
  IF to_regclass('public.facebook_connections') IS NOT NULL THEN
    ALTER TABLE public.facebook_connections
      ADD COLUMN IF NOT EXISTS app_id text,
      ADD COLUMN IF NOT EXISTS app_secret text;
  END IF;

  -- ----------------------------------------------------------
  -- Localização do cliente, usada no mapa de vendas por região
  -- ----------------------------------------------------------
  IF to_regclass('public.sales') IS NOT NULL THEN
    ALTER TABLE public.sales
      ADD COLUMN IF NOT EXISTS customer_state   text,
      ADD COLUMN IF NOT EXISTS customer_city    text,
      ADD COLUMN IF NOT EXISTS customer_country text DEFAULT 'BR';
  END IF;

  -- ----------------------------------------------------------
  -- Perfil
  -- ----------------------------------------------------------
  -- cpf e active seguem em uso; as duas de assinatura são derrubadas depois,
  -- junto com a cobrança.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS cpf                text,
      ADD COLUMN IF NOT EXISTS active             boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS subscription_start date,
      ADD COLUMN IF NOT EXISTS subscription_end   date;
  END IF;

END;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260330120000_consolidate_cloud_tables.sql <<<<<<<<<<<<<<<<<<<<

-- Migration: Add workspace, financial, and configuration tables
-- Adds tables for workspaces, financial entries, plan rules, company costs,
-- welcome emails, and webhook queue to the main project.

-- ============================================================
-- 1. workspaces
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON public.workspaces (user_id);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspaces"
  ON public.workspaces FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workspaces"
  ON public.workspaces FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own workspaces"
  ON public.workspaces FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all workspaces"
  ON public.workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

CREATE POLICY "Admins can manage all workspaces"
  ON public.workspaces FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

-- ============================================================
-- 2. workspace_connections
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  facebook_connection_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, facebook_connection_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_connections_workspace_id ON public.workspace_connections (workspace_id);

ALTER TABLE public.workspace_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspace connections"
  ON public.workspace_connections FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can insert own workspace connections"
  ON public.workspace_connections FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can update own workspace connections"
  ON public.workspace_connections FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can delete own workspace connections"
  ON public.workspace_connections FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Admins can manage all workspace connections"
  ON public.workspace_connections FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

-- ============================================================
-- 3. workspace_checkout_integrations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_checkout_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  checkout_integration_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, checkout_integration_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_checkout_integrations_workspace_id ON public.workspace_checkout_integrations (workspace_id);

ALTER TABLE public.workspace_checkout_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspace checkout integrations"
  ON public.workspace_checkout_integrations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can insert own workspace checkout integrations"
  ON public.workspace_checkout_integrations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can update own workspace checkout integrations"
  ON public.workspace_checkout_integrations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can delete own workspace checkout integrations"
  ON public.workspace_checkout_integrations FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Admins can manage all workspace checkout integrations"
  ON public.workspace_checkout_integrations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

-- ============================================================
-- 4. workspace_products
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, product_name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_products_workspace_id ON public.workspace_products (workspace_id);

ALTER TABLE public.workspace_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspace products"
  ON public.workspace_products FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can insert own workspace products"
  ON public.workspace_products FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can update own workspace products"
  ON public.workspace_products FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Users can delete own workspace products"
  ON public.workspace_products FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces WHERE workspaces.id = workspace_id AND workspaces.user_id = auth.uid()));

CREATE POLICY "Admins can manage all workspace products"
  ON public.workspace_products FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

-- ============================================================
-- 5. financial_entries
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  workspace_id UUID REFERENCES public.workspaces (id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('expense', 'revenue')),
  name TEXT NOT NULL,
  amount NUMERIC DEFAULT 0,
  reference_month DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_user_id ON public.financial_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_id ON public.financial_entries (workspace_id);
CREATE INDEX IF NOT EXISTS idx_financial_entries_reference_month ON public.financial_entries (reference_month);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own financial entries"
  ON public.financial_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own financial entries"
  ON public.financial_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own financial entries"
  ON public.financial_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own financial entries"
  ON public.financial_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all financial entries"
  ON public.financial_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

-- ============================================================
-- 6. plan_rules — table already exists, add max_workspaces column
-- ============================================================
ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS max_workspaces INT DEFAULT 1;

-- Update existing rows with sensible defaults for max_workspaces
UPDATE public.plan_rules SET max_workspaces = 1 WHERE plan = 'free' AND max_workspaces IS NULL;
UPDATE public.plan_rules SET max_workspaces = 2 WHERE plan = 'starter' AND max_workspaces IS NULL;
UPDATE public.plan_rules SET max_workspaces = 5 WHERE plan = 'pro' AND max_workspaces IS NULL;
UPDATE public.plan_rules SET max_workspaces = -1 WHERE plan = 'enterprise' AND max_workspaces IS NULL;
UPDATE public.plan_rules SET max_workspaces = -1 WHERE plan = 'unlimited' AND max_workspaces IS NULL;

-- Ensure RLS policies exist (safe to run — will error silently if they already exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plan_rules' AND policyname = 'Anyone can read plan rules') THEN
    CREATE POLICY "Anyone can read plan rules"
      ON public.plan_rules FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plan_rules' AND policyname = 'Admins can manage plan rules') THEN
    CREATE POLICY "Admins can manage plan rules"
      ON public.plan_rules FOR ALL
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));
  END IF;
END $$;

-- ============================================================
-- 7. company_costs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('percentage', 'fixed')),
  value NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_costs_user_id ON public.company_costs (user_id);

ALTER TABLE public.company_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company costs"
  ON public.company_costs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own company costs"
  ON public.company_costs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own company costs"
  ON public.company_costs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own company costs"
  ON public.company_costs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all company costs"
  ON public.company_costs FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

-- ============================================================
-- 8. welcome_emails_sent
-- ============================================================
CREATE TABLE IF NOT EXISTS public.welcome_emails_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.welcome_emails_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view welcome emails sent"
  ON public.welcome_emails_sent FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

CREATE POLICY "Admins can manage welcome emails sent"
  ON public.welcome_emails_sent FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

-- ============================================================
-- 9. webhook_queue
-- ============================================================
CREATE TABLE IF NOT EXISTS public.webhook_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_queue_status ON public.webhook_queue (status);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_next_retry_at ON public.webhook_queue (next_retry_at);

ALTER TABLE public.webhook_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook queue"
  ON public.webhook_queue FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

CREATE POLICY "Admins can manage webhook queue"
  ON public.webhook_queue FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));


-- >>>>>>>>>>>>>>>>>>>> 20260330130000_profile_plan_id_fk.sql <<<<<<<<<<<<<<<<<<<<

-- Adiciona coluna plan_id na tabela profiles como FK para plan_rules.id
-- Substitui a coluna textual "plan" por uma referência por ID

-- 1. Adicionar a coluna plan_id
ALTER TABLE public.profiles
  ADD COLUMN plan_id uuid;

-- 2. Preencher plan_id com base no valor textual atual
UPDATE public.profiles p
SET plan_id = pr.id
FROM public.plan_rules pr
WHERE p.plan = pr.plan;

-- 3. Para profiles cujo plano não existe em plan_rules, vincular ao 'starter' (default atual)
UPDATE public.profiles p
SET plan_id = (SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1)
WHERE p.plan_id IS NULL;

-- 4. Tornar a coluna NOT NULL e adicionar a FK
ALTER TABLE public.profiles
  ALTER COLUMN plan_id SET NOT NULL,
  ADD CONSTRAINT profiles_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plan_rules(id);

-- 4b. Criar função helper para o default e usar como default da coluna
CREATE OR REPLACE FUNCTION public.default_starter_plan_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1; $$;

ALTER TABLE public.profiles
  ALTER COLUMN plan_id SET DEFAULT public.default_starter_plan_id();

-- 5. Remover a coluna textual plan e o CHECK constraint
ALTER TABLE public.profiles
  DROP COLUMN plan;

-- 6. Atualizar trigger handle_new_user para incluir plan_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, name, plan_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    (SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1)
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  RETURN NEW;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260330140000_performance_indexes.sql <<<<<<<<<<<<<<<<<<<<

-- Performance indexes for common query patterns
-- Note: CONCURRENTLY removed because Supabase migrations run inside a transaction.
-- For large production tables, run these manually with CONCURRENTLY outside a transaction.

-- Dashboard and sales page: filter by user + date
CREATE INDEX IF NOT EXISTS idx_sales_user_sold_at
  ON public.sales(user_id, sold_at DESC);

-- Daily ad spend: filter by user + date
CREATE INDEX IF NOT EXISTS idx_daily_ad_spend_user_date_desc
  ON public.daily_ad_spend(user_id, date DESC);

-- Profile FK join on plan_id
CREATE INDEX IF NOT EXISTS idx_profiles_plan_id
  ON public.profiles(plan_id);

-- BRIN indexes for append-only timestamp columns (10x smaller than B-tree)

-- Drop existing B-tree on webhook_queue.created_at if exists, replace with BRIN
DROP INDEX IF EXISTS idx_webhook_queue_created;
CREATE INDEX IF NOT EXISTS idx_webhook_queue_created_brin
  ON public.webhook_queue USING brin(created_at);

-- BRIN on sync_logs.created_at
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_brin
  ON public.sync_logs USING brin(created_at);


-- >>>>>>>>>>>>>>>>>>>> 20260330150000_rls_performance_hardening.sql <<<<<<<<<<<<<<<<<<<<

-- Migration: RLS Performance Hardening
-- Rewrites ALL RLS policies to follow Supabase performance best practices:
--   1. Cache auth.uid() via (SELECT auth.uid()) — 95% faster per Supabase benchmarks
--   2. Cache has_role() calls — 99.99% faster per Supabase benchmarks
--   3. Cache EXISTS subqueries — prevents per-row evaluation
--   4. Use TO authenticated instead of TO public — skips evaluation for anon requests
--   5. Reverse workspace joins — filter by user first, then check membership
--   6. Remove 8 redundant policies (SELECT covered by ALL, duplicate reads)
--   7. Remove useless service_role policy on processing_jobs

-- ============================================================
-- ad_sets
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own ad sets" ON public.ad_sets;
DROP POLICY IF EXISTS "Admins can view all ad sets" ON public.ad_sets;
DROP POLICY IF EXISTS "Users can create their own ad sets" ON public.ad_sets;
DROP POLICY IF EXISTS "Users can update their own ad sets" ON public.ad_sets;
DROP POLICY IF EXISTS "Users can delete their own ad sets" ON public.ad_sets;

CREATE POLICY "Users can view their own ad sets" ON public.ad_sets
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all ad sets" ON public.ad_sets
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can create their own ad sets" ON public.ad_sets
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own ad sets" ON public.ad_sets
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own ad sets" ON public.ad_sets
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- ads
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own ads" ON public.ads;
DROP POLICY IF EXISTS "Admins can view all ads" ON public.ads;
DROP POLICY IF EXISTS "Users can create their own ads" ON public.ads;
DROP POLICY IF EXISTS "Users can update their own ads" ON public.ads;
DROP POLICY IF EXISTS "Users can delete their own ads" ON public.ads;

CREATE POLICY "Users can view their own ads" ON public.ads
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all ads" ON public.ads
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can create their own ads" ON public.ads
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own ads" ON public.ads
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own ads" ON public.ads
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- campaigns
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Admins can view all campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Users can create their own campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Users can update their own campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Users can delete their own campaigns" ON public.campaigns;

CREATE POLICY "Users can view their own campaigns" ON public.campaigns
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all campaigns" ON public.campaigns
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can create their own campaigns" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own campaigns" ON public.campaigns
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own campaigns" ON public.campaigns
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- checkout_integrations
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own checkout integrations" ON public.checkout_integrations;
DROP POLICY IF EXISTS "Admins can view all checkout integrations" ON public.checkout_integrations;
DROP POLICY IF EXISTS "Users can create their own checkout integrations" ON public.checkout_integrations;
DROP POLICY IF EXISTS "Users can update their own checkout integrations" ON public.checkout_integrations;
DROP POLICY IF EXISTS "Users can delete their own checkout integrations" ON public.checkout_integrations;

CREATE POLICY "Users can view their own checkout integrations" ON public.checkout_integrations
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all checkout integrations" ON public.checkout_integrations
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can create their own checkout integrations" ON public.checkout_integrations
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own checkout integrations" ON public.checkout_integrations
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own checkout integrations" ON public.checkout_integrations
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- company_costs
-- ============================================================
DROP POLICY IF EXISTS "Users can view own company costs" ON public.company_costs;
DROP POLICY IF EXISTS "Users can insert own company costs" ON public.company_costs;
DROP POLICY IF EXISTS "Users can update own company costs" ON public.company_costs;
DROP POLICY IF EXISTS "Users can delete own company costs" ON public.company_costs;
DROP POLICY IF EXISTS "Admins can manage all company costs" ON public.company_costs;

CREATE POLICY "Users can view own company costs" ON public.company_costs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own company costs" ON public.company_costs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own company costs" ON public.company_costs
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own company costs" ON public.company_costs
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can manage all company costs" ON public.company_costs
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- daily_ad_spend
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own daily spend" ON public.daily_ad_spend;
DROP POLICY IF EXISTS "Admins can view all daily spend" ON public.daily_ad_spend;
DROP POLICY IF EXISTS "Users can insert their own daily spend" ON public.daily_ad_spend;
DROP POLICY IF EXISTS "Users can update their own daily spend" ON public.daily_ad_spend;
DROP POLICY IF EXISTS "Users can delete their own daily spend" ON public.daily_ad_spend;

CREATE POLICY "Users can view their own daily spend" ON public.daily_ad_spend
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all daily spend" ON public.daily_ad_spend
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can insert their own daily spend" ON public.daily_ad_spend
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own daily spend" ON public.daily_ad_spend
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own daily spend" ON public.daily_ad_spend
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- facebook_connections
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own facebook connection" ON public.facebook_connections;
DROP POLICY IF EXISTS "Admins can view all facebook connections" ON public.facebook_connections;
DROP POLICY IF EXISTS "Users can create their own facebook connection" ON public.facebook_connections;
DROP POLICY IF EXISTS "Users can update their own facebook connection" ON public.facebook_connections;
DROP POLICY IF EXISTS "Users can delete their own facebook connection" ON public.facebook_connections;

CREATE POLICY "Users can view their own facebook connection" ON public.facebook_connections
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all facebook connections" ON public.facebook_connections
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can create their own facebook connection" ON public.facebook_connections
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own facebook connection" ON public.facebook_connections
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own facebook connection" ON public.facebook_connections
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- financial_entries
-- ============================================================
DROP POLICY IF EXISTS "Users can view own financial entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Users can insert own financial entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Users can update own financial entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Users can delete own financial entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Admins can manage all financial entries" ON public.financial_entries;

CREATE POLICY "Users can view own financial entries" ON public.financial_entries
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own financial entries" ON public.financial_entries
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own financial entries" ON public.financial_entries
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own financial entries" ON public.financial_entries
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can manage all financial entries" ON public.financial_entries
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- plan_rules
-- Remove redundant policies, keep only what's needed
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read plan rules" ON public.plan_rules;
DROP POLICY IF EXISTS "Authenticated users can read plan rules" ON public.plan_rules;
DROP POLICY IF EXISTS "Admins can insert plan rules" ON public.plan_rules;
DROP POLICY IF EXISTS "Admins can update plan rules" ON public.plan_rules;
DROP POLICY IF EXISTS "Admins can delete plan rules" ON public.plan_rules;
DROP POLICY IF EXISTS "Admins can manage plan rules" ON public.plan_rules;

CREATE POLICY "Anyone can read plan rules" ON public.plan_rules
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Admins can manage plan rules" ON public.plan_rules
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- processing_jobs
-- Remove useless service_role policy (service_role bypasses RLS entirely)
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Users can insert their own jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Service role full access" ON public.processing_jobs;

CREATE POLICY "Users can view their own jobs" ON public.processing_jobs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert their own jobs" ON public.processing_jobs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================
-- profiles
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- sales
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own sales" ON public.sales;
DROP POLICY IF EXISTS "Admins can view all sales" ON public.sales;
DROP POLICY IF EXISTS "Users can create their own sales" ON public.sales;
DROP POLICY IF EXISTS "Users can update their own sales" ON public.sales;

CREATE POLICY "Users can view their own sales" ON public.sales
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all sales" ON public.sales
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can create their own sales" ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own sales" ON public.sales
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- sync_logs
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own sync logs" ON public.sync_logs;
DROP POLICY IF EXISTS "Admins can view all sync logs" ON public.sync_logs;

CREATE POLICY "Users can view their own sync logs" ON public.sync_logs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all sync logs" ON public.sync_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- sync_schedules
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own sync schedules" ON public.sync_schedules;
DROP POLICY IF EXISTS "Admins can view all sync schedules" ON public.sync_schedules;
DROP POLICY IF EXISTS "Users can insert their own sync schedules" ON public.sync_schedules;
DROP POLICY IF EXISTS "Users can update their own sync schedules" ON public.sync_schedules;
DROP POLICY IF EXISTS "Users can delete their own sync schedules" ON public.sync_schedules;

CREATE POLICY "Users can view their own sync schedules" ON public.sync_schedules
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all sync schedules" ON public.sync_schedules
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can insert their own sync schedules" ON public.sync_schedules
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own sync schedules" ON public.sync_schedules
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own sync schedules" ON public.sync_schedules
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- user_roles
-- Remove redundant "view all" (already covered by ALL policy)
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- webhook_queue (admin-only table, no user_id)
-- Remove redundant SELECT (covered by ALL)
-- ============================================================
DROP POLICY IF EXISTS "Admins can view webhook queue" ON public.webhook_queue;
DROP POLICY IF EXISTS "Admins can manage webhook queue" ON public.webhook_queue;

CREATE POLICY "Admins can manage webhook queue" ON public.webhook_queue
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- welcome_emails_sent (admin-only table)
-- Remove redundant SELECT (covered by ALL)
-- ============================================================
DROP POLICY IF EXISTS "Admins can view welcome emails sent" ON public.welcome_emails_sent;
DROP POLICY IF EXISTS "Admins can manage welcome emails sent" ON public.welcome_emails_sent;

CREATE POLICY "Admins can manage welcome emails sent" ON public.welcome_emails_sent
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- workspace_checkout_integrations
-- Reverse join: filter user's workspaces first, then check membership
-- ============================================================
DROP POLICY IF EXISTS "Users can view own workspace checkout integrations" ON public.workspace_checkout_integrations;
DROP POLICY IF EXISTS "Users can insert own workspace checkout integrations" ON public.workspace_checkout_integrations;
DROP POLICY IF EXISTS "Users can update own workspace checkout integrations" ON public.workspace_checkout_integrations;
DROP POLICY IF EXISTS "Users can delete own workspace checkout integrations" ON public.workspace_checkout_integrations;
DROP POLICY IF EXISTS "Admins can manage all workspace checkout integrations" ON public.workspace_checkout_integrations;

CREATE POLICY "Users can view own workspace checkout integrations" ON public.workspace_checkout_integrations
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can insert own workspace checkout integrations" ON public.workspace_checkout_integrations
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can update own workspace checkout integrations" ON public.workspace_checkout_integrations
  FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can delete own workspace checkout integrations" ON public.workspace_checkout_integrations
  FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Admins can manage all workspace checkout integrations" ON public.workspace_checkout_integrations
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- workspace_connections
-- ============================================================
DROP POLICY IF EXISTS "Users can view own workspace connections" ON public.workspace_connections;
DROP POLICY IF EXISTS "Users can insert own workspace connections" ON public.workspace_connections;
DROP POLICY IF EXISTS "Users can update own workspace connections" ON public.workspace_connections;
DROP POLICY IF EXISTS "Users can delete own workspace connections" ON public.workspace_connections;
DROP POLICY IF EXISTS "Admins can manage all workspace connections" ON public.workspace_connections;

CREATE POLICY "Users can view own workspace connections" ON public.workspace_connections
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can insert own workspace connections" ON public.workspace_connections
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can update own workspace connections" ON public.workspace_connections
  FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can delete own workspace connections" ON public.workspace_connections
  FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Admins can manage all workspace connections" ON public.workspace_connections
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- workspace_products
-- ============================================================
DROP POLICY IF EXISTS "Users can view own workspace products" ON public.workspace_products;
DROP POLICY IF EXISTS "Users can insert own workspace products" ON public.workspace_products;
DROP POLICY IF EXISTS "Users can update own workspace products" ON public.workspace_products;
DROP POLICY IF EXISTS "Users can delete own workspace products" ON public.workspace_products;
DROP POLICY IF EXISTS "Admins can manage all workspace products" ON public.workspace_products;

CREATE POLICY "Users can view own workspace products" ON public.workspace_products
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can insert own workspace products" ON public.workspace_products
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can update own workspace products" ON public.workspace_products
  FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Users can delete own workspace products" ON public.workspace_products
  FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Admins can manage all workspace products" ON public.workspace_products
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ============================================================
-- workspaces
-- Remove redundant "view all" (covered by ALL)
-- ============================================================
DROP POLICY IF EXISTS "Users can view own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can update own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can delete own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Admins can view all workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Admins can manage all workspaces" ON public.workspaces;

CREATE POLICY "Users can view own workspaces" ON public.workspaces
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own workspaces" ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own workspaces" ON public.workspaces
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own workspaces" ON public.workspaces
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can manage all workspaces" ON public.workspaces
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));


-- >>>>>>>>>>>>>>>>>>>> 20260330160000_missing_indexes_and_brin.sql <<<<<<<<<<<<<<<<<<<<

-- Migration: Missing Indexes & BRIN Conversions
-- Adds indexes for RLS-referenced columns and query patterns found in codebase.
-- Converts B-tree to BRIN on append-only tables (10x smaller).
-- Note: CONCURRENTLY cannot be used inside Supabase migrations (transaction block).
-- For large production tables, run these manually with CONCURRENTLY outside a transaction.

-- ============================================================
-- Missing indexes for columns used in RLS or frequent queries
-- ============================================================

-- facebook_connections: RLS filters by user_id but no index exists
CREATE INDEX IF NOT EXISTS idx_facebook_connections_user_id
  ON public.facebook_connections USING btree (user_id);

-- daily_ad_spend: sync queries filter by facebook_connection_id
CREATE INDEX IF NOT EXISTS idx_daily_ad_spend_connection_id
  ON public.daily_ad_spend USING btree (facebook_connection_id);

-- ============================================================
-- Partial indexes for frequently filtered subsets
-- ============================================================

-- Webhook processing: always queries WHERE status = 'pending' ORDER BY next_retry_at
CREATE INDEX IF NOT EXISTS idx_webhook_queue_pending
  ON public.webhook_queue USING btree (next_retry_at)
  WHERE status = 'pending';

-- Dashboard/reports: almost always filter by approved sales
CREATE INDEX IF NOT EXISTS idx_sales_approved_user
  ON public.sales USING btree (user_id, sold_at DESC)
  WHERE status = 'approved';

-- ============================================================
-- BRIN indexes for append-only timestamp columns
-- BRIN is ~10x smaller than B-tree for monotonically increasing values
-- ============================================================

-- processing_jobs: append-only, created_at only used for time-range queries
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_brin
  ON public.processing_jobs USING brin (created_at);

-- sync_logs: replace existing B-tree with BRIN
DROP INDEX IF EXISTS idx_sync_logs_created_at;
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_brin
  ON public.sync_logs USING brin (created_at);

-- webhook_queue: append-only, BRIN for created_at range queries
CREATE INDEX IF NOT EXISTS idx_webhook_queue_created_brin
  ON public.webhook_queue USING brin (created_at);

-- ============================================================
-- Remove redundant single-column index covered by composite
-- ============================================================

-- idx_sales_user_id (user_id) is covered by idx_sales_user_sold_at (user_id, sold_at DESC)
-- which already exists in migration 20260330140000
DROP INDEX IF EXISTS idx_sales_user_id;


-- >>>>>>>>>>>>>>>>>>>> 20260330170000_schema_integrity_fixes.sql <<<<<<<<<<<<<<<<<<<<

-- Migration: Schema Integrity Fixes
-- 1. Add missing updated_at trigger on workspaces
-- 2. Fix workspace_connections.facebook_connection_id: text -> uuid with FK
-- 3. Fix workspace_checkout_integrations.checkout_integration_id: text -> uuid with FK

-- ============================================================
-- 1. Missing trigger: workspaces.updated_at
-- The column exists but there's no trigger to auto-update it
-- ============================================================
CREATE OR REPLACE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. Fix workspace_connections.facebook_connection_id
-- Currently TEXT, should be UUID with FK to facebook_connections.id
-- This ensures referential integrity (can't point to deleted connections)
-- ============================================================

-- Drop the unique constraint that depends on the column
ALTER TABLE public.workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_workspace_id_facebook_connection_id_key;

-- Convert text -> uuid
ALTER TABLE public.workspace_connections
  ALTER COLUMN facebook_connection_id TYPE uuid USING facebook_connection_id::uuid;

-- Add FK constraint
ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_facebook_connection_id_fkey
  FOREIGN KEY (facebook_connection_id) REFERENCES public.facebook_connections(id);

-- Recreate unique constraint
ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_workspace_id_facebook_connection_id_key
  UNIQUE (workspace_id, facebook_connection_id);

-- ============================================================
-- 3. Fix workspace_checkout_integrations.checkout_integration_id
-- Currently TEXT, should be UUID with FK to checkout_integrations.id
-- ============================================================

-- Drop the unique constraint that depends on the column
ALTER TABLE public.workspace_checkout_integrations
  DROP CONSTRAINT IF EXISTS workspace_checkout_integratio_workspace_id_checkout_integra_key;

-- Convert text -> uuid
ALTER TABLE public.workspace_checkout_integrations
  ALTER COLUMN checkout_integration_id TYPE uuid USING checkout_integration_id::uuid;

-- Add FK constraint
ALTER TABLE public.workspace_checkout_integrations
  ADD CONSTRAINT workspace_checkout_integrations_checkout_integration_id_fkey
  FOREIGN KEY (checkout_integration_id) REFERENCES public.checkout_integrations(id);

-- Recreate unique constraint
ALTER TABLE public.workspace_checkout_integrations
  ADD CONSTRAINT workspace_checkout_integratio_workspace_id_checkout_integra_key
  UNIQUE (workspace_id, checkout_integration_id);


-- >>>>>>>>>>>>>>>>>>>> 20260330180000_cascade_delete_facebook_connections.sql <<<<<<<<<<<<<<<<<<<<

-- Migration: Add ON DELETE CASCADE to workspace_connections.facebook_connection_id FK
-- Fix: Deleting a facebook_connection fails when workspace_connections rows reference it.
-- workspace_connections are link records with no standalone meaning, so cascade is correct.

ALTER TABLE public.workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_facebook_connection_id_fkey;

ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_facebook_connection_id_fkey
  FOREIGN KEY (facebook_connection_id)
  REFERENCES public.facebook_connections(id)
  ON DELETE CASCADE;


-- >>>>>>>>>>>>>>>>>>>> 20260331120000_facebook_oauth_columns.sql <<<<<<<<<<<<<<<<<<<<

-- Add OAuth-specific columns to facebook_connections
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS facebook_user_id TEXT;

-- Make app_id and app_secret nullable (OAuth flow doesn't use per-user app credentials)
ALTER TABLE public.facebook_connections
  ALTER COLUMN app_id DROP NOT NULL,
  ALTER COLUMN app_secret DROP NOT NULL;

-- Index facebook_user_id for lookups during OAuth callback
-- Note: not using CONCURRENTLY here because Supabase runs migrations inside a transaction
CREATE INDEX IF NOT EXISTS idx_facebook_connections_fb_user_id
  ON public.facebook_connections (facebook_user_id)
  WHERE facebook_user_id IS NOT NULL;

COMMENT ON COLUMN public.facebook_connections.token_expires_at IS 'Expiry of the long-lived OAuth token (60 days from exchange)';
COMMENT ON COLUMN public.facebook_connections.facebook_user_id IS 'Facebook user ID that authorized the token';


-- >>>>>>>>>>>>>>>>>>>> 20260331130000_facebook_connections_is_active.sql <<<<<<<<<<<<<<<<<<<<

-- Add is_active column so users can toggle which ad accounts are tracked
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- Add account_name to store the human-readable name from Facebook
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS account_name TEXT;

-- Index for quickly fetching active connections
CREATE INDEX IF NOT EXISTS idx_facebook_connections_user_active
  ON public.facebook_connections (user_id, is_active)
  WHERE is_active = true;

COMMENT ON COLUMN public.facebook_connections.is_active IS 'Whether this ad account is actively tracked for metrics/campaigns';
COMMENT ON COLUMN public.facebook_connections.account_name IS 'Human-readable name of the ad account from Facebook';


-- >>>>>>>>>>>>>>>>>>>> 20260331140000_facebook_user_name_column.sql <<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>> 20260331150000_facebook_account_status_column.sql <<<<<<<<<<<<<<<<<<<<

-- Store the Facebook account_status (1=Active, 2=Disabled, 3=Unsettled, etc.)
-- so the UI can display it without a live API call
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS account_status integer;


-- >>>>>>>>>>>>>>>>>>>> 20260401000000_phase0_add_workspace_id_columns.sql <<<<<<<<<<<<<<<<<<<<

-- Phase 0A: Add nullable workspace_id column to all business-data tables
-- This is purely additive — no existing code or queries are affected.

-- 1. sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 2. campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 3. ad_sets
ALTER TABLE public.ad_sets
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 4. ads
ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 5. daily_ad_spend
ALTER TABLE public.daily_ad_spend
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 6. checkout_integrations
ALTER TABLE public.checkout_integrations
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 7. facebook_connections (already has facebook_user_id, facebook_user_name from prior migrations)
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 8. company_costs
ALTER TABLE public.company_costs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 9. sync_schedules
ALTER TABLE public.sync_schedules
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 10. sync_logs
ALTER TABLE public.sync_logs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 11. processing_jobs
ALTER TABLE public.processing_jobs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);


-- >>>>>>>>>>>>>>>>>>>> 20260401000001_phase0_workspace_indexes.sql <<<<<<<<<<<<<<<<<<<<

-- Phase 0B: Create composite indexes on workspace_id
-- Partial indexes (WHERE workspace_id IS NOT NULL) during transition period.
-- These will be rebuilt as full indexes after Phase 5 (NOT NULL enforcement).
-- Note: Not using CONCURRENTLY because Supabase runs migrations inside a transaction.
-- For production with large tables, run these manually outside a transaction.

CREATE INDEX IF NOT EXISTS idx_sales_workspace_sold_at
  ON public.sales (workspace_id, sold_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_workspace_approved
  ON public.sales (workspace_id, sold_at DESC)
  WHERE status = 'approved' AND workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace
  ON public.campaigns (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_sets_workspace
  ON public.ad_sets (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ads_workspace
  ON public.ads (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_ad_spend_workspace_date
  ON public.daily_ad_spend (workspace_id, date DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_integrations_workspace
  ON public.checkout_integrations (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facebook_connections_workspace_id
  ON public.facebook_connections (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_costs_workspace
  ON public.company_costs (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_schedules_workspace
  ON public.sync_schedules (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace
  ON public.sync_logs (workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;


-- >>>>>>>>>>>>>>>>>>>> 20260401000003_phase5_not_null_constraints.sql <<<<<<<<<<<<<<<<<<<<

-- Phase 5A: Enforce NOT NULL on workspace_id across all tables
-- Only run AFTER verifying all rows have workspace_id populated (Phase 1 backfill)

ALTER TABLE public.sales ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.campaigns ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.ad_sets ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.ads ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.daily_ad_spend ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.checkout_integrations ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.facebook_connections ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.company_costs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.sync_schedules ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.sync_logs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.processing_jobs ALTER COLUMN workspace_id SET NOT NULL;


-- >>>>>>>>>>>>>>>>>>>> 20260401000004_phase5_swap_unique_indexes.sql <<<<<<<<<<<<<<<<<<<<

-- Phase 5B: Swap unique indexes from user_id-scoped to workspace_id-scoped

-- daily_ad_spend: workspace-scoped uniqueness
ALTER TABLE public.daily_ad_spend DROP CONSTRAINT IF EXISTS idx_daily_ad_spend_unique;
DROP INDEX IF EXISTS idx_daily_ad_spend_unique;
CREATE UNIQUE INDEX idx_daily_ad_spend_unique
  ON public.daily_ad_spend (workspace_id, COALESCE(facebook_campaign_id, ''::text), COALESCE(facebook_adset_id, ''::text), COALESCE(facebook_ad_id, ''::text), date);

-- sales: workspace-scoped uniqueness (drop constraint first, then index)
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_external_id_user_id_unique;
DROP INDEX IF EXISTS sales_external_id_user_id_unique;
CREATE UNIQUE INDEX sales_external_id_workspace_unique
  ON public.sales (external_id, workspace_id);

-- sync_schedules: workspace-scoped uniqueness
ALTER TABLE public.sync_schedules DROP CONSTRAINT IF EXISTS sync_schedules_user_id_sync_type_key;
DROP INDEX IF EXISTS sync_schedules_user_id_sync_type_key;
CREATE UNIQUE INDEX sync_schedules_workspace_sync_type_key
  ON public.sync_schedules (workspace_id, sync_type);


-- >>>>>>>>>>>>>>>>>>>> 20260401000005_phase5_drop_junction_tables.sql <<<<<<<<<<<<<<<<<<<<

-- Phase 5C: Drop junction tables — no longer needed since
-- workspace_id is directly on facebook_connections, checkout_integrations, etc.

DROP TABLE IF EXISTS public.workspace_products;
DROP TABLE IF EXISTS public.workspace_checkout_integrations;
DROP TABLE IF EXISTS public.workspace_connections;


-- >>>>>>>>>>>>>>>>>>>> 20260401000006_phase5_rebuild_full_indexes.sql <<<<<<<<<<<<<<<<<<<<

-- Phase 5D: Rebuild partial indexes as full indexes
-- Now that workspace_id is NOT NULL, the WHERE clause is unnecessary.

DROP INDEX IF EXISTS idx_sales_workspace_sold_at;
CREATE INDEX idx_sales_workspace_sold_at
  ON public.sales (workspace_id, sold_at DESC);

DROP INDEX IF EXISTS idx_sales_workspace_approved;
CREATE INDEX idx_sales_workspace_approved
  ON public.sales (workspace_id, sold_at DESC)
  WHERE status = 'approved';

DROP INDEX IF EXISTS idx_campaigns_workspace;
CREATE INDEX idx_campaigns_workspace
  ON public.campaigns (workspace_id);

DROP INDEX IF EXISTS idx_ad_sets_workspace;
CREATE INDEX idx_ad_sets_workspace
  ON public.ad_sets (workspace_id);

DROP INDEX IF EXISTS idx_ads_workspace;
CREATE INDEX idx_ads_workspace
  ON public.ads (workspace_id);

DROP INDEX IF EXISTS idx_daily_ad_spend_workspace_date;
CREATE INDEX idx_daily_ad_spend_workspace_date
  ON public.daily_ad_spend (workspace_id, date DESC);

DROP INDEX IF EXISTS idx_checkout_integrations_workspace;
CREATE INDEX idx_checkout_integrations_workspace
  ON public.checkout_integrations (workspace_id);

DROP INDEX IF EXISTS idx_facebook_connections_workspace_id;
CREATE INDEX idx_facebook_connections_workspace_id
  ON public.facebook_connections (workspace_id);

DROP INDEX IF EXISTS idx_company_costs_workspace;
CREATE INDEX idx_company_costs_workspace
  ON public.company_costs (workspace_id);

DROP INDEX IF EXISTS idx_sync_schedules_workspace;
CREATE INDEX idx_sync_schedules_workspace
  ON public.sync_schedules (workspace_id);

DROP INDEX IF EXISTS idx_sync_logs_workspace;
CREATE INDEX idx_sync_logs_workspace
  ON public.sync_logs (workspace_id, created_at DESC);


-- >>>>>>>>>>>>>>>>>>>> 20260401000007_auto_create_default_workspace.sql <<<<<<<<<<<<<<<<<<<<

-- Auto-create a default workspace when a new user signs up.
-- This ensures every user can immediately set up integrations
-- without having to manually create a workspace first.

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, name, plan_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    (SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1)
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  INSERT INTO public.workspaces (user_id, name)
  VALUES (NEW.id, 'Principal');

  RETURN NEW;
END;
$function$;


-- >>>>>>>>>>>>>>>>>>>> 20260401000008_automation_rules.sql <<<<<<<<<<<<<<<<<<<<

-- Migration: automation_rules feature
-- Creates tables for rule definitions, conditions, and execution logs.
-- Adds max_active_rules column to plan_rules with per-plan seeding.

-- ============================================================
-- TABLE: automation_rules
-- ============================================================
CREATE TABLE public.automation_rules (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL,
  name               text        NOT NULL,
  is_active          boolean     NOT NULL DEFAULT false,
  connection_id      uuid,
  target_entity      text        NOT NULL,
  target_status      text        NOT NULL,
  name_filter        text,
  action_type        text        NOT NULL,
  budget_adjustment  jsonb,
  evaluation_period  text        NOT NULL,
  custom_start_date  date,
  frequency_minutes  integer     NOT NULL,
  daily_run_time     time,
  last_executed_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT automation_rules_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rules_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT automation_rules_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES public.facebook_connections(id) ON DELETE SET NULL,
  CONSTRAINT automation_rules_target_entity_check
    CHECK (target_entity IN ('campaign', 'adset', 'ad')),
  CONSTRAINT automation_rules_target_status_check
    CHECK (target_status IN ('active', 'paused', 'any')),
  CONSTRAINT automation_rules_action_type_check
    CHECK (action_type IN ('activate', 'pause', 'increase_budget', 'decrease_budget')),
  CONSTRAINT automation_rules_evaluation_period_check
    CHECK (evaluation_period IN ('today', 'yesterday', 'last_7d', 'last_30d', 'custom')),
  CONSTRAINT automation_rules_frequency_minutes_check
    CHECK (frequency_minutes IN (10, 15, 30, 60, 120, 180, 360, 1440))
);

-- ============================================================
-- TABLE: automation_rule_conditions
-- ============================================================
CREATE TABLE public.automation_rule_conditions (
  id       uuid    NOT NULL DEFAULT gen_random_uuid(),
  rule_id  uuid    NOT NULL,
  metric   text    NOT NULL,
  operator text    NOT NULL,
  value    numeric NOT NULL,

  CONSTRAINT automation_rule_conditions_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rule_conditions_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_conditions_metric_check
    CHECK (metric IN (
      'spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin',
      'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions'
    )),
  CONSTRAINT automation_rule_conditions_operator_check
    CHECK (operator IN ('gt', 'lt', 'gte', 'lte'))
);

-- ============================================================
-- TABLE: automation_rule_executions
-- ============================================================
CREATE TABLE public.automation_rule_executions (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  rule_id             uuid        NOT NULL,
  workspace_id        uuid        NOT NULL,
  entity_facebook_id  text        NOT NULL,
  entity_name         text,
  action_taken        text        NOT NULL,
  metrics_snapshot    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL,
  error_message       text,
  executed_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT automation_rule_executions_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rule_executions_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_executions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_executions_status_check
    CHECK (status IN ('success', 'error'))
);

-- ============================================================
-- UPDATED_AT TRIGGER: automation_rules
-- ============================================================
CREATE TRIGGER update_automation_rules_updated_at
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- INDEXES
-- ============================================================

-- automation_rules: workspace + active status (primary access pattern)
CREATE INDEX idx_automation_rules_workspace_active
  ON public.automation_rules (workspace_id, is_active);

-- automation_rules: scheduler lookup — only active rules, ordered by last run
CREATE INDEX idx_automation_rules_active_last_executed
  ON public.automation_rules (is_active, last_executed_at)
  WHERE is_active = true;

-- automation_rule_conditions: join on rule_id
CREATE INDEX idx_automation_rule_conditions_rule_id
  ON public.automation_rule_conditions (rule_id);

-- automation_rule_executions: history by rule (most recent first)
CREATE INDEX idx_automation_rule_executions_rule_date
  ON public.automation_rule_executions (rule_id, executed_at DESC);

-- automation_rule_executions: history by workspace (most recent first)
CREATE INDEX idx_automation_rule_executions_workspace_date
  ON public.automation_rule_executions (workspace_id, executed_at DESC);

-- automation_rule_executions: BRIN on executed_at (append-only, monotonically increasing)
CREATE INDEX idx_automation_rule_executions_executed_at_brin
  ON public.automation_rule_executions USING BRIN (executed_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;

-- automation_rules: workspace members can manage their own rules
CREATE POLICY "Workspace members can manage their automation rules"
  ON public.automation_rules
  FOR ALL
  TO authenticated
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- automation_rule_conditions: accessible when the parent rule belongs to the user
CREATE POLICY "Workspace members can manage their rule conditions"
  ON public.automation_rule_conditions
  FOR ALL
  TO authenticated
  USING (
    rule_id IN (
      SELECT ar.id FROM public.automation_rules ar
      JOIN public.workspaces w ON w.id = ar.workspace_id
      WHERE w.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    rule_id IN (
      SELECT ar.id FROM public.automation_rules ar
      JOIN public.workspaces w ON w.id = ar.workspace_id
      WHERE w.user_id = (SELECT auth.uid())
    )
  );

-- automation_rule_executions: read-only for workspace members
CREATE POLICY "Workspace members can view their rule executions"
  ON public.automation_rule_executions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- plan_rules: add max_active_rules column
-- ============================================================

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS max_active_rules integer DEFAULT 0;

-- Seed per-plan limits
UPDATE public.plan_rules SET max_active_rules = 0
  WHERE id = 'aa410a04-a399-400e-ad1c-1ca7f75ccfeb'; -- free

UPDATE public.plan_rules SET max_active_rules = 3
  WHERE id = '29a4ba19-f691-4ceb-894f-19601ea60b17'; -- starter

UPDATE public.plan_rules SET max_active_rules = 7
  WHERE id = 'bd669e8b-eac6-494e-86dd-5e639a8ee182'; -- pro

UPDATE public.plan_rules SET max_active_rules = NULL
  WHERE id = '1b17c43a-be5f-475f-996c-95a228af4d49'; -- enterprise (unlimited)


-- >>>>>>>>>>>>>>>>>>>> 20260407000002_drop_scheduler_locks.sql <<<<<<<<<<<<<<<<<<<<

-- Remove unnecessary scheduler_locks table.
-- Lock coordination is handled in-memory since we run a single instance.
DROP TABLE IF EXISTS scheduler_locks;


-- >>>>>>>>>>>>>>>>>>>> 20260407000002_refund_fallback_index.sql <<<<<<<<<<<<<<<<<<<<

-- Index to support fallback refund matching when external_id doesn't match.
-- Used by webhooksService.findAndRefundOriginalSale() to find the most recent
-- approved sale by (user_id, checkout_integration_id, customer_email, product_name).
-- Partial index (only approved rows) keeps the index small and write-overhead minimal.

CREATE INDEX IF NOT EXISTS idx_sales_refund_fallback
  ON public.sales (user_id, checkout_integration_id, customer_email, product_name, sold_at DESC)
  WHERE status = 'approved';


-- >>>>>>>>>>>>>>>>>>>> 20260407000003_integration_commission_flag.sql <<<<<<<<<<<<<<<<<<<<

-- Add use_commission_value flag to checkout_integrations
-- When true, webhook processors record the producer's net commission instead of the gross sale amount
ALTER TABLE public.checkout_integrations
ADD COLUMN use_commission_value BOOLEAN NOT NULL DEFAULT false;


-- >>>>>>>>>>>>>>>>>>>> 20260407000004_integration_name_column.sql <<<<<<<<<<<<<<<<<<<<

-- Add name column to checkout_integrations for identifying multiple integrations of the same platform
ALTER TABLE public.checkout_integrations
ADD COLUMN name TEXT NOT NULL DEFAULT '';

-- Backfill existing integrations with auto-generated names
WITH ranked AS (
  SELECT id, platform,
    ROW_NUMBER() OVER (PARTITION BY workspace_id, platform ORDER BY created_at) AS rn
  FROM public.checkout_integrations
  WHERE name = ''
)
UPDATE public.checkout_integrations ci
SET name = ranked.platform || ' #' || ranked.rn
FROM ranked
WHERE ci.id = ranked.id;

-- Remove default after backfill so new inserts require a name
ALTER TABLE public.checkout_integrations
ALTER COLUMN name DROP DEFAULT;


-- >>>>>>>>>>>>>>>>>>>> 20260417100000_plan_rules_add_overage_price.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100000_plan_rules_add_overage_price.sql

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS overage_price_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plan_rules.overage_price_cents IS
  'Preço em centavos por venda aprovada acima do max_sales_monthly. 0 = sem overage (Free, Unlimited).';


-- >>>>>>>>>>>>>>>>>>>> 20260417100001_create_subscriptions_table.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100001_create_subscriptions_table.sql

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plan_rules(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','trialing','past_due','canceled','paused')),
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,

  -- Preenchido lazy no 1o upgrade (customer.subscription.created webhook via StripeWebhookService).
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text UNIQUE,

  -- Espelha downgrade agendado no Customer Portal Stripe (populado por customer.subscription.updated).
  scheduled_plan_id    uuid REFERENCES public.plan_rules(id),
  scheduled_changes_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_period_end ON public.subscriptions(current_period_end);
CREATE INDEX idx_subscriptions_scheduled_changes
  ON public.subscriptions(scheduled_changes_at)
  WHERE scheduled_changes_at IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.subscriptions IS
  'Fonte de verdade do plano/ciclo de cada usuário. Preparada para integração com Stripe.';


-- >>>>>>>>>>>>>>>>>>>> 20260417100002_backfill_subscriptions.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100002_backfill_subscriptions.sql

INSERT INTO public.subscriptions
  (user_id, plan_id, status, current_period_start, current_period_end)
SELECT
  p.user_id,
  p.plan_id,
  'active',
  COALESCE(p.subscription_start::timestamptz, p.created_at) AS period_start,
  COALESCE(p.subscription_start::timestamptz, p.created_at) + interval '30 days' AS period_end
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;


-- >>>>>>>>>>>>>>>>>>>> 20260417100003_create_usage_overage_table.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100003_create_usage_overage_table.sql

CREATE TABLE public.usage_overage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  price_cents integer NOT NULL,

  -- Populado por StripeOverageService.sendMeterEvent apos envio bem-sucedido do meter event ao Stripe.
  reported_to_stripe_at   timestamptz,
  stripe_usage_record_id  text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_usage_overage_sale ON public.usage_overage(sale_id);
CREATE INDEX idx_usage_overage_user_period
  ON public.usage_overage(user_id, period_start, period_end);
CREATE INDEX idx_usage_overage_unreported
  ON public.usage_overage(subscription_id)
  WHERE reported_to_stripe_at IS NULL;

ALTER TABLE public.usage_overage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own overage"
  ON public.usage_overage FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.usage_overage IS
  'Uma linha por venda aprovada que excedeu o max_sales_monthly. Base para cobrança via Stripe.';


-- >>>>>>>>>>>>>>>>>>>> 20260417100004_sales_add_blocked_by_limit.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100004_sales_add_blocked_by_limit.sql

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS blocked_by_limit boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sales_blocked_by_limit
  ON public.sales(user_id) WHERE blocked_by_limit = true;

COMMENT ON COLUMN public.sales.blocked_by_limit IS
  'Quando true, venda NÃO entra em métricas/receita/atribuição. Usado quando Free excede max_sales_monthly.';


-- >>>>>>>>>>>>>>>>>>>> 20260417100005_workspaces_add_archive_columns.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100005_workspaces_add_archive_columns.sql

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workspaces_active
  ON public.workspaces(user_id) WHERE archived_at IS NULL;

COMMENT ON COLUMN public.workspaces.archived_at IS
  'Quando NOT NULL, workspace foi arquivado (tipicamente por downgrade). Dados preservados.';
COMMENT ON COLUMN public.workspaces.archived_by_system IS
  'true se foi arquivado pelo auto-trim de downgrade; false se foi manual.';


-- >>>>>>>>>>>>>>>>>>>> 20260417100006_rename_plan_rules_columns.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100006_rename_plan_rules_columns.sql

ALTER TABLE public.plan_rules
  RENAME COLUMN max_sales TO max_sales_monthly;

ALTER TABLE public.plan_rules
  RENAME COLUMN max_ad_accounts TO max_active_ad_accounts;

COMMENT ON COLUMN public.plan_rules.max_sales_monthly IS
  'Limite de vendas aprovadas por ciclo de assinatura. -1 = ilimitado.';
COMMENT ON COLUMN public.plan_rules.max_active_ad_accounts IS
  'Limite de ad accounts com is_active=true. -1 = ilimitado.';


-- >>>>>>>>>>>>>>>>>>>> 20260417100007_seed_plan_rules_values.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417100007_seed_plan_rules_values.sql

INSERT INTO public.plan_rules
  (plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations,
   max_workspaces, max_active_rules, overage_price_cents)
VALUES
  ('free',       30,   1,  1,  1,  0,  0),
  ('pro',        1000, 3,  3,  3,  3,  14),
  ('starter',    2500, 7,  7,  7,  7,  12),
  ('enterprise', 5000, -1, -1, -1, -1, 7),
  ('unlimited',  -1,   -1, -1, -1, -1, 0)
ON CONFLICT (plan) DO UPDATE SET
  max_sales_monthly         = EXCLUDED.max_sales_monthly,
  max_active_ad_accounts    = EXCLUDED.max_active_ad_accounts,
  max_checkout_integrations = EXCLUDED.max_checkout_integrations,
  max_workspaces            = EXCLUDED.max_workspaces,
  max_active_rules          = EXCLUDED.max_active_rules,
  overage_price_cents       = EXCLUDED.overage_price_cents,
  updated_at                = now();


-- >>>>>>>>>>>>>>>>>>>> 20260417300000_drop_plan_rules_dead_columns.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260417300000_drop_plan_rules_dead_columns.sql

-- Remove colunas que nunca foram usadas em enforcement ou UI.
-- max_campaigns, sync_interval_minutes e os 5 feature_* eram consultadas
-- apenas pelo endpoint admin mas nenhum componente do frontend nem nenhum
-- service do backend validava seus valores em runtime.

ALTER TABLE public.plan_rules
  DROP COLUMN IF EXISTS max_campaigns,
  DROP COLUMN IF EXISTS sync_interval_minutes,
  DROP COLUMN IF EXISTS feature_sales_globe,
  DROP COLUMN IF EXISTS feature_advanced_reports,
  DROP COLUMN IF EXISTS feature_conversion_funnel,
  DROP COLUMN IF EXISTS feature_auto_sync,
  DROP COLUMN IF EXISTS feature_api_access;


-- >>>>>>>>>>>>>>>>>>>> 20260419100000_plan_rules_add_stripe_columns.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260419100000_plan_rules_add_stripe_columns.sql

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS stripe_product_id        text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_base     text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_metered  text,
  ADD COLUMN IF NOT EXISTS stripe_meter_event_name  text;

COMMENT ON COLUMN public.plan_rules.stripe_product_id IS
  'Stripe Product ID (prod_xxx). NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_price_id_base IS
  'Stripe Price ID do preço fixo mensal. NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_price_id_metered IS
  'Stripe Price ID do preço metered para overage. NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_meter_event_name IS
  'Nome do meter event a enviar quando overage ocorre. NULL para free e unlimited.';


-- >>>>>>>>>>>>>>>>>>>> 20260419100001_create_stripe_webhook_events.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260419100001_create_stripe_webhook_events.sql

CREATE TABLE public.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);

CREATE INDEX idx_stripe_webhook_events_type_time
  ON public.stripe_webhook_events(type, processed_at DESC);

COMMENT ON TABLE public.stripe_webhook_events IS
  'Idempotency guard. Every Stripe webhook stored by event.id so we never reprocess.';

-- Backend-only table. Users never read from this. Enable RLS with no policies
-- so authenticated/anon role has zero access; service role (backend) bypasses RLS.
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;


-- >>>>>>>>>>>>>>>>>>>> 20260420100000_profiles_add_cnpj_and_signup_trigger.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260420100000_profiles_add_cnpj_and_signup_trigger.sql
--
-- 1. Add `cnpj` column to profiles (sibling of cpf; a user has CPF XOR CNPJ).
-- 2. Enforce uniqueness via partial unique indexes on non-null values.
-- 3. Update handle_new_user trigger to:
--    - read cpf/cnpj from user_metadata (signup form sends them there)
--    - default new users to the Free plan (was: starter)
--    - auto-create the subscriptions row so onboarding flow works

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cnpj text;

COMMENT ON COLUMN public.profiles.cnpj IS
  'Brazilian CNPJ (14 digits). NULL when user registered with CPF instead.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_cnpj_unique
  ON public.profiles(cnpj)
  WHERE cnpj IS NOT NULL;

-- Updated trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_free_plan_id uuid;
  v_cpf text;
  v_cnpj text;
  v_now timestamptz := now();
BEGIN
  SELECT id INTO v_free_plan_id FROM public.plan_rules WHERE plan = 'free' LIMIT 1;

  -- Normalize cpf/cnpj to digits-only if present in metadata
  v_cpf := NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'cpf', ''), '\D', '', 'g'), '');
  v_cnpj := NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'cnpj', ''), '\D', '', 'g'), '');

  INSERT INTO public.profiles (user_id, email, name, plan_id, cpf, cnpj)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    v_free_plan_id,
    v_cpf,
    v_cnpj
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  INSERT INTO public.workspaces (user_id, name)
  VALUES (NEW.id, 'Principal');

  INSERT INTO public.subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
  VALUES (
    NEW.id,
    v_free_plan_id,
    'active',
    v_now,
    v_now + interval '30 days'
  );

  RETURN NEW;
END;
$function$;


-- >>>>>>>>>>>>>>>>>>>> 20260422100000_sales_source_column.sql <<<<<<<<<<<<<<<<<<<<

-- Add source marker to sales for webhook vs import distinction.
-- Plan-limit count queries only count source='webhook'.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (source IN ('webhook', 'import', 'manual'));

-- Partial index matching the plan-limit count predicate.
-- (user_id, sold_at DESC) WHERE status='approved' AND blocked_by_limit=false AND source='webhook'
--
-- Note: not using CONCURRENTLY here because this migration is applied via the
-- Supabase SQL Editor, which wraps statements in a transaction (CONCURRENTLY
-- cannot run inside a transaction block). The index is created at feature-launch
-- time when the table's row count is low, so the brief write lock is acceptable.
CREATE INDEX IF NOT EXISTS idx_sales_planlimits_webhook
  ON public.sales (user_id, sold_at DESC)
  WHERE status = 'approved' AND blocked_by_limit = false AND source = 'webhook';


-- >>>>>>>>>>>>>>>>>>>> 20260428100000_dashboard_aggregation_rpcs.sql <<<<<<<<<<<<<<<<<<<<

-- Server-side aggregation for dashboard endpoints.
--
-- Replaces the row-level pulls in LiveMetricsService that were silently truncated
-- by PostgREST's default 1000-row cap (corrupting SUM/COUNT for users with >1000
-- approved sales) and that wasted bandwidth transferring full result sets just
-- to compute aggregates in Node.

-- ============================================================
-- Helper: pick first numeric segment (>= 6 digits) from a piped/slashed string.
-- Mirrors the legacy TS extractNumericId used by sale-matcher attribution.
-- ============================================================
CREATE OR REPLACE FUNCTION public.extract_numeric_ad_id(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(p)
  FROM regexp_split_to_table(coalesce(raw, ''), '[|/]') AS p
  WHERE trim(p) ~ '^[0-9]{6,}$'
  LIMIT 1;
$$;

-- ============================================================
-- Dashboard aggregations: lifetime + period (gross, count, chart, regions, recent).
-- One round trip returns every shape the dashboard endpoint needs.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_gross numeric := 0;
  v_count int := 0;
  v_lifetime numeric := 0;
  v_chart jsonb := '[]'::jsonb;
  v_regions jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  -- Period: gross revenue + sales count (approved only).
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO v_gross, v_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND blocked_by_limit = false
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names));

  -- Lifetime: ignores period/checkout/product filters by design (drives the milestone bar).
  SELECT COALESCE(SUM(amount), 0)
  INTO v_lifetime
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND blocked_by_limit = false
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id);

  -- Chart: revenue per UTC day, ascending.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', r) ORDER BY d), '[]'::jsonb)
  INTO v_chart
  FROM (
    SELECT to_char(sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
           SUM(amount) AS r
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND blocked_by_limit = false
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY d
  ) c;

  -- Regions: by customer_state, sorted by sales DESC. Percentage is computed in TS.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'state', state,
    'sales', sales_count,
    'revenue', revenue
  ) ORDER BY sales_count DESC), '[]'::jsonb)
  INTO v_regions
  FROM (
    SELECT customer_state AS state,
           COUNT(*) AS sales_count,
           SUM(amount) AS revenue
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND blocked_by_limit = false
      AND customer_state IS NOT NULL
      AND customer_state <> ''
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY customer_state
  ) r;

  -- Recent: 9 most recent approved sales (id, product_name, sold_at, amount).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'product_name', product_name,
    'sold_at', sold_at,
    'amount', amount
  ) ORDER BY sold_at DESC, id DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT id, product_name, sold_at, amount
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND blocked_by_limit = false
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    ORDER BY sold_at DESC, id DESC
    LIMIT 9
  ) rs;

  RETURN jsonb_build_object(
    'gross_revenue', v_gross,
    'sales_count', v_count,
    'lifetime_revenue', v_lifetime,
    'chart_data', v_chart,
    'regions', v_regions,
    'recent_sales', v_recent
  );
END;
$$;

-- ============================================================
-- LC sales aggregated by ad_id (or extracted from utm_term/utm_content).
-- Feeds campaign/adset/ad attribution maps.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sales_grouped_by_ad(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  ad_id text,
  approved_count int,
  approved_revenue numeric,
  refunded_count int,
  refunded_revenue numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH extracted AS (
    SELECT
      COALESCE(
        public.extract_numeric_ad_id(s.ad_id),
        public.extract_numeric_ad_id(s.utm_term),
        public.extract_numeric_ad_id(s.utm_content)
      ) AS extracted_ad_id,
      s.status,
      s.amount
    FROM public.sales s
    WHERE s.user_id = p_user_id
      AND s.status IN ('approved', 'refunded')
      AND s.blocked_by_limit = false
      AND (s.ad_id IS NOT NULL OR s.utm_content IS NOT NULL OR s.utm_term IS NOT NULL)
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
  )
  SELECT
    extracted_ad_id,
    COUNT(*) FILTER (WHERE status = 'approved')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::numeric,
    COUNT(*) FILTER (WHERE status = 'refunded')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric
  FROM extracted
  WHERE extracted_ad_id IS NOT NULL
  GROUP BY extracted_ad_id;
$$;

-- ============================================================
-- Permissions.
-- These functions take p_user_id directly; granting frontend roles would let
-- the anon/authenticated roles read any user's data. Lock them to service_role.
-- (service_role bypasses RLS anyway, so the GRANT is just for PostgREST's
-- function-execution check.)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.extract_numeric_ad_id(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.extract_numeric_ad_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) TO service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260502100000_admin_dashboard_stats_rpc.sql <<<<<<<<<<<<<<<<<<<<

-- Server-side aggregation for the admin dashboard at /admin.
--
-- Replaces the 11 sequential round-trips in AdminService.getStats() with one
-- STABLE function that emits exactly the jsonb shape the dashboard renders.
--
-- Notable bugs being fixed by moving the work into Postgres:
--   * total_revenue summed sales rows in Node, but PostgREST's default 1000-row
--     cap silently truncated the result at scale.
--   * active_users_30d filtered auth.users in Node after listing the first 1000
--     users — the count stops being correct once the platform exceeds 1000 users.
--   * users_by_plan and new_users_by_day pulled every profile row just to bucket
--     them in JS instead of using GROUP BY.
--
-- Also returns only the columns the AdminDashboard component actually renders,
-- so the response payload no longer carries avatar_url, role, ad_account_id,
-- campaigns_count, sales_count, etc. on recent_users.

-- Indexes that the function relies on. CONCURRENTLY is omitted because Supabase
-- wraps each migration in a transaction (CREATE INDEX would fail
-- with 25001). Both tables are small (profiles ≈ user count, sync_schedules ≈
-- workspace count), so a blocking CREATE INDEX completes in milliseconds.
CREATE INDEX IF NOT EXISTS idx_profiles_created_at_desc
  ON public.profiles (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_schedules_errored
  ON public.sync_schedules (last_sync_at DESC)
  WHERE last_sync_status = 'error';

-- ============================================================
-- admin_dashboard_stats: every aggregate the /admin dashboard needs.
-- ============================================================
-- SECURITY DEFINER so the function can read auth.users.last_sign_in_at — by
-- default service_role is not granted SELECT on auth.users in Supabase. Safe
-- here because EXECUTE is restricted to service_role, the function takes no
-- user input, and search_path is pinned.
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thirty_days_ago timestamptz := now() - interval '30 days';
  v_seven_days_ago  timestamptz := now() - interval '7 days';

  v_total_users      bigint := 0;
  v_new_users_7d     bigint := 0;
  v_active_users_30d bigint := 0;
  v_facebook_active  bigint := 0;
  v_total_campaigns  bigint := 0;
  v_total_sales      bigint := 0;
  v_total_revenue    numeric := 0;
  v_checkout_active  bigint := 0;
  v_users_by_plan    jsonb := '{}'::jsonb;
  v_new_users_by_day jsonb := '[]'::jsonb;
  v_recent_users     jsonb := '[]'::jsonb;
  v_sync_errors      jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*) INTO v_total_users FROM public.profiles;

  SELECT COUNT(*) INTO v_new_users_7d
  FROM public.profiles
  WHERE created_at >= v_seven_days_ago;

  -- auth.users.last_sign_in_at is the source of truth; service_role can read it.
  SELECT COUNT(*) INTO v_active_users_30d
  FROM auth.users
  WHERE last_sign_in_at IS NOT NULL
    AND last_sign_in_at >= v_thirty_days_ago;

  SELECT COUNT(*) INTO v_facebook_active
  FROM public.facebook_connections
  WHERE is_valid = true;

  SELECT COUNT(*) INTO v_total_campaigns FROM public.campaigns;

  SELECT COUNT(*) INTO v_total_sales FROM public.sales;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_revenue
  FROM public.sales
  WHERE status = 'approved'
    AND blocked_by_limit = false;

  SELECT COUNT(*) INTO v_checkout_active
  FROM public.checkout_integrations
  WHERE is_active = true;

  -- users_by_plan: { plan_name: count }. Includes zero entries for known plans
  -- so the frontend pie chart renders a stable legend.
  SELECT COALESCE(jsonb_object_agg(plan, cnt), '{}'::jsonb)
  INTO v_users_by_plan
  FROM (
    SELECT pr.plan, COUNT(p.id) AS cnt
    FROM public.plan_rules pr
    LEFT JOIN public.profiles p ON p.plan_id = pr.id
    GROUP BY pr.plan
  ) g;

  -- new_users_by_day: ascending by UTC day, only days that have signups.
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('date', d, 'count', cnt) ORDER BY d),
    '[]'::jsonb
  )
  INTO v_new_users_by_day
  FROM (
    SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
           COUNT(*) AS cnt
    FROM public.profiles
    WHERE created_at >= v_thirty_days_ago
    GROUP BY d
  ) d;

  -- recent_users: 10 newest profiles + their plan name + an aggregate
  -- facebook_connected (true if any connection is valid, false if any exists,
  -- null if none configured).
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_recent_users
  FROM (
    SELECT
      p.id,
      p.user_id,
      p.name,
      p.email,
      pr.plan,
      p.created_at,
      CASE
        WHEN fc.has_any IS NULL THEN NULL
        ELSE fc.any_valid
      END AS facebook_connected
    FROM public.profiles p
    LEFT JOIN public.plan_rules pr ON pr.id = p.plan_id
    LEFT JOIN LATERAL (
      SELECT true AS has_any, bool_or(is_valid) AS any_valid
      FROM public.facebook_connections
      WHERE user_id = p.user_id
    ) fc ON true
    ORDER BY p.created_at DESC
    LIMIT 10
  ) r;

  -- users_with_sync_errors: 10 most recent error rows joined with profile.
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.last_sync_at DESC), '[]'::jsonb)
  INTO v_sync_errors
  FROM (
    SELECT
      ss.user_id,
      p.name,
      p.email,
      ss.last_sync_error,
      ss.last_sync_at
    FROM public.sync_schedules ss
    LEFT JOIN public.profiles p ON p.user_id = ss.user_id
    WHERE ss.last_sync_status = 'error'
    ORDER BY ss.last_sync_at DESC NULLS LAST
    LIMIT 10
  ) r;

  RETURN jsonb_build_object(
    'total_users',                  v_total_users,
    'active_users_30d',             v_active_users_30d,
    'new_users_7d',                 v_new_users_7d,
    'facebook_connections_active',  v_facebook_active,
    'total_campaigns',              v_total_campaigns,
    'total_sales',                  v_total_sales,
    'total_revenue',                v_total_revenue,
    'checkout_integrations_active', v_checkout_active,
    'users_by_plan',                v_users_by_plan,
    'new_users_by_day',             v_new_users_by_day,
    'recent_users',                 v_recent_users,
    'users_with_sync_errors',       v_sync_errors
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_dashboard_stats() TO service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260502110000_admin_dashboard_stats_security_definer.sql <<<<<<<<<<<<<<<<<<<<

-- Promote admin_dashboard_stats() to SECURITY DEFINER.
--
-- The original migration (20260502100000_admin_dashboard_stats_rpc.sql) defined
-- the function with the default SECURITY INVOKER, which made it run as the
-- calling role (service_role). In this Supabase project service_role is not
-- granted SELECT on auth.users, so the function failed at runtime with
-- "permission denied for table users" when computing active_users_30d.
--
-- Safe to flip to SECURITY DEFINER because:
--   * EXECUTE is granted only to service_role and revoked from PUBLIC.
--   * The function takes no user-supplied parameters.
--   * search_path is pinned to public.
--   * The function only reads aggregate counts — it returns no per-user secrets.

ALTER FUNCTION public.admin_dashboard_stats() SECURITY DEFINER;


-- >>>>>>>>>>>>>>>>>>>> 20260502120000_admin_list_users_rpc.sql <<<<<<<<<<<<<<<<<<<<

-- Server-side aggregation + filtering for the AdminUsers page (/admin/users).
--
-- Replaces AdminService.listUsers(), which had three correctness bugs and
-- two performance bugs:
--
--   1. auth.admin.listUsers({ perPage: 1000 }) capped last_sign_in_at lookup at
--      the first 1000 users.
--   2. campaigns / sales aggregates were summed in Node from PostgREST result
--      sets capped at 1000 rows — any user with more than 1000 campaigns or
--      approved sales got a silently truncated campaigns_count / sales_count /
--      total_revenue.
--   3. The "role" and "facebook_status" filters were applied AFTER pagination
--      in JS, so total_count was wrong and pages rendered under-full.
--   4. The aggregates ran for every user_id on the page, even ones the post-
--      pagination filters were about to drop.
--   5. Six unused fields (cnpj, ad_account_id, plan_id, created_at,
--      next_cursor, role/fb-filter intermediaries) were shipped in the response.
--
-- The RPC computes everything in one round trip:
--   * Filters profiles + plan + role + facebook_connected in SQL.
--   * total_count reflects ALL filters.
--   * Aggregates only run via LATERAL on the page's surviving rows.
--   * auth.users is joined directly (SECURITY DEFINER → no 1000-user cap).
--   * Returns only the columns the table + EditUserModal + DeleteUserDialog
--     actually read.
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search           text DEFAULT NULL,
  p_plan             text DEFAULT NULL,
  p_role             text DEFAULT NULL,
  p_facebook_status  text DEFAULT NULL,
  p_page             int  DEFAULT 1,
  p_limit            int  DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset    int    := GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_limit, 20), 0);
  v_limit     int    := GREATEST(LEAST(COALESCE(p_limit, 20), 200), 1);
  v_total     bigint := 0;
  v_users     jsonb  := '[]'::jsonb;
BEGIN
  -- Materialize the filtered set once. Filters that DON'T require aggregates
  -- (search, plan, role) run on indexed columns. facebook_connected is derived
  -- via a tiny LATERAL — only needed when p_facebook_status is set, but we
  -- compute it unconditionally so the same CTE can be reused for total + page.
  WITH filtered AS (
    SELECT
      p.id,
      p.user_id,
      p.name,
      p.email,
      p.avatar_url,
      p.cpf,
      p.subscription_start,
      p.subscription_end,
      p.created_at,
      pr.plan,
      COALESCE(ur.role::text, 'user') AS role,
      fc.facebook_connected
    FROM public.profiles p
    LEFT JOIN public.plan_rules pr ON pr.id = p.plan_id
    LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE bool_or(is_valid)
      END AS facebook_connected
      FROM public.facebook_connections
      WHERE user_id = p.user_id
    ) fc ON TRUE
    WHERE
      (p_search IS NULL
        OR p.name  ILIKE '%' || p_search || '%'
        OR p.email ILIKE '%' || p_search || '%')
      AND (p_plan IS NULL OR pr.plan = p_plan)
      AND (p_role IS NULL OR COALESCE(ur.role::text, 'user') = p_role)
      AND (
        p_facebook_status IS NULL
        OR (p_facebook_status = 'connected'      AND fc.facebook_connected = TRUE)
        OR (p_facebook_status = 'expired'        AND fc.facebook_connected = FALSE)
        OR (p_facebook_status = 'not_configured' AND fc.facebook_connected IS NULL)
      )
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC, id DESC
    LIMIT v_limit OFFSET v_offset
  ),
  -- Heavy aggregates run only on rows that will actually be returned.
  enriched AS (
    SELECT
      pg.id,
      pg.user_id,
      pg.name,
      pg.email,
      pg.avatar_url,
      pg.cpf,
      pg.plan,
      pg.role,
      pg.facebook_connected,
      pg.subscription_start,
      pg.subscription_end,
      COALESCE(camp.cnt, 0)        AS campaigns_count,
      COALESCE(s.cnt, 0)           AS sales_count,
      COALESCE(s.revenue, 0)       AS total_revenue,
      au.last_sign_in_at,
      pg.created_at AS _created_at
    FROM paged pg
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM public.campaigns
      WHERE user_id = pg.user_id
    ) camp ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt,
             COALESCE(SUM(amount), 0)::numeric AS revenue
      FROM public.sales
      WHERE user_id = pg.user_id
        AND status = 'approved'
        AND blocked_by_limit = false
    ) s ON TRUE
    LEFT JOIN auth.users au ON au.id = pg.user_id
  )
  SELECT
    (SELECT COUNT(*) FROM filtered),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',                  e.id,
      'user_id',             e.user_id,
      'name',                e.name,
      'email',               e.email,
      'avatar_url',          e.avatar_url,
      'cpf',                 e.cpf,
      'plan',                e.plan,
      'role',                e.role,
      'facebook_connected',  e.facebook_connected,
      'campaigns_count',     e.campaigns_count,
      'sales_count',         e.sales_count,
      'total_revenue',       e.total_revenue,
      'subscription_start',  e.subscription_start,
      'subscription_end',    e.subscription_end,
      'last_sign_in_at',     e.last_sign_in_at
    ) ORDER BY e._created_at DESC, e.id DESC), '[]'::jsonb)
  INTO v_total, v_users
  FROM enriched e;

  RETURN jsonb_build_object(
    'users',       v_users,
    'total_count', v_total,
    'page',        COALESCE(p_page, 1),
    'total_pages', GREATEST(CEIL(v_total::numeric / v_limit)::int, 1)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users(text, text, text, text, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_users(text, text, text, text, int, int) TO service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260502120000_workspaces_ad_spend_tax_percentage.sql <<<<<<<<<<<<<<<<<<<<

-- Add ad-spend tax percentage to workspaces.
-- This is an income tax that incides on Meta Ads spend (e.g. user pays X% on
-- top of every R$ spent on ads). The value is shown in the dashboard and
-- discounted from profit on both /metrics/dashboard and /financial/summary.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ad_spend_tax_percentage numeric NOT NULL DEFAULT 0
  CHECK (ad_spend_tax_percentage >= 0 AND ad_spend_tax_percentage <= 100);


-- >>>>>>>>>>>>>>>>>>>> 20260502130000_admin_user_detail_rpc.sql <<<<<<<<<<<<<<<<<<<<

-- Server-side aggregation for the AdminUserDetail page (/admin/users/:id).
--
-- Replaces AdminService.getUserDetail(), which was a copy of the user dashboard
-- (campanhas / conjuntos / anúncios / ROI / ROAS / charts) with 13 sequential
-- queries plus an auth.admin.getUserById call. The new endpoint is focused on
-- support: integrations, plan, subscription, automation rules, plus a couple of
-- account-health numbers. Everything ships in a single round-trip jsonb.
--
-- Bugs that the old implementation hid (now fixed by moving aggregation into SQL):
--   * total_revenue was summed in Node from a SELECT amount; PostgREST capped at
--     1000 rows so any user with >1000 approved sales got the wrong number.
--   * auth.admin.getUserById was an extra call; here we LEFT JOIN auth.users
--     directly via SECURITY DEFINER.

-- ============================================================
-- Helper: mask a secret string for safe display.
-- '••••••••' + last 4 chars when long enough; bullets only otherwise.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mask_secret(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN s IS NULL OR length(s) = 0 THEN NULL
    WHEN length(s) <= 4              THEN repeat('•', length(s))
    ELSE repeat('•', 8) || right(s, 4)
  END;
$$;

-- ============================================================
-- admin_user_detail: full support payload for one user.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile      jsonb;
  v_subscription jsonb;
  v_health       jsonb;
  v_facebook     jsonb;
  v_checkouts    jsonb;
  v_rules        jsonb;
BEGIN
  -- ----- Profile + role + plan + last_sign_in -----
  SELECT jsonb_build_object(
    'user_id',            p.user_id,
    'name',               p.name,
    'email',              p.email,
    'avatar_url',         p.avatar_url,
    'cpf',                p.cpf,
    'subscription_start', p.subscription_start,
    'subscription_end',   p.subscription_end,
    'created_at',         p.created_at,
    'last_sign_in_at',    au.last_sign_in_at,
    'role',               COALESCE(ur.role::text, 'user'),
    'plan',               pr.plan
  )
  INTO v_profile
  FROM public.profiles p
  LEFT JOIN public.plan_rules  pr ON pr.id      = p.plan_id
  LEFT JOIN public.user_roles  ur ON ur.user_id = p.user_id
  LEFT JOIN auth.users         au ON au.id      = p.user_id
  WHERE p.user_id = p_user_id;

  -- Caller distinguishes 'not found' from 'no data' by checking profile IS NULL.
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('profile', NULL);
  END IF;

  -- ----- Subscription (Stripe-backed) -----
  SELECT jsonb_build_object(
    'status',                  s.status,
    'current_period_start',    s.current_period_start,
    'current_period_end',      s.current_period_end,
    'cancel_at_period_end',    s.cancel_at_period_end,
    'stripe_customer_id',      s.stripe_customer_id,
    'stripe_subscription_id',  s.stripe_subscription_id,
    'scheduled_plan',          spr.plan,
    'scheduled_changes_at',    s.scheduled_changes_at
  )
  INTO v_subscription
  FROM public.subscriptions s
  LEFT JOIN public.plan_rules spr ON spr.id = s.scheduled_plan_id
  WHERE s.user_id = p_user_id;

  -- ----- Health (sales count + total revenue) -----
  SELECT jsonb_build_object(
    'sales_count',   COALESCE(COUNT(*), 0),
    'total_revenue', COALESCE(SUM(amount), 0)
  )
  INTO v_health
  FROM public.sales
  WHERE user_id = p_user_id
    AND status  = 'approved'
    AND blocked_by_limit = false;

  -- ----- Facebook: connections list + sync schedule summary -----
  WITH conns AS (
    SELECT
      id, ad_account_id, account_name, account_status,
      is_valid, is_active, facebook_user_id, facebook_user_name,
      last_validated_at, token_expires_at, created_at
    FROM public.facebook_connections
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
  ),
  sync_summary AS (
    SELECT is_active, interval_minutes, last_sync_at,
           last_sync_status, last_sync_error
    FROM public.sync_schedules
    WHERE user_id = p_user_id
      AND sync_type = 'facebook_ads'
    ORDER BY last_sync_at DESC NULLS LAST
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'connections_count', (SELECT COUNT(*) FROM conns),
    'connections',       COALESCE(
      (SELECT jsonb_agg(to_jsonb(c)) FROM conns c),
      '[]'::jsonb
    ),
    'sync',              (SELECT to_jsonb(s) FROM sync_summary s)
  )
  INTO v_facebook;

  -- ----- Checkouts (only ones the user actually configured) -----
  -- Tokens are masked here. Plain-text tokens are exposed via a separate
  -- endpoint with admin guard for the "Conferir" button.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                    ci.id,
    'platform',              ci.platform,
    'name',                  ci.name,
    'is_active',             ci.is_active,
    'use_commission_value',  ci.use_commission_value,
    'last_webhook_at',       ci.last_webhook_at,
    'created_at',            ci.created_at,
    'webhook_url',           ci.webhook_url,
    'webhook_secret_masked', public.mask_secret(ci.webhook_secret),
    'api_token_masked',      public.mask_secret(ci.api_token),
    'has_webhook_secret',    ci.webhook_secret IS NOT NULL,
    'has_api_token',         ci.api_token IS NOT NULL
  ) ORDER BY ci.created_at DESC), '[]'::jsonb)
  INTO v_checkouts
  FROM public.checkout_integrations ci
  WHERE ci.user_id = p_user_id;

  -- ----- Automation rules (across all workspaces of the user) -----
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                r.id,
    'workspace_id',      r.workspace_id,
    'workspace_name',    w.name,
    'name',              r.name,
    'is_active',         r.is_active,
    'target_entity',     r.target_entity,
    'target_status',     r.target_status,
    'action_type',       r.action_type,
    'evaluation_period', r.evaluation_period,
    'frequency_minutes', r.frequency_minutes,
    'conditions_count',  cnt.cnt,
    'last_executed_at',  r.last_executed_at,
    'last_execution',    exec.last
  ) ORDER BY r.is_active DESC, r.last_executed_at DESC NULLS LAST, r.created_at DESC), '[]'::jsonb)
  INTO v_rules
  FROM public.automation_rules r
  JOIN public.workspaces w ON w.id = r.workspace_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM public.automation_rule_conditions
    WHERE rule_id = r.id
  ) cnt ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'executed_at',   e.executed_at,
      'status',        e.status,
      'action_taken',  e.action_taken,
      'entity_name',   e.entity_name,
      'error_message', e.error_message
    ) AS last
    FROM public.automation_rule_executions e
    WHERE e.rule_id = r.id
    ORDER BY e.executed_at DESC
    LIMIT 1
  ) exec ON TRUE
  WHERE w.user_id = p_user_id;

  RETURN jsonb_build_object(
    'profile',          v_profile,
    'subscription',     v_subscription,
    'health',           v_health,
    'facebook',         v_facebook,
    'checkouts',        v_checkouts,
    'automation_rules', v_rules
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mask_secret(text)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_user_detail(uuid)  FROM PUBLIC;

GRANT  EXECUTE ON FUNCTION public.mask_secret(text)        TO service_role;
GRANT  EXECUTE ON FUNCTION public.admin_user_detail(uuid)  TO service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260502160000_admin_user_detail_with_workspaces.sql <<<<<<<<<<<<<<<<<<<<

-- AdminUserDetail v2: include the user's workspaces and tag every workspace-scoped
-- entity with workspace_id so the support page can filter by workspace.
--
-- Adds, on top of the previous payload:
--   * workspaces[]  — every workspace the user owns (ordered: not archived first)
--   * workspace_id  on every facebook connection and checkout integration
--     (automation_rules already carried workspace_id and workspace_name)
--   * profile.cnpj  — sibling of cpf (a profile has CPF XOR CNPJ since
--     migration 20260420100000)

CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile      jsonb;
  v_subscription jsonb;
  v_health       jsonb;
  v_workspaces   jsonb;
  v_facebook     jsonb;
  v_checkouts    jsonb;
  v_rules        jsonb;
BEGIN
  -- ----- Profile + role + plan + last_sign_in -----
  SELECT jsonb_build_object(
    'user_id',            p.user_id,
    'name',               p.name,
    'email',              p.email,
    'avatar_url',         p.avatar_url,
    'cpf',                p.cpf,
    'cnpj',               p.cnpj,
    'subscription_start', p.subscription_start,
    'subscription_end',   p.subscription_end,
    'created_at',         p.created_at,
    'last_sign_in_at',    au.last_sign_in_at,
    'role',               COALESCE(ur.role::text, 'user'),
    'plan',               pr.plan
  )
  INTO v_profile
  FROM public.profiles p
  LEFT JOIN public.plan_rules  pr ON pr.id      = p.plan_id
  LEFT JOIN public.user_roles  ur ON ur.user_id = p.user_id
  LEFT JOIN auth.users         au ON au.id      = p.user_id
  WHERE p.user_id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('profile', NULL);
  END IF;

  -- ----- Subscription (Stripe-backed) -----
  SELECT jsonb_build_object(
    'status',                  s.status,
    'current_period_start',    s.current_period_start,
    'current_period_end',      s.current_period_end,
    'cancel_at_period_end',    s.cancel_at_period_end,
    'stripe_customer_id',      s.stripe_customer_id,
    'stripe_subscription_id',  s.stripe_subscription_id,
    'scheduled_plan',          spr.plan,
    'scheduled_changes_at',    s.scheduled_changes_at
  )
  INTO v_subscription
  FROM public.subscriptions s
  LEFT JOIN public.plan_rules spr ON spr.id = s.scheduled_plan_id
  WHERE s.user_id = p_user_id;

  -- ----- Health (sales count + total revenue) -----
  SELECT jsonb_build_object(
    'sales_count',   COALESCE(COUNT(*), 0),
    'total_revenue', COALESCE(SUM(amount), 0)
  )
  INTO v_health
  FROM public.sales
  WHERE user_id = p_user_id
    AND status  = 'approved'
    AND blocked_by_limit = false;

  -- ----- Workspaces of the user (active first, then archived) -----
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                  w.id,
    'name',                w.name,
    'archived_at',         w.archived_at,
    'archived_by_system',  w.archived_by_system,
    'created_at',          w.created_at
  ) ORDER BY (w.archived_at IS NOT NULL), w.created_at), '[]'::jsonb)
  INTO v_workspaces
  FROM public.workspaces w
  WHERE w.user_id = p_user_id;

  -- ----- Facebook: connections list (with workspace_id) + sync schedule summary -----
  WITH conns AS (
    SELECT
      id, ad_account_id, account_name, account_status,
      is_valid, is_active, facebook_user_id, facebook_user_name,
      last_validated_at, token_expires_at, created_at, workspace_id
    FROM public.facebook_connections
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
  ),
  sync_summary AS (
    SELECT is_active, interval_minutes, last_sync_at,
           last_sync_status, last_sync_error
    FROM public.sync_schedules
    WHERE user_id = p_user_id
      AND sync_type = 'facebook_ads'
    ORDER BY last_sync_at DESC NULLS LAST
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'connections_count', (SELECT COUNT(*) FROM conns),
    'connections',       COALESCE(
      (SELECT jsonb_agg(to_jsonb(c)) FROM conns c),
      '[]'::jsonb
    ),
    'sync',              (SELECT to_jsonb(s) FROM sync_summary s)
  )
  INTO v_facebook;

  -- ----- Checkouts (workspace_id included) -----
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                    ci.id,
    'workspace_id',          ci.workspace_id,
    'platform',              ci.platform,
    'name',                  ci.name,
    'is_active',             ci.is_active,
    'use_commission_value',  ci.use_commission_value,
    'last_webhook_at',       ci.last_webhook_at,
    'created_at',            ci.created_at,
    'webhook_url',           ci.webhook_url,
    'webhook_secret_masked', public.mask_secret(ci.webhook_secret),
    'api_token_masked',      public.mask_secret(ci.api_token),
    'has_webhook_secret',    ci.webhook_secret IS NOT NULL,
    'has_api_token',         ci.api_token IS NOT NULL
  ) ORDER BY ci.created_at DESC), '[]'::jsonb)
  INTO v_checkouts
  FROM public.checkout_integrations ci
  WHERE ci.user_id = p_user_id;

  -- ----- Automation rules (already workspace-scoped) -----
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                r.id,
    'workspace_id',      r.workspace_id,
    'workspace_name',    w.name,
    'name',              r.name,
    'is_active',         r.is_active,
    'target_entity',     r.target_entity,
    'target_status',     r.target_status,
    'action_type',       r.action_type,
    'evaluation_period', r.evaluation_period,
    'frequency_minutes', r.frequency_minutes,
    'conditions_count',  cnt.cnt,
    'last_executed_at',  r.last_executed_at,
    'last_execution',    exec.last
  ) ORDER BY r.is_active DESC, r.last_executed_at DESC NULLS LAST, r.created_at DESC), '[]'::jsonb)
  INTO v_rules
  FROM public.automation_rules r
  JOIN public.workspaces w ON w.id = r.workspace_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM public.automation_rule_conditions
    WHERE rule_id = r.id
  ) cnt ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'executed_at',   e.executed_at,
      'status',        e.status,
      'action_taken',  e.action_taken,
      'entity_name',   e.entity_name,
      'error_message', e.error_message
    ) AS last
    FROM public.automation_rule_executions e
    WHERE e.rule_id = r.id
    ORDER BY e.executed_at DESC
    LIMIT 1
  ) exec ON TRUE
  WHERE w.user_id = p_user_id;

  RETURN jsonb_build_object(
    'profile',          v_profile,
    'subscription',     v_subscription,
    'health',           v_health,
    'workspaces',       v_workspaces,
    'facebook',         v_facebook,
    'checkouts',        v_checkouts,
    'automation_rules', v_rules
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_user_detail(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_user_detail(uuid) TO service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260502170000_sync_profile_email_on_auth_update.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260502170000_sync_profile_email_on_auth_update.sql
--
-- Defesa em profundidade para a feature "Settings/Profile unify".
-- Garante que qualquer UPDATE em auth.users.email reflete em profiles.email,
-- mesmo se um endpoint futuro alterar o auth sem passar pelo backend.

CREATE OR REPLACE FUNCTION public.sync_profile_email()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
       SET email = NEW.email,
           updated_at = now()
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_profile_email();


-- >>>>>>>>>>>>>>>>>>>> 20260504100000_sync_checkout_platforms_check.sql <<<<<<<<<<<<<<<<<<<<

-- Sync the checkout_integrations.platform CHECK with the application's
-- supported platforms.
--
-- - Removes 'balaclava' (integration deleted from the codebase; no rows
--   reference this value, verified before running this migration).
-- - Adds 'hubla', 'cartpanda', 'ggcheckout', 'lastlink' so the frontend can
--   register integrations for those platforms (their backend processors
--   already exist).
-- - 'n8n-profiles' is intentionally excluded — it is a profile-only
--   processor, not a checkout integration.

ALTER TABLE public.checkout_integrations
  DROP CONSTRAINT IF EXISTS checkout_integrations_platform_check;

ALTER TABLE public.checkout_integrations
  ADD CONSTRAINT checkout_integrations_platform_check
  CHECK (platform = ANY (ARRAY[
    'hotmart'::text,
    'kiwify'::text,
    'kirvano'::text,
    'guru'::text,
    'perfectpay'::text,
    'ticto'::text,
    'payt'::text,
    'cakto'::text,
    'hubla'::text,
    'cartpanda'::text,
    'ggcheckout'::text,
    'lastlink'::text
  ]));


-- >>>>>>>>>>>>>>>>>>>> 20260504200000_add_eduzz_mundpay_monetizze_greenn_to_platform_check.sql <<<<<<<<<<<<<<<<<<<<

-- Add 4 new platforms to checkout_integrations.platform CHECK:
-- eduzz, mundpay, monetizze, greenn.
-- Their backend processors are now implemented (see
-- packages/backend/src/modules/webhooks/processors/{eduzz,mundpay,monetizze,greenn}.processor.ts).

ALTER TABLE public.checkout_integrations
  DROP CONSTRAINT IF EXISTS checkout_integrations_platform_check;

ALTER TABLE public.checkout_integrations
  ADD CONSTRAINT checkout_integrations_platform_check
  CHECK (platform = ANY (ARRAY[
    'hotmart'::text,
    'kiwify'::text,
    'kirvano'::text,
    'guru'::text,
    'perfectpay'::text,
    'ticto'::text,
    'payt'::text,
    'cakto'::text,
    'hubla'::text,
    'cartpanda'::text,
    'ggcheckout'::text,
    'lastlink'::text,
    'eduzz'::text,
    'mundpay'::text,
    'monetizze'::text,
    'greenn'::text
  ]));


-- >>>>>>>>>>>>>>>>>>>> 20260506100000_sales_perf_indexes.sql <<<<<<<<<<<<<<<<<<<<

-- Performance indexes for the Sales screen.
-- Server-side filtering, pagination, and aggregations all rely on
-- (workspace_id, sold_at) and (workspace_id, status, sold_at) lookups.
-- Use CONCURRENTLY so the migration does not block writes in production.

CREATE INDEX IF NOT EXISTS idx_sales_workspace_sold_at_desc
  ON public.sales (workspace_id, sold_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_workspace_status_sold_at
  ON public.sales (workspace_id, status, sold_at DESC);

-- Partial index for the product filter dropdown (distinct product_name).
CREATE INDEX IF NOT EXISTS idx_sales_workspace_product_name
  ON public.sales (workspace_id, product_name)
  WHERE product_name IS NOT NULL;


-- >>>>>>>>>>>>>>>>>>>> 20260506110000_sales_summary_rpc.sql <<<<<<<<<<<<<<<<<<<<

-- Server-side aggregation for the Sales screen.
--
-- The previous client-side approach loaded every row in the workspace and
-- computed metrics/charts in JavaScript, which was capped at 1000 rows by
-- PostgREST and broke for high-volume users. This RPC returns metrics and
-- chart shapes in a single round trip.

CREATE OR REPLACE FUNCTION public.sales_summary(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_q_pattern text := CASE WHEN p_q IS NULL OR length(trim(p_q)) = 0 THEN NULL ELSE '%' || trim(p_q) || '%' END;
  v_approved_count int := 0;
  v_gross_revenue numeric := 0;
  v_avg_ticket numeric := 0;
  v_refunds_count int := 0;
  v_total_count int := 0;
  v_refund_rate numeric := 0;
  v_by_product jsonb := '[]'::jsonb;
  v_by_ad jsonb := '[]'::jsonb;
  v_refunds_by_state jsonb := '[]'::jsonb;
  v_refunded_sample jsonb := '[]'::jsonb;
BEGIN
  -- Approved metrics (count + gross revenue) for the filter scope.
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_approved_count, v_gross_revenue
  FROM public.sales
  WHERE user_id = p_user_id
    AND blocked_by_limit = false
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  -- Refunds count for refund-rate calculation.
  SELECT COUNT(*)
  INTO v_refunds_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND blocked_by_limit = false
    AND status = 'refunded'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  v_total_count := v_approved_count + v_refunds_count;
  IF v_total_count > 0 THEN
    v_refund_rate := (v_refunds_count::numeric / v_total_count) * 100;
  END IF;

  IF v_approved_count > 0 THEN
    v_avg_ticket := v_gross_revenue / v_approved_count;
  END IF;

  -- Top products (approved sales, by revenue).
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT jsonb_build_object(
      'product_name', COALESCE(product_name, 'Sem produto'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(amount), 0)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND blocked_by_limit = false
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY product_name
    ORDER BY SUM(amount) DESC NULLS LAST
    LIMIT 10
  ) t;

  -- Top ads (approved sales, by quantity). Falls back through ad → ad_set → campaign name.
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_ad
  FROM (
    SELECT jsonb_build_object(
      'name', COALESCE(a.name, asg.name, c.name, 'Anúncio não identificado'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(s.amount), 0)
    ) AS row
    FROM public.sales s
    LEFT JOIN public.ads a ON s.ad_id = a.id
    LEFT JOIN public.ad_sets asg ON s.ad_set_id = asg.id
    LEFT JOIN public.campaigns c ON s.campaign_id = c.id
    WHERE s.user_id = p_user_id
      AND s.blocked_by_limit = false
      AND s.status = 'approved'
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
      AND (p_checkout_ids IS NULL OR s.checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR s.product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR s.campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR s.customer_email ILIKE v_q_pattern
        OR s.customer_name ILIKE v_q_pattern
        OR s.product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  -- Top 3 states with most refunds (in filter scope).
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunds_by_state
  FROM (
    SELECT jsonb_build_object(
      'state', COALESCE(UPPER(TRIM(customer_state)), 'N/A'),
      'count', COUNT(*)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND blocked_by_limit = false
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 3
  ) t;

  -- Sample of refunded sales for client-side gender breakdown (cap 500).
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunded_sample
  FROM (
    SELECT jsonb_build_object(
      'customer_name', customer_name,
      'customer_state', customer_state,
      'amount', amount
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND blocked_by_limit = false
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    ORDER BY sold_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object(
    'metrics', jsonb_build_object(
      'approved_count', v_approved_count,
      'gross_revenue', v_gross_revenue,
      'avg_ticket', v_avg_ticket,
      'refunds_count', v_refunds_count,
      'refund_rate', v_refund_rate
    ),
    'by_product', v_by_product,
    'by_ad', v_by_ad,
    'refunds_by_state', v_refunds_by_state,
    'refunded_sample', v_refunded_sample
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sales_summary(uuid, uuid, timestamptz, timestamptz, text[], uuid[], text[], uuid[], text) TO authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260508120000_sales_summary_rpc_v2.sql <<<<<<<<<<<<<<<<<<<<

-- Restore the original "Vendas por Anúncio" grouping rule and fix the ads JOIN.
--
-- The previous version of sales_summary (20260506110000) had two problems:
--
-- 1. The by_ad breakdown grouped by
--    COALESCE(ads.name, ad_sets.name, campaigns.name, 'Anúncio não identificado'),
--    which changed the card behavior: when a sale only resolved to an ad_set
--    or campaign, the card showed the ad set / campaign name instead of the
--    pre-rewrite behavior of falling back to utm_content / raw ad_id.
--
-- 2. The JOIN `s.ad_id = a.id` compared text (Facebook ad id stored in
--    sales.ad_id) with uuid (ads.id), which raised
--    "operator does not exist: text = uuid" at runtime. The whole RPC
--    failed and the backend silently fell back to the in-memory aggregation
--    in sales.service.ts. This migration switches the JOIN to the actual
--    foreign key (sales.ad_internal_id → ads.id) so the RPC actually runs.
--
-- This migration recreates the function with the original grouping key:
--   COALESCE(s.utm_content, ads.name, s.ad_id, 'Sem anúncio')
-- Every other aggregation (metrics, by_product, refunds_by_state,
-- refunded_sample) is unchanged.

CREATE OR REPLACE FUNCTION public.sales_summary(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_q_pattern text := CASE WHEN p_q IS NULL OR length(trim(p_q)) = 0 THEN NULL ELSE '%' || trim(p_q) || '%' END;
  v_approved_count int := 0;
  v_gross_revenue numeric := 0;
  v_avg_ticket numeric := 0;
  v_refunds_count int := 0;
  v_total_count int := 0;
  v_refund_rate numeric := 0;
  v_by_product jsonb := '[]'::jsonb;
  v_by_ad jsonb := '[]'::jsonb;
  v_refunds_by_state jsonb := '[]'::jsonb;
  v_refunded_sample jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_approved_count, v_gross_revenue
  FROM public.sales
  WHERE user_id = p_user_id
    AND blocked_by_limit = false
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  SELECT COUNT(*)
  INTO v_refunds_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND blocked_by_limit = false
    AND status = 'refunded'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  v_total_count := v_approved_count + v_refunds_count;
  IF v_total_count > 0 THEN
    v_refund_rate := (v_refunds_count::numeric / v_total_count) * 100;
  END IF;

  IF v_approved_count > 0 THEN
    v_avg_ticket := v_gross_revenue / v_approved_count;
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT jsonb_build_object(
      'product_name', COALESCE(product_name, 'Sem produto'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(amount), 0)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND blocked_by_limit = false
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY product_name
    ORDER BY SUM(amount) DESC NULLS LAST
    LIMIT 10
  ) t;

  -- Top ads (approved sales, by quantity).
  -- Grouping key matches the pre-server-aggregation behavior:
  --   utm_content (UTM from the click) → ads.name → ad_id (raw) → 'Sem anúncio'
  -- ad_set / campaign names are intentionally NOT used as fallbacks here.
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_ad
  FROM (
    SELECT jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(s.utm_content), ''), a.name, NULLIF(s.ad_id, ''), 'Sem anúncio'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(s.amount), 0)
    ) AS row
    FROM public.sales s
    LEFT JOIN public.ads a ON s.ad_internal_id = a.id
    WHERE s.user_id = p_user_id
      AND s.blocked_by_limit = false
      AND s.status = 'approved'
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
      AND (p_checkout_ids IS NULL OR s.checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR s.product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR s.campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR s.customer_email ILIKE v_q_pattern
        OR s.customer_name ILIKE v_q_pattern
        OR s.product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunds_by_state
  FROM (
    SELECT jsonb_build_object(
      'state', COALESCE(UPPER(TRIM(customer_state)), 'N/A'),
      'count', COUNT(*)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND blocked_by_limit = false
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 3
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunded_sample
  FROM (
    SELECT jsonb_build_object(
      'customer_name', customer_name,
      'customer_state', customer_state,
      'amount', amount
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND blocked_by_limit = false
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    ORDER BY sold_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object(
    'metrics', jsonb_build_object(
      'approved_count', v_approved_count,
      'gross_revenue', v_gross_revenue,
      'avg_ticket', v_avg_ticket,
      'refunds_count', v_refunds_count,
      'refund_rate', v_refund_rate
    ),
    'by_product', v_by_product,
    'by_ad', v_by_ad,
    'refunds_by_state', v_refunds_by_state,
    'refunded_sample', v_refunded_sample
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sales_summary(uuid, uuid, timestamptz, timestamptz, text[], uuid[], text[], uuid[], text) TO authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260514120000_overage_settled_columns.sql <<<<<<<<<<<<<<<<<<<<

-- supabase/migrations/20260514120000_overage_settled_columns.sql
--
-- Adiciona colunas pra marcar overage rows que foram liquidadas (settled)
-- dentro de uma invoice avulsa no momento de upgrade de plano.
--
-- Contexto: quando o usuário faz upgrade no meio do ciclo, o sistema cobra
-- o overage acumulado sob a regra do NOVO plano (limite e preço novos)
-- como linha extra na invoice da diff. As rows de usage_overage do ciclo
-- atual são marcadas com settled_by_invoice_id pra que:
--   1. O reconciliation cron não tente re-disparar meter events delas.
--   2. Tenhamos paper trail histórico (qual invoice resolveu cada row).

ALTER TABLE public.usage_overage
  ADD COLUMN IF NOT EXISTS settled_at            timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_invoice_id text;

COMMENT ON COLUMN public.usage_overage.settled_at IS
  'Timestamp em que a row foi liquidada via invoice extra no upgrade. NULL para rows ainda no fluxo normal de meter events.';
COMMENT ON COLUMN public.usage_overage.settled_by_invoice_id IS
  'Stripe Invoice ID (in_xxx) que cobrou esta overage row. Set junto com settled_at.';

-- Index parcial pra o cron filtrar rapidamente as pendentes.
CREATE INDEX IF NOT EXISTS idx_usage_overage_unsettled_unreported
  ON public.usage_overage (id)
  WHERE reported_to_stripe_at IS NULL AND settled_at IS NULL;


-- >>>>>>>>>>>>>>>>>>>> 20260803120000_financial_entries_tax_type.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- financial_entries: allow the 'tax' type
-- ============================================================
-- Adds a second, independent tax: a monetary amount the user records per month.
-- It does NOT replace workspaces.ad_spend_tax_percentage — the two coexist and
-- are shown side by side on /financial. The percentage one is applied over Meta
-- Ads spend and is summed into "Gasto com Ads"; this one is typed in by hand and
-- subtracted from profit on its own.
--
-- Reusing financial_entries means the period filters, the year/total aggregation
-- and the month import all keep working unchanged.

ALTER TABLE public.financial_entries
  DROP CONSTRAINT IF EXISTS financial_entries_type_check;

ALTER TABLE public.financial_entries
  ADD CONSTRAINT financial_entries_type_check
  CHECK (type = ANY (ARRAY['expense'::text, 'revenue'::text, 'tax'::text]));

-- The page always reads entries scoped to a workspace and a reference_month
-- range, so keep that path indexed as the table grows.
--
-- Built without CONCURRENTLY on purpose: migrations run inside a transaction
-- (both the Supabase SQL editor and `supabase db push`), and CONCURRENTLY is
-- rejected there. The usual reason to pay that cost — avoiding a write lock on
-- a large table — does not apply: financial_entries holds a handful of manual
-- rows per workspace per month, so the build is effectively instant.
CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_month_type
  ON public.financial_entries (workspace_id, reference_month, type);


-- >>>>>>>>>>>>>>>>>>>> 20260804120000_gtm_events.sql <<<<<<<<<<<<<<<<<<<<

-- Server-side GTM event ingestion.
--
-- The sGTM container (hosted on Stape) fires an HTTP Request tag alongside the
-- Meta CAPI tag, POSTing each event to /api/gtm/events. Rows land here and are
-- streamed to the Events page via Supabase Realtime, and aggregated into the
-- Dashboard visitors card.
--
-- Retention is 30 days, enforced by a daily cron in the backend. This table is
-- append-only and PageView-dominated, so it is the largest-volume table in the
-- schema per unit of time — the purge is what keeps it bounded.
--
-- No CREATE INDEX here: the Supabase SQL editor runs statements
-- inside a transaction block, which CONCURRENTLY forbids (error 25001). The
-- table is created empty in this same migration, so the lock is free anyway.

-- ============================================================
-- 1. Ingestion token on workspaces
-- ============================================================

-- Shared secret the sGTM tag sends in X-Sentinela-Token. Generated on demand
-- from the Integrations screen and shown in plaintext there, matching how
-- checkout webhook tokens already work in this project.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS gtm_ingest_token text;

-- Unique so the ingestion endpoint can resolve token -> workspace in one
-- indexed lookup. Partial: most workspaces will never enable this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_gtm_ingest_token
  ON public.workspaces (gtm_ingest_token)
  WHERE gtm_ingest_token IS NOT NULL;

-- ============================================================
-- 2. Events table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gtm_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_name text NOT NULL,
  event_id text,
  event_time timestamptz NOT NULL DEFAULT now(),
  value numeric,
  currency text,
  page_url text,
  has_fbp boolean NOT NULL DEFAULT false,
  has_fbc boolean NOT NULL DEFAULT false,
  -- sha256(_fbp + GTM_VISITOR_SALT). The raw cookie is never persisted, here or
  -- inside raw. Stable per browser, which is what makes repeat-visit counting
  -- possible without storing an identifier that maps back to a person.
  visitor_hash text,
  fbclid text,
  -- Payload as received, with user_data and every PII field already stripped
  -- by the backend before insert.
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gtm_events_pkey PRIMARY KEY (id),
  CONSTRAINT gtm_events_workspace_id_fkey FOREIGN KEY (workspace_id)
    REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- The Events page query: newest first within a workspace.
CREATE INDEX IF NOT EXISTS idx_gtm_events_workspace_created
  ON public.gtm_events (workspace_id, created_at DESC);

-- The visitors aggregation. INCLUDE keeps it index-only: the COUNT(DISTINCT)
-- never has to touch the heap.
CREATE INDEX IF NOT EXISTS idx_gtm_events_visits
  ON public.gtm_events (workspace_id, event_name, created_at)
  INCLUDE (visitor_hash);

-- The daily purge scans by age across all workspaces. BRIN is ~10x smaller
-- than B-tree and this table is append-only, so physical order tracks time.
CREATE INDEX IF NOT EXISTS idx_gtm_events_created_brin
  ON public.gtm_events USING BRIN (created_at);

-- Deduplication against the browser pixel.
--
-- Not a partial index (WHERE event_id IS NOT NULL) even though that would be
-- marginally smaller: ON CONFLICT cannot infer a partial index without
-- repeating its predicate, and PostgREST's on_conflict only takes a column
-- list. Postgres treats NULLs as distinct by default, so events without an
-- event_id never collide here anyway.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gtm_events_dedup
  ON public.gtm_events (workspace_id, event_id);

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.gtm_events ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner. This policy is also what gates Realtime: without
-- it the subscription would deliver nothing.
--
-- Dropped first because CREATE POLICY has no IF NOT EXISTS: without this, a
-- second run of the migration fails with 42710 while every other statement
-- here is idempotent.
DROP POLICY IF EXISTS "Users can view their own gtm events" ON public.gtm_events;

CREATE POLICY "Users can view their own gtm events" ON public.gtm_events
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- No INSERT/UPDATE/DELETE policies on purpose. Writes come from the backend
-- with the service role, which bypasses RLS; nothing should be able to forge
-- an event from a browser session.

-- ============================================================
-- 3b. Realtime
-- ============================================================

-- Adds the table to the publication Supabase Realtime listens on. Usually done
-- by hand in Database > Replication; doing it here means the feature works the
-- moment this migration runs, with no separate panel step to forget.
--
-- Only INSERT is subscribed, so the default replica identity is enough —
-- REPLICA IDENTITY FULL only matters for the old row on UPDATE/DELETE.
--
-- The exception block makes it safe to re-run: adding a table already in the
-- publication raises duplicate_object.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.gtm_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. Visitors aggregation
-- ============================================================

-- Kept separate from dashboard_metrics deliberately. That RPC already runs six
-- aggregations for every user on every dashboard load, and this metric only
-- returns rows for workspaces that send GTM events. Merging them would make
-- everyone else pay for a COUNT(DISTINCT) that is always empty.
CREATE OR REPLACE FUNCTION public.gtm_visit_metrics(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_unique_visitors int := 0;
  v_total_visits int := 0;
  v_unidentified_visits int := 0;
  v_avg numeric := 0;
BEGIN
  -- A "visit" is a PageView. Purchase, InitiateCheckout and the rest describe
  -- what happened during a visit, not a visit of their own.
  SELECT
    COUNT(*),
    COUNT(DISTINCT visitor_hash),
    COUNT(*) FILTER (WHERE visitor_hash IS NULL)
  INTO v_total_visits, v_unique_visitors, v_unidentified_visits
  FROM public.gtm_events
  WHERE workspace_id = p_workspace_id
    AND user_id = p_user_id
    AND event_name = 'PageView'
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at < p_to);

  IF v_unique_visitors > 0 THEN
    -- Identified visits only. Dividing all visits by identified visitors would
    -- inflate the average by however many events arrived without _fbp.
    v_avg := ROUND(
      (v_total_visits - v_unidentified_visits)::numeric / v_unique_visitors,
      1
    );
  END IF;

  RETURN jsonb_build_object(
    'unique_visitors', v_unique_visitors,
    'total_visits', v_total_visits,
    'avg_visits_per_visitor', v_avg,
    'unidentified_visits', v_unidentified_visits
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_visit_metrics(uuid, uuid, timestamptz, timestamptz)
  TO authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260804140000_gtm_events_retention_cron.sql <<<<<<<<<<<<<<<<<<<<

-- Retention for gtm_events: 30 days, purged daily.
--
-- Runs as a pg_cron job rather than a @Cron in the NestJS backend. The delete
-- is a pure database operation — routing it through an application server buys
-- nothing and ties the purge to that service being awake. It also keeps the
-- whole GTM ingestion path (Edge Function + this job) independent of Render.
--
-- 04:00 UTC is 01:00 in São Paulo, the quietest window for this workload.
--
-- Uses the BRIN index on created_at. PageView is the highest-volume event
-- stored, so this job is the only thing keeping the table bounded.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- cron.schedule upserts by job name, so re-running this migration reschedules
-- the existing job instead of creating a duplicate.
SELECT cron.schedule(
  'gtm-events-retention',
  '0 4 * * *',
  $$DELETE FROM public.gtm_events WHERE created_at < now() - interval '30 days'$$
);


-- >>>>>>>>>>>>>>>>>>>> 20260805120000_gtm_events_visit_number.sql <<<<<<<<<<<<<<<<<<<<

-- Visit numbering for GTM events.
--
-- The Events page needs to show, for each event, which visit of that person it
-- belongs to — first, second, and so on. Two things are needed for that: a
-- stable key for the person, and a definition of "visit".
--
-- A visit is a SESSION, not a pageview. Somebody who opens five pages in one
-- sitting made one visit, not five. Sessions are cut on 30 minutes of
-- inactivity, the same convention GA uses, and are computed over all events
-- (not just PageView) — a Purchase ten minutes after a PageView belongs to the
-- same visit.

-- ============================================================
-- 1. The person key
-- ============================================================

-- Identifier the site sends as `id_do_usuario` in the payload. Named
-- external_* because `user_id` on this table already means the workspace owner.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS external_user_id text;

-- Backfill from events already ingested: the field was landing in `raw`
-- untouched, since it is not one of the PII keys that get stripped.
UPDATE public.gtm_events
SET external_user_id = NULLIF(TRIM(raw->>'id_do_usuario'), '')
WHERE external_user_id IS NULL
  AND raw ? 'id_do_usuario';

-- One key to group by, so queries and indexes don't have to repeat the
-- fallback. Generated and STORED because it is read far more than written and
-- an expression index would not help the GROUP BY.
--
-- Falls back to visitor_hash so anonymous traffic still gets numbered: someone
-- browsing before logging in is a visitor too.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS visitor_key text
  GENERATED ALWAYS AS (COALESCE(external_user_id, visitor_hash)) STORED;

-- Covers both the session window and the per-visitor history scan.
CREATE INDEX IF NOT EXISTS idx_gtm_events_visitor_key
  ON public.gtm_events (workspace_id, visitor_key, created_at);

-- ============================================================
-- 2. Page query with visit numbers
-- ============================================================

-- Replaces the plain SELECT the Events page used. The visit number cannot be
-- computed from a page of rows alone — it depends on everything that visitor
-- did before — so the page is selected first, then only the histories of the
-- visitors on that page are scanned.
CREATE OR REPLACE FUNCTION public.gtm_events_page(
  p_user_id uuid,
  p_workspace_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT id, event_name, event_id, event_time, value, currency, page_url,
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_event_name IS NULL OR event_name = p_event_name)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  visitors AS (
    SELECT DISTINCT visitor_key FROM page WHERE visitor_key IS NOT NULL
  ),
  -- Full history of just those visitors, marking where each session starts.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
      e.created_at,
      CASE
        WHEN LAG(e.created_at) OVER w IS NULL
          OR e.created_at - LAG(e.created_at) OVER w > interval '30 minutes'
        THEN 1 ELSE 0
      END AS starts_visit
    FROM public.gtm_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.user_id = p_user_id
      AND e.visitor_key IN (SELECT visitor_key FROM visitors)
    -- id breaks ties so two events in the same millisecond number consistently.
    WINDOW w AS (PARTITION BY e.visitor_key ORDER BY e.created_at, e.id)
  ),
  numbered AS (
    SELECT
      id,
      SUM(starts_visit) OVER (
        PARTITION BY visitor_key ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visit_number
    FROM history
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'event_name', p.event_name,
        'event_id', p.event_id,
        'event_time', p.event_time,
        'value', p.value,
        'currency', p.currency,
        'page_url', p.page_url,
        'has_fbp', p.has_fbp,
        'has_fbc', p.has_fbc,
        'fbclid', p.fbclid,
        'external_user_id', p.external_user_id,
        'visitor_key', p.visitor_key,
        'visit_number', n.visit_number,
        'created_at', p.created_at
      ) AS row
    FROM page p
    LEFT JOIN numbered n ON n.id = p.id
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_events_page(uuid, uuid, timestamptz, text, int)
  TO authenticated, service_role;

-- ============================================================
-- 3. Dashboard metric, realigned to sessions
-- ============================================================

-- Was counting PageView rows and calling them visits. With the Events page now
-- showing "3rd visit" on a session basis, the same word had two meanings in the
-- same product — five pageviews in one sitting would read as five visits here
-- and one visit there. Both now mean sessions.
CREATE OR REPLACE FUNCTION public.gtm_visit_metrics(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_unique_visitors int := 0;
  v_total_visits int := 0;
  v_unidentified_events int := 0;
  v_avg numeric := 0;
BEGIN
  WITH scoped AS (
    SELECT visitor_key, created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
  ),
  sessionized AS (
    SELECT
      visitor_key,
      CASE
        WHEN LAG(created_at) OVER w IS NULL
          OR created_at - LAG(created_at) OVER w > interval '30 minutes'
        THEN 1 ELSE 0
      END AS starts_visit
    FROM scoped
    WHERE visitor_key IS NOT NULL
    WINDOW w AS (PARTITION BY visitor_key ORDER BY created_at)
  )
  SELECT
    (SELECT COUNT(DISTINCT visitor_key) FROM sessionized),
    (SELECT COALESCE(SUM(starts_visit), 0) FROM sessionized),
    (SELECT COUNT(*) FROM scoped WHERE visitor_key IS NULL)
  INTO v_unique_visitors, v_total_visits, v_unidentified_events;

  IF v_unique_visitors > 0 THEN
    v_avg := ROUND(v_total_visits::numeric / v_unique_visitors, 1);
  END IF;

  RETURN jsonb_build_object(
    'unique_visitors', v_unique_visitors,
    'total_visits', v_total_visits,
    'avg_visits_per_visitor', v_avg,
    'unidentified_visits', v_unidentified_events
  );
END;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260805140000_gtm_events_visit_per_access.sql <<<<<<<<<<<<<<<<<<<<

-- Visit = access, not session.
--
-- The previous definition cut visits on 30 minutes of inactivity, so three
-- accesses in the same sitting counted as one visit. The operator wants each
-- access counted: three accesses are three visits, however close together.
--
-- The rule is now simply: an event's visit number is how many PageViews that
-- person had up to and including that event.
--
--   - on a PageView, that is its own position — 1st, 2nd, 3rd access
--   - on a Purchase, it is how many visits the person had before buying
--
-- One count, both questions. Purchases and other events no longer need a
-- separate notion of "which session am I in".

CREATE OR REPLACE FUNCTION public.gtm_events_page(
  p_user_id uuid,
  p_workspace_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT id, event_name, event_id, event_time, value, currency, page_url,
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_event_name IS NULL OR event_name = p_event_name)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  visitors AS (
    SELECT DISTINCT visitor_key FROM page WHERE visitor_key IS NOT NULL
  ),
  -- Full history of just those visitors, flagging which rows are an access.
  -- The name is normalised because tag templates spell it PageView, pageview
  -- or page_view depending on which client produced the event.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
      e.created_at,
      CASE
        WHEN lower(replace(e.event_name, '_', '')) = 'pageview' THEN 1 ELSE 0
      END AS is_access
    FROM public.gtm_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.user_id = p_user_id
      AND e.visitor_key IN (SELECT visitor_key FROM visitors)
  ),
  numbered AS (
    SELECT
      id,
      -- Running count, inclusive of the row itself. id breaks ties so two
      -- events in the same millisecond number consistently.
      SUM(is_access) OVER (
        PARTITION BY visitor_key ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visit_number
    FROM history
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'event_name', p.event_name,
        'event_id', p.event_id,
        'event_time', p.event_time,
        'value', p.value,
        'currency', p.currency,
        'page_url', p.page_url,
        'has_fbp', p.has_fbp,
        'has_fbc', p.has_fbc,
        'fbclid', p.fbclid,
        'external_user_id', p.external_user_id,
        'visitor_key', p.visitor_key,
        'visit_number', n.visit_number,
        'created_at', p.created_at
      ) AS row
    FROM page p
    LEFT JOIN numbered n ON n.id = p.id
  ) t;
$$;

-- Realigned to the same definition. It has no caller since the Dashboard
-- visitors card was removed, but leaving it computing sessions would mean
-- "visita" meant two different things depending on which function you read.
CREATE OR REPLACE FUNCTION public.gtm_visit_metrics(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_unique_visitors int := 0;
  v_total_visits int := 0;
  v_unidentified_events int := 0;
  v_avg numeric := 0;
BEGIN
  SELECT
    COUNT(DISTINCT visitor_key) FILTER (WHERE visitor_key IS NOT NULL),
    COUNT(*) FILTER (
      WHERE visitor_key IS NOT NULL
        AND lower(replace(event_name, '_', '')) = 'pageview'
    ),
    COUNT(*) FILTER (WHERE visitor_key IS NULL)
  INTO v_unique_visitors, v_total_visits, v_unidentified_events
  FROM public.gtm_events
  WHERE workspace_id = p_workspace_id
    AND user_id = p_user_id
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at < p_to);

  IF v_unique_visitors > 0 THEN
    v_avg := ROUND(v_total_visits::numeric / v_unique_visitors, 1);
  END IF;

  RETURN jsonb_build_object(
    'unique_visitors', v_unique_visitors,
    'total_visits', v_total_visits,
    'avg_visits_per_visitor', v_avg,
    'unidentified_visits', v_unidentified_events
  );
END;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260805160000_gtm_events_visit_per_domain.sql <<<<<<<<<<<<<<<<<<<<

-- Visits are counted per subdomain.
--
-- Until now the count was global per person: someone who accessed two different
-- properties of the operator had those accesses mixed into one sequence. A
-- visit should belong to the site it happened on, so the count is now scoped to
-- the host taken from page_url — the URL up to the .com, dropping path and
-- query.
--
-- Per SUBDOMAIN, not per registered domain: loja.exemplo.com and
-- blog.exemplo.com are separate sites and get separate counts.

-- ============================================================
-- 1. The host, derived from page_url
-- ============================================================

-- Generated rather than written by the ingestion code: it is derived data, and
-- Postgres computing it means every event already stored gets the value without
-- a backfill step.
--
-- Only noise is removed — nothing that distinguishes one host from another:
--   scheme dropped   https://loja.exemplo.com/x?a=1  ->  loja.exemplo.com
--   path and query dropped
--   port dropped     exemplo.com:443                 ->  exemplo.com
--   lowercased       Exemplo.COM                     ->  exemplo.com
--
-- `www.` is deliberately KEPT: it is a subdomain like any other, and stripping
-- it would merge www.exemplo.com with exemplo.com.
--
-- A page_url that is null or unparseable yields null, which groups on its own.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS page_host text
  GENERATED ALWAYS AS (
    NULLIF(
      split_part(
        lower(
          COALESCE(
            substring(page_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/?#]+)'),
            ''
          )
        ),
        ':', 1
      ),
      ''
    )
  ) STORED;

-- The history scan now narrows by host as well.
CREATE INDEX IF NOT EXISTS idx_gtm_events_visitor_host
  ON public.gtm_events (workspace_id, visitor_key, page_host, created_at);

-- ============================================================
-- 2. Page query, counting per domain
-- ============================================================

CREATE OR REPLACE FUNCTION public.gtm_events_page(
  p_user_id uuid,
  p_workspace_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT id, event_name, event_id, event_time, value, currency, page_url,
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, page_host,
           created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_event_name IS NULL OR event_name = p_event_name)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  visitors AS (
    SELECT DISTINCT visitor_key FROM page WHERE visitor_key IS NOT NULL
  ),
  -- Full history of just those visitors, flagging which rows are an access.
  -- The name is normalised because tag templates spell it PageView, pageview
  -- or page_view depending on which client produced the event.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
      e.page_host,
      e.created_at,
      CASE
        WHEN lower(replace(e.event_name, '_', '')) = 'pageview' THEN 1 ELSE 0
      END AS is_access
    FROM public.gtm_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.user_id = p_user_id
      AND e.visitor_key IN (SELECT visitor_key FROM visitors)
  ),
  numbered AS (
    SELECT
      id,
      -- Partitioned by host: a visit belongs to the site it happened on.
      -- Running count inclusive of the row itself, so a PageView reads as its
      -- own position and a Purchase as how many visits came before it.
      SUM(is_access) OVER (
        PARTITION BY visitor_key, page_host
        ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visit_number
    FROM history
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'event_name', p.event_name,
        'event_id', p.event_id,
        'event_time', p.event_time,
        'value', p.value,
        'currency', p.currency,
        'page_url', p.page_url,
        'page_host', p.page_host,
        'has_fbp', p.has_fbp,
        'has_fbc', p.has_fbc,
        'fbclid', p.fbclid,
        'external_user_id', p.external_user_id,
        'visitor_key', p.visitor_key,
        'visit_number', n.visit_number,
        'created_at', p.created_at
      ) AS row
    FROM page p
    LEFT JOIN numbered n ON n.id = p.id
  ) t;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260805180000_gtm_events_visit_hostless.sql <<<<<<<<<<<<<<<<<<<<

-- Events without a page_url count across all hosts.
--
-- Real data exposed the gap: a Purchase arrives with no page_url, so page_host
-- is null. With the count partitioned by host, that event landed in a partition
-- of its own where no PageView exists — and reported zero visits, for someone
-- who had accessed six pages across five subdomains before buying.
--
-- The rule is now:
--   event WITH a host    -> accesses on that host, as before
--   event WITHOUT a host -> accesses across every host of that person
--
-- There is nothing to scope a hostless event to, and the total is the honest
-- answer to "how many visits before this happened". Sending page_url on the
-- purchase tag would not fix it either: the host would be the checkout page,
-- which the person visited once.

CREATE OR REPLACE FUNCTION public.gtm_events_page(
  p_user_id uuid,
  p_workspace_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT id, event_name, event_id, event_time, value, currency, page_url,
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, page_host,
           created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_event_name IS NULL OR event_name = p_event_name)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  visitors AS (
    SELECT DISTINCT visitor_key FROM page WHERE visitor_key IS NOT NULL
  ),
  -- Full history of just those visitors, flagging which rows are an access.
  -- The name is normalised because tag templates spell it PageView, pageview
  -- or page_view depending on which client produced the event.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
      e.page_host,
      e.created_at,
      CASE
        WHEN lower(replace(e.event_name, '_', '')) = 'pageview' THEN 1 ELSE 0
      END AS is_access
    FROM public.gtm_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.user_id = p_user_id
      AND e.visitor_key IN (SELECT visitor_key FROM visitors)
  ),
  numbered AS (
    SELECT
      id,
      page_host,
      -- Both counts, inclusive of the row itself; which one applies is decided
      -- below by whether the event knows what host it happened on.
      SUM(is_access) OVER (
        PARTITION BY visitor_key, page_host ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visits_on_host,
      SUM(is_access) OVER (
        PARTITION BY visitor_key ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visits_anywhere
    FROM history
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'event_name', p.event_name,
        'event_id', p.event_id,
        'event_time', p.event_time,
        'value', p.value,
        'currency', p.currency,
        'page_url', p.page_url,
        'page_host', p.page_host,
        'has_fbp', p.has_fbp,
        'has_fbc', p.has_fbc,
        'fbclid', p.fbclid,
        'external_user_id', p.external_user_id,
        'visitor_key', p.visitor_key,
        'visit_number',
          CASE WHEN p.page_host IS NULL THEN n.visits_anywhere ELSE n.visits_on_host END,
        'visit_scope',
          CASE WHEN p.page_host IS NULL THEN 'all_hosts' ELSE 'host' END,
        'created_at', p.created_at
      ) AS row
    FROM page p
    LEFT JOIN numbered n ON n.id = p.id
  ) t;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260806120000_gtm_events_date_filter_and_top_visitors.sql <<<<<<<<<<<<<<<<<<<<

-- Date filter on the Events page, and a ranking of who visits the most.

-- ============================================================
-- 1. Page query, now with a date range
-- ============================================================

CREATE OR REPLACE FUNCTION public.gtm_events_page(
  p_user_id uuid,
  p_workspace_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH page AS (
    SELECT id, event_name, event_id, event_time, value, currency, page_url,
           has_fbp, has_fbc, fbclid, external_user_id, visitor_key, page_host,
           created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_event_name IS NULL OR event_name = p_event_name)
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
    ORDER BY created_at DESC
    LIMIT p_limit
  ),
  visitors AS (
    SELECT DISTINCT visitor_key FROM page WHERE visitor_key IS NOT NULL
  ),
  -- Deliberately NOT filtered by the date range.
  --
  -- The visit number is a fact about the person's history, not about what the
  -- screen is currently showing. Narrowing this to the filter would renumber
  -- someone's 5th visit as their 1st the moment you filtered to today — the
  -- number would change meaning depending on the filter, which is worse than
  -- useless.
  history AS (
    SELECT
      e.id,
      e.visitor_key,
      e.page_host,
      e.created_at,
      CASE
        WHEN lower(replace(e.event_name, '_', '')) = 'pageview' THEN 1 ELSE 0
      END AS is_access
    FROM public.gtm_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.user_id = p_user_id
      AND e.visitor_key IN (SELECT visitor_key FROM visitors)
  ),
  numbered AS (
    SELECT
      id,
      page_host,
      SUM(is_access) OVER (
        PARTITION BY visitor_key, page_host ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visits_on_host,
      SUM(is_access) OVER (
        PARTITION BY visitor_key ORDER BY created_at, id ROWS UNBOUNDED PRECEDING
      ) AS visits_anywhere
    FROM history
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'event_name', p.event_name,
        'event_id', p.event_id,
        'event_time', p.event_time,
        'value', p.value,
        'currency', p.currency,
        'page_url', p.page_url,
        'page_host', p.page_host,
        'has_fbp', p.has_fbp,
        'has_fbc', p.has_fbc,
        'fbclid', p.fbclid,
        'external_user_id', p.external_user_id,
        'visitor_key', p.visitor_key,
        'visit_number',
          CASE WHEN p.page_host IS NULL THEN n.visits_anywhere ELSE n.visits_on_host END,
        'visit_scope',
          CASE WHEN p.page_host IS NULL THEN 'all_hosts' ELSE 'host' END,
        'created_at', p.created_at
      ) AS row
    FROM page p
    LEFT JOIN numbered n ON n.id = p.id
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_events_page(uuid, uuid, timestamptz, text, int, timestamptz, timestamptz)
  TO authenticated, service_role;

-- ============================================================
-- 2. Who visits the most
-- ============================================================

-- Counts WITHIN the selected period, unlike the per-event visit number above.
-- The question here is "who showed up most in this window", so the window is
-- the point; on an individual event the question is "which visit of theirs was
-- this", which only history can answer.
CREATE OR REPLACE FUNCTION public.gtm_top_visitors(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'visitor_key', visitor_key,
        'external_user_id', external_user_id,
        'visits', visits,
        'events', events,
        'purchases', purchases,
        'revenue', revenue,
        'hosts', hosts,
        'first_seen', first_seen,
        'last_seen', last_seen
      ) ORDER BY visits DESC, last_seen DESC
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      visitor_key,
      -- MAX because a person can appear before and after logging in; the row
      -- is grouped by visitor_key, so this picks the id when one exists.
      MAX(external_user_id) AS external_user_id,
      COUNT(*) FILTER (WHERE lower(replace(event_name, '_', '')) = 'pageview') AS visits,
      COUNT(*) AS events,
      COUNT(*) FILTER (WHERE lower(event_name) = 'purchase') AS purchases,
      COALESCE(SUM(value) FILTER (WHERE lower(event_name) = 'purchase'), 0) AS revenue,
      COUNT(DISTINCT page_host) AS hosts,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND visitor_key IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
    GROUP BY visitor_key
    ORDER BY visits DESC, last_seen DESC
    -- Limited before aggregating into JSON, so only the top rows are built.
    LIMIT p_limit
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_top_visitors(uuid, uuid, timestamptz, timestamptz, int)
  TO authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260806140000_gtm_top_visitors_by_event.sql <<<<<<<<<<<<<<<<<<<<

-- Breakdown by event name in the visitor ranking.
--
-- Visits alone say how often somebody came, not how far they got. With the
-- count per event name the row reads as a funnel: six page_view, one
-- add_to_cart, one begin_checkout, one purchase.
--
-- Returned as a jsonb object rather than fixed columns because the set of event
-- names is whatever the sGTM triggers send — it is not knowable here, and it
-- changes when a tag is added.

CREATE OR REPLACE FUNCTION public.gtm_top_visitors(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT visitor_key, external_user_id, event_name, value, page_host, created_at
    FROM public.gtm_events
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND visitor_key IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
  ),
  totals AS (
    SELECT
      visitor_key,
      -- MAX because a person can appear before and after logging in; grouped by
      -- visitor_key, this picks the id when one exists.
      MAX(external_user_id) AS external_user_id,
      COUNT(*) FILTER (WHERE lower(replace(event_name, '_', '')) = 'pageview') AS visits,
      COUNT(*) AS events,
      COUNT(*) FILTER (WHERE lower(event_name) = 'purchase') AS purchases,
      COALESCE(SUM(value) FILTER (WHERE lower(event_name) = 'purchase'), 0) AS revenue,
      COUNT(DISTINCT page_host) AS hosts,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen
    FROM scoped
    GROUP BY visitor_key
    ORDER BY visits DESC, last_seen DESC
    -- Limited before the breakdown runs, so it only builds the top rows.
    LIMIT p_limit
  ),
  by_name AS (
    SELECT counted.visitor_key, jsonb_object_agg(counted.event_name, counted.cnt) AS events_by_name
    FROM (
      SELECT visitor_key, event_name, COUNT(*) AS cnt
      FROM scoped
      WHERE visitor_key IN (SELECT visitor_key FROM totals)
      GROUP BY visitor_key, event_name
    ) counted
    GROUP BY counted.visitor_key
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'visitor_key', t.visitor_key,
        'external_user_id', t.external_user_id,
        'visits', t.visits,
        'events', t.events,
        'purchases', t.purchases,
        'revenue', t.revenue,
        'hosts', t.hosts,
        'events_by_name', COALESCE(b.events_by_name, '{}'::jsonb),
        'first_seen', t.first_seen,
        'last_seen', t.last_seen
      ) ORDER BY t.visits DESC, t.last_seen DESC
    ),
    '[]'::jsonb
  )
  FROM totals t
  LEFT JOIN by_name b ON b.visitor_key = t.visitor_key;
$$;

GRANT EXECUTE ON FUNCTION public.gtm_top_visitors(uuid, uuid, timestamptz, timestamptz, int)
  TO authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260813120000_workspaces_vturb_token.sql <<<<<<<<<<<<<<<<<<<<

-- VTurb Analytics API token, per workspace.
--
-- Stored encrypted (EncryptionService, AES-256-GCM) like the Facebook access
-- tokens, and never returned to the browser: every VTurb call is proxied by the
-- backend. A key in the frontend bundle would be readable by anyone who opens
-- devtools, and VTurb has no CORS allowance for browser calls anyway.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS vturb_api_token text;


-- >>>>>>>>>>>>>>>>>>>> 20260817000000_rpcs_sem_blocked_by_limit.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- RPCs de agregacao sem blocked_by_limit
-- ============================================================
-- A coluna sales.blocked_by_limit foi derrubada junto com a cobranca, mas as
-- tres funcoes de agregacao continuavam filtrando por ela. O Postgres so
-- reclama quando a funcao roda, entao a migration passou e o erro apareceu
-- na tela: dashboard_metrics devolvia
--   42703: column "blocked_by_limit" does not exist
-- e o dashboard mostrava tudo zerado, com os dados ja gravados no banco.
--
-- Este arquivo recria as tres funcoes identicas as originais, sem esse filtro.
-- Nada mais muda: mesma assinatura, mesmas chaves de retorno.

-- >>> de 20260428100000_dashboard_aggregation_rpcs.sql

CREATE OR REPLACE FUNCTION public.extract_numeric_ad_id(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(p)
  FROM regexp_split_to_table(coalesce(raw, ''), '[|/]') AS p
  WHERE trim(p) ~ '^[0-9]{6,}$'
  LIMIT 1;
$$;

-- ============================================================
-- Dashboard aggregations: lifetime + period (gross, count, chart, regions, recent).
-- One round trip returns every shape the dashboard endpoint needs.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_gross numeric := 0;
  v_count int := 0;
  v_lifetime numeric := 0;
  v_chart jsonb := '[]'::jsonb;
  v_regions jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  -- Period: gross revenue + sales count (approved only).
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO v_gross, v_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names));

  -- Lifetime: ignores period/checkout/product filters by design (drives the milestone bar).
  SELECT COALESCE(SUM(amount), 0)
  INTO v_lifetime
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id);

  -- Chart: revenue per UTC day, ascending.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', r) ORDER BY d), '[]'::jsonb)
  INTO v_chart
  FROM (
    SELECT to_char(sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
           SUM(amount) AS r
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY d
  ) c;

  -- Regions: by customer_state, sorted by sales DESC. Percentage is computed in TS.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'state', state,
    'sales', sales_count,
    'revenue', revenue
  ) ORDER BY sales_count DESC), '[]'::jsonb)
  INTO v_regions
  FROM (
    SELECT customer_state AS state,
           COUNT(*) AS sales_count,
           SUM(amount) AS revenue
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND customer_state IS NOT NULL
      AND customer_state <> ''
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY customer_state
  ) r;

  -- Recent: 9 most recent approved sales (id, product_name, sold_at, amount).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'product_name', product_name,
    'sold_at', sold_at,
    'amount', amount
  ) ORDER BY sold_at DESC, id DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT id, product_name, sold_at, amount
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    ORDER BY sold_at DESC, id DESC
    LIMIT 9
  ) rs;

  RETURN jsonb_build_object(
    'gross_revenue', v_gross,
    'sales_count', v_count,
    'lifetime_revenue', v_lifetime,
    'chart_data', v_chart,
    'regions', v_regions,
    'recent_sales', v_recent
  );
END;
$$;

-- ============================================================
-- LC sales aggregated by ad_id (or extracted from utm_term/utm_content).
-- Feeds campaign/adset/ad attribution maps.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sales_grouped_by_ad(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  ad_id text,
  approved_count int,
  approved_revenue numeric,
  refunded_count int,
  refunded_revenue numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH extracted AS (
    SELECT
      COALESCE(
        public.extract_numeric_ad_id(s.ad_id),
        public.extract_numeric_ad_id(s.utm_term),
        public.extract_numeric_ad_id(s.utm_content)
      ) AS extracted_ad_id,
      s.status,
      s.amount
    FROM public.sales s
    WHERE s.user_id = p_user_id
      AND s.status IN ('approved', 'refunded')
      AND (s.ad_id IS NOT NULL OR s.utm_content IS NOT NULL OR s.utm_term IS NOT NULL)
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
  )
  SELECT
    extracted_ad_id,
    COUNT(*) FILTER (WHERE status = 'approved')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::numeric,
    COUNT(*) FILTER (WHERE status = 'refunded')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric
  FROM extracted
  WHERE extracted_ad_id IS NOT NULL
  GROUP BY extracted_ad_id;
$$;

-- ============================================================
-- Permissions.
-- These functions take p_user_id directly; granting frontend roles would let
-- the anon/authenticated roles read any user's data. Lock them to service_role.
-- (service_role bypasses RLS anyway, so the GRANT is just for PostgREST's
-- function-execution check.)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.extract_numeric_ad_id(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.extract_numeric_ad_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) TO service_role;

-- >>> de 20260508120000_sales_summary_rpc_v2.sql

CREATE OR REPLACE FUNCTION public.sales_summary(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_q_pattern text := CASE WHEN p_q IS NULL OR length(trim(p_q)) = 0 THEN NULL ELSE '%' || trim(p_q) || '%' END;
  v_approved_count int := 0;
  v_gross_revenue numeric := 0;
  v_avg_ticket numeric := 0;
  v_refunds_count int := 0;
  v_total_count int := 0;
  v_refund_rate numeric := 0;
  v_by_product jsonb := '[]'::jsonb;
  v_by_ad jsonb := '[]'::jsonb;
  v_refunds_by_state jsonb := '[]'::jsonb;
  v_refunded_sample jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_approved_count, v_gross_revenue
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  SELECT COUNT(*)
  INTO v_refunds_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'refunded'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  v_total_count := v_approved_count + v_refunds_count;
  IF v_total_count > 0 THEN
    v_refund_rate := (v_refunds_count::numeric / v_total_count) * 100;
  END IF;

  IF v_approved_count > 0 THEN
    v_avg_ticket := v_gross_revenue / v_approved_count;
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT jsonb_build_object(
      'product_name', COALESCE(product_name, 'Sem produto'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(amount), 0)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY product_name
    ORDER BY SUM(amount) DESC NULLS LAST
    LIMIT 10
  ) t;

  -- Top ads (approved sales, by quantity).
  -- Grouping key matches the pre-server-aggregation behavior:
  --   utm_content (UTM from the click) → ads.name → ad_id (raw) → 'Sem anúncio'
  -- ad_set / campaign names are intentionally NOT used as fallbacks here.
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_ad
  FROM (
    SELECT jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(s.utm_content), ''), a.name, NULLIF(s.ad_id, ''), 'Sem anúncio'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(s.amount), 0)
    ) AS row
    FROM public.sales s
    LEFT JOIN public.ads a ON s.ad_internal_id = a.id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
      AND (p_checkout_ids IS NULL OR s.checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR s.product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR s.campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR s.customer_email ILIKE v_q_pattern
        OR s.customer_name ILIKE v_q_pattern
        OR s.product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunds_by_state
  FROM (
    SELECT jsonb_build_object(
      'state', COALESCE(UPPER(TRIM(customer_state)), 'N/A'),
      'count', COUNT(*)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 3
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunded_sample
  FROM (
    SELECT jsonb_build_object(
      'customer_name', customer_name,
      'customer_state', customer_state,
      'amount', amount
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    ORDER BY sold_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object(
    'metrics', jsonb_build_object(
      'approved_count', v_approved_count,
      'gross_revenue', v_gross_revenue,
      'avg_ticket', v_avg_ticket,
      'refunds_count', v_refunds_count,
      'refund_rate', v_refund_rate
    ),
    'by_product', v_by_product,
    'by_ad', v_by_ad,
    'refunds_by_state', v_refunds_by_state,
    'refunded_sample', v_refunded_sample
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sales_summary(uuid, uuid, timestamptz, timestamptz, text[], uuid[], text[], uuid[], text) TO authenticated, service_role;



-- >>>>>>>>>>>>>>>>>>>> 20260819000000_vendas_por_item.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Uma linha por produto, contando pedidos e não itens
-- ============================================================
-- Uma compra na Hubla traz o produto principal e os order bumps. O pedido é
-- um; os produtos são vários.
--
-- A tentativa anterior gravava UMA linha com o total e desmembrava na leitura,
-- a partir de metadata.items. Isso resolvia o painel de produtos e deixava de
-- fora "Vendas em tempo real" e a lista de vendas — que leem linhas, não
-- metadata. Consertar os três lugares na leitura seria remendar três vezes o
-- mesmo desencontro entre o modelo e a tela.
--
-- Agora cada produto é uma linha de venda, com seu valor. O que precisa ser
-- por pedido — a contagem de "Vendas aprovadas" — passa a contar pedidos
-- distintos, via order_external_id. O faturamento continua sendo a soma das
-- linhas, e dá o mesmo total de antes.

BEGIN;

-- ------------------------------------------------------------
-- 1. Colunas que ligam a linha ao pedido
-- ------------------------------------------------------------
ALTER TABLE public.sales
  -- O id da fatura na plataforma. Todas as linhas da mesma compra compartilham
  -- este valor; é ele que faz a contagem enxergar um pedido só.
  ADD COLUMN IF NOT EXISTS order_external_id text,
  ADD COLUMN IF NOT EXISTS is_order_bump     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sales.order_external_id IS
  'Id do pedido na plataforma. Linhas da mesma compra repetem este valor; a contagem de vendas usa DISTINCT sobre ele.';

-- A contagem por pedido roda em toda carga do dashboard, filtrada por período.
CREATE INDEX IF NOT EXISTS idx_sales_order_external
  ON public.sales (order_external_id, sold_at DESC)
  WHERE order_external_id IS NOT NULL;

-- Venda antiga não tem pedido: ela própria é o pedido.
UPDATE public.sales
SET order_external_id = external_id
WHERE order_external_id IS NULL
  AND external_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. dashboard_metrics: contar pedidos, somar linhas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_gross numeric := 0;
  v_count int := 0;
  v_lifetime numeric := 0;
  v_chart jsonb := '[]'::jsonb;
  v_regions jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  -- Faturamento soma as LINHAS; a contagem usa PEDIDOS distintos. É o que faz
  -- uma compra com dois order bumps valer R$ 218,28 e contar como 1 venda.
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(DISTINCT COALESCE(order_external_id, id::text))
  INTO v_gross, v_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names));

  SELECT COALESCE(SUM(amount), 0)
  INTO v_lifetime
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', r) ORDER BY d), '[]'::jsonb)
  INTO v_chart
  FROM (
    SELECT to_char(sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
           SUM(amount) AS r
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY d
  ) c;

  -- Região conta pedidos pelo mesmo motivo da contagem acima: senão uma compra
  -- com dois bumps apareceria como três vendas em São Paulo.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'state', state,
    'sales', sales_count,
    'revenue', revenue
  ) ORDER BY sales_count DESC), '[]'::jsonb)
  INTO v_regions
  FROM (
    SELECT customer_state AS state,
           COUNT(DISTINCT COALESCE(order_external_id, id::text)) AS sales_count,
           SUM(amount) AS revenue
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND customer_state IS NOT NULL
      AND customer_state <> ''
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    GROUP BY customer_state
  ) r;

  -- "Vendas em tempo real" mostra LINHAS: é exatamente onde o cliente quer ver
  -- o principal e os bumps separados, cada um com seu valor.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'product_name', product_name,
    'sold_at', sold_at,
    'amount', amount
  ) ORDER BY sold_at DESC, id DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT id, product_name, sold_at, amount
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    ORDER BY sold_at DESC, id DESC
    LIMIT 9
  ) rs;

  RETURN jsonb_build_object(
    'gross_revenue', v_gross,
    'sales_count', v_count,
    'lifetime_revenue', v_lifetime,
    'chart_data', v_chart,
    'regions', v_regions,
    'recent_sales', v_recent
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. sales_summary: volta ao agrupamento simples
-- ------------------------------------------------------------
-- Com uma linha por produto, o painel "Vendas por Produto" volta a ser um
-- GROUP BY product_name comum. O LATERAL sobre metadata.items da tentativa
-- anterior sai daqui — era ele que quebrava a tela com 42803.
CREATE OR REPLACE FUNCTION public.sales_summary(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_checkout_ids uuid[] DEFAULT NULL,
  p_product_names text[] DEFAULT NULL,
  p_campaign_ids uuid[] DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_q_pattern text := CASE WHEN p_q IS NULL OR length(trim(p_q)) = 0 THEN NULL ELSE '%' || trim(p_q) || '%' END;
  v_approved_count int := 0;
  v_gross_revenue numeric := 0;
  v_avg_ticket numeric := 0;
  v_refunds_count int := 0;
  v_total_count int := 0;
  v_refund_rate numeric := 0;
  v_by_product jsonb := '[]'::jsonb;
  v_by_ad jsonb := '[]'::jsonb;
  v_refunds_by_state jsonb := '[]'::jsonb;
  v_refunded_sample jsonb := '[]'::jsonb;
BEGIN
  -- Pedidos distintos, pelo mesmo motivo do dashboard: o ticket medio de uma
  -- compra e o valor do pedido, nao o de cada item dela.
  SELECT COUNT(DISTINCT COALESCE(order_external_id, id::text)), COALESCE(SUM(amount), 0)
  INTO v_approved_count, v_gross_revenue
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'approved'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  SELECT COUNT(DISTINCT COALESCE(order_external_id, id::text))
  INTO v_refunds_count
  FROM public.sales
  WHERE user_id = p_user_id
    AND status = 'refunded'
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_from IS NULL OR sold_at >= p_from)
    AND (p_to IS NULL OR sold_at < p_to)
    AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
    AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
    AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
    AND (
      v_q_pattern IS NULL
      OR customer_email ILIKE v_q_pattern
      OR customer_name ILIKE v_q_pattern
      OR product_name ILIKE v_q_pattern
    );

  v_total_count := v_approved_count + v_refunds_count;
  IF v_total_count > 0 THEN
    v_refund_rate := (v_refunds_count::numeric / v_total_count) * 100;
  END IF;

  IF v_approved_count > 0 THEN
    v_avg_ticket := v_gross_revenue / v_approved_count;
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT jsonb_build_object(
      'product_name', COALESCE(product_name, 'Sem produto'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(amount), 0)
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY product_name
    ORDER BY SUM(amount) DESC NULLS LAST
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_by_ad
  FROM (
    SELECT jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(s.utm_content), ''), a.name, NULLIF(s.ad_id, ''), 'Sem anúncio'),
      'count', COUNT(*),
      'revenue', COALESCE(SUM(s.amount), 0)
    ) AS row
    FROM public.sales s
    LEFT JOIN public.ads a ON s.ad_internal_id = a.id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
      AND (p_checkout_ids IS NULL OR s.checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR s.product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR s.campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR s.customer_email ILIKE v_q_pattern
        OR s.customer_name ILIKE v_q_pattern
        OR s.product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunds_by_state
  FROM (
    SELECT jsonb_build_object(
      'state', COALESCE(UPPER(TRIM(customer_state)), 'N/A'),
      'count', COUNT(DISTINCT COALESCE(order_external_id, id::text))
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 3
  ) t;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
  INTO v_refunded_sample
  FROM (
    SELECT jsonb_build_object(
      'customer_name', customer_name,
      'customer_state', customer_state,
      'amount', amount
    ) AS row
    FROM public.sales
    WHERE user_id = p_user_id
      AND status = 'refunded'
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND (p_from IS NULL OR sold_at >= p_from)
      AND (p_to IS NULL OR sold_at < p_to)
      AND (p_checkout_ids IS NULL OR checkout_integration_id = ANY(p_checkout_ids))
      AND (p_product_names IS NULL OR product_name = ANY(p_product_names))
      AND (p_campaign_ids IS NULL OR campaign_id = ANY(p_campaign_ids))
      AND (
        v_q_pattern IS NULL
        OR customer_email ILIKE v_q_pattern
        OR customer_name ILIKE v_q_pattern
        OR product_name ILIKE v_q_pattern
      )
    ORDER BY sold_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object(
    'metrics', jsonb_build_object(
      'approved_count', v_approved_count,
      'gross_revenue', v_gross_revenue,
      'avg_ticket', v_avg_ticket,
      'refunds_count', v_refunds_count,
      'refund_rate', v_refund_rate
    ),
    'by_product', v_by_product,
    'by_ad', v_by_ad,
    'refunds_by_state', v_refunds_by_state,
    'refunded_sample', v_refunded_sample
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_metrics(uuid, uuid, timestamptz, timestamptz, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_summary(uuid, uuid, timestamptz, timestamptz, text[], uuid[], text[], uuid[], text) TO authenticated, service_role;

COMMIT;


-- >>>>>>>>>>>>>>>>>>>> 20260820000000_campanhas_contam_pedidos.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Campanhas: contar pedidos, somar linhas
-- ============================================================
-- Mesma regra já aplicada ao dashboard e à tela de vendas, agora na atribuição
-- por anúncio, que alimenta /campaigns.
--
-- Com uma linha por produto, uma compra com dois order bumps contava três
-- vendas para o mesmo anúncio. O faturamento estava certo — a soma das linhas
-- dá o valor do pedido — mas a contagem inflava, e com ela o CPA e a taxa de
-- conversão da campanha.
--
-- Agora a contagem usa DISTINCT sobre order_external_id: o anúncio recebe uma
-- venda, com o valor somado dos produtos que ela trouxe.

CREATE OR REPLACE FUNCTION public.sales_grouped_by_ad(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  ad_id text,
  approved_count int,
  approved_revenue numeric,
  refunded_count int,
  refunded_revenue numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH extracted AS (
    SELECT
      COALESCE(
        public.extract_numeric_ad_id(s.ad_id),
        public.extract_numeric_ad_id(s.utm_term),
        public.extract_numeric_ad_id(s.utm_content)
      ) AS extracted_ad_id,
      s.status,
      s.amount,
      -- A chave do pedido. Venda de plataforma sem order bump recebe o próprio
      -- external_id no backfill, então cai no caso de sempre: uma linha, um
      -- pedido.
      COALESCE(s.order_external_id, s.id::text) AS pedido
    FROM public.sales s
    WHERE s.user_id = p_user_id
      AND s.status IN ('approved', 'refunded')
      AND (s.ad_id IS NOT NULL OR s.utm_content IS NOT NULL OR s.utm_term IS NOT NULL)
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
  )
  SELECT
    extracted_ad_id,
    COUNT(DISTINCT pedido) FILTER (WHERE status = 'approved')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::numeric,
    COUNT(DISTINCT pedido) FILTER (WHERE status = 'refunded')::int,
    COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric
  FROM extracted
  WHERE extracted_ad_id IS NOT NULL
  GROUP BY extracted_ad_id;
$$;

REVOKE EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sales_grouped_by_ad(uuid, uuid, timestamptz, timestamptz) TO service_role;


-- >>>>>>>>>>>>>>>>>>>> 20260822000000_uma_conexao_por_conta_de_anuncio.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Facebook: uma conexão por conta de anúncio, não por usuário
-- ============================================================
-- A tabela nasceu em fevereiro com UNIQUE (user_id): na época era uma conexão
-- por pessoa. Depois o produto passou a guardar uma linha por conta de
-- anúncio — é o que o código faz hoje, tanto ao conectar quanto ao atualizar —
-- mas nenhuma migration derrubou a trava antiga.
--
-- O efeito: a primeira conta entrava e todas as outras batiam em
--
--   23505 duplicate key value violates unique constraint
--         "facebook_connections_user_id_key"
--
-- O token via cinco contas e o painel gravava uma. O erro ficava no log do
-- servidor, e na tela só faltava a conta.
--
-- A trava certa é (user_id, ad_account_id): a mesma conta não se repete para a
-- mesma pessoa, e continuam cabendo quantas contas o token trouxer. É também o
-- que o código já assume ao montar o mapa de existentes por ad_account_id.

ALTER TABLE public.facebook_connections
  DROP CONSTRAINT IF EXISTS facebook_connections_user_id_key;

-- Defensivo: a linha duplicada impediria a criação do índice. Não existe hoje,
-- mas a migration precisa poder rodar em qualquer cópia do banco.
DELETE FROM public.facebook_connections a
USING public.facebook_connections b
WHERE a.user_id = b.user_id
  AND a.ad_account_id = b.ad_account_id
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_connections_user_account
  ON public.facebook_connections (user_id, ad_account_id);


-- >>>>>>>>>>>>>>>>>>>> 20260928000000_rastreio_de_visitantes.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Rastreio de visitantes: do clique na página de vendas até a venda
-- ============================================================
-- Até aqui o painel só sabia de uma venda quando o webhook do checkout
-- chegava. Quem visitou a página e não comprou não existia.
--
-- O snippet (GET /api/t/tracker.js) grava a visita; o webhook, quando chega,
-- tenta achar a sessão que levou à compra. Três tabelas:
--
--   tracking_visitors  uma linha por navegador (cookie _stl_vid, 1 ano)
--   tracking_sessions  uma linha por visita (cookie _stl_sid, 30 min)
--   tracking_events    cada pageview, clique no checkout, saída, evento custom
--
-- Os nomes levam o prefixo tracking_ de propósito: "sessions" sozinho se
-- confunde com auth.sessions do Supabase.
--
-- Sem IP. O snippet não coleta dado pessoal, e o IP do visitante só serviria
-- para casar por "impressão digital" — que não funciona aqui, porque o webhook
-- de venda traz o IP do servidor da plataforma, não o do comprador. A cidade e
-- o estado vêm dos headers de geolocalização da Vercel, sem guardar o IP.

BEGIN;

-- ------------------------------------------------------------
-- 1. Visitantes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_sessions INT NOT NULL DEFAULT 1,
  total_pageviews INT NOT NULL DEFAULT 0,
  first_utm_source TEXT,
  first_utm_medium TEXT,
  first_utm_campaign TEXT,
  first_utm_content TEXT,
  first_referrer TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  device_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_visitors_workspace_last_seen
  ON public.tracking_visitors (workspace_id, last_seen_at DESC);

-- ------------------------------------------------------------
-- 2. Sessões
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Última atividade vista. A sessão não "termina" de forma explícita: o
  -- cookie expira depois de 30 minutos parado.
  ended_at TIMESTAMPTZ,
  -- Do início da sessão até a última saída de página (page_exit).
  duration_seconds INT,

  -- UTMs da entrada. Primeiro toque dentro da sessão: um pageview seguinte
  -- sem UTM não apaga o que veio na chegada.
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbclid TEXT,
  gclid TEXT,
  ad_id TEXT,

  landing_page TEXT NOT NULL,
  referrer TEXT,

  user_agent TEXT,
  screen_resolution TEXT,
  language TEXT,
  device_type TEXT,
  country TEXT,
  region TEXT,
  city TEXT,

  pageviews INT NOT NULL DEFAULT 0,
  had_checkout_click BOOLEAN NOT NULL DEFAULT FALSE,
  checkout_clicked_at TIMESTAMPTZ,

  -- Preenchido pelo casamento com a venda (tracking_match_sale).
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  match_method TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_workspace_started
  ON public.tracking_sessions (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_fbclid
  ON public.tracking_sessions (workspace_id, fbclid) WHERE fbclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_utm_match
  ON public.tracking_sessions (workspace_id, utm_source, utm_campaign, utm_content)
  WHERE utm_content IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_sale
  ON public.tracking_sessions (sale_id) WHERE sale_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Eventos
-- ------------------------------------------------------------
-- A tabela que mais cresce. Sem particionamento por enquanto: a retenção de
-- 90 dias (seção 8) é o que a mantém limitada.
CREATE TABLE IF NOT EXISTS public.tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  -- pageview, checkout_click, page_exit, custom
  event_type TEXT NOT NULL,
  -- Nome livre, para eventos custom (sentinel('track', 'video_play')).
  event_name TEXT,
  url TEXT,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_session
  ON public.tracking_events (workspace_id, session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tracking_events_type
  ON public.tracking_events (workspace_id, event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tracking_events_occurred_brin
  ON public.tracking_events USING brin (occurred_at);

-- ------------------------------------------------------------
-- 4. Vínculo na venda
-- ------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS matched_session_at TIMESTAMPTZ;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS match_method TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_session
  ON public.sales (workspace_id, session_id) WHERE session_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------
-- Só leitura, pelo dono da área. Toda escrita vem do backend com a service
-- role, que ignora RLS. Não há política de INSERT/UPDATE para usuários: o
-- snippet não tem login, e liberar escrita para "authenticated" só abriria
-- espaço para gravar visita falsa pelo navegador.
ALTER TABLE public.tracking_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono le os visitantes da area" ON public.tracking_visitors;
CREATE POLICY "Dono le os visitantes da area" ON public.tracking_visitors
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Dono le as sessoes da area" ON public.tracking_sessions;
CREATE POLICY "Dono le as sessoes da area" ON public.tracking_sessions
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Dono le os eventos da area" ON public.tracking_events;
CREATE POLICY "Dono le os eventos da area" ON public.tracking_events
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- ------------------------------------------------------------
-- 6. Ingestão: um lote do snippet numa ida só ao banco
-- ------------------------------------------------------------
-- O /collect roda numa função da Vercel, que congela assim que responde. Não
-- dá para responder antes e gravar depois, então a gravação precisa ser
-- rápida: visitante, sessão e eventos numa única chamada, em vez de três
-- idas e voltas pelo PostgREST.
--
-- p_ctx:    { user_agent, screen_resolution, language, device_type,
--             country, region, city }
-- p_events: [{ type, name, url, referrer, utm_source, utm_medium,
--              utm_campaign, utm_content, utm_term, fbclid, gclid, ad_id,
--              duration_seconds, page_id, props }]
--
-- O backend já normalizou tudo (tamanhos, tipos, vazios viram null). Esta
-- função só é executável pela service role.
CREATE OR REPLACE FUNCTION public.tracking_ingest(
  p_workspace_id uuid,
  p_visitor_id text,
  p_session_id text,
  p_ctx jsonb,
  p_events jsonb
)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_first jsonb;
  v_pageviews int;
  v_clicked boolean;
  v_exit boolean;
  v_exit_duration int;
  v_new_session boolean;
  v_count int;
BEGIN
  IF p_events IS NULL OR jsonb_array_length(p_events) = 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id) THEN
    RETURN 0;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE e->>'type' = 'pageview'),
    COALESCE(bool_or(e->>'type' = 'checkout_click'), false),
    COALESCE(bool_or(e->>'type' = 'page_exit'), false),
    MAX((e->>'duration_seconds')::int) FILTER (WHERE e->>'type' = 'page_exit')
  INTO v_pageviews, v_clicked, v_exit, v_exit_duration
  FROM jsonb_array_elements(p_events) e;

  -- A sessão nasce do primeiro pageview do lote. Sem pageview (um page_exit
  -- que chegou sozinho), vale o primeiro evento: ainda tem a URL.
  SELECT e INTO v_first
  FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, i)
  ORDER BY (e->>'type' = 'pageview') DESC, i
  LIMIT 1;

  INSERT INTO tracking_sessions AS s (
    workspace_id, visitor_id, session_id, started_at, ended_at, duration_seconds,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, ad_id, landing_page, referrer,
    user_agent, screen_resolution, language, device_type, country, region, city,
    pageviews, had_checkout_click, checkout_clicked_at
  ) VALUES (
    p_workspace_id, p_visitor_id, p_session_id, v_now, v_now,
    CASE WHEN v_exit THEN v_exit_duration END,
    v_first->>'utm_source', v_first->>'utm_medium', v_first->>'utm_campaign',
    v_first->>'utm_content', v_first->>'utm_term',
    v_first->>'fbclid', v_first->>'gclid', v_first->>'ad_id',
    COALESCE(v_first->>'url', ''), v_first->>'referrer',
    p_ctx->>'user_agent', p_ctx->>'screen_resolution', p_ctx->>'language',
    p_ctx->>'device_type', p_ctx->>'country', p_ctx->>'region', p_ctx->>'city',
    v_pageviews, v_clicked, CASE WHEN v_clicked THEN v_now END
  )
  ON CONFLICT (workspace_id, session_id) DO UPDATE SET
    ended_at = v_now,
    pageviews = s.pageviews + EXCLUDED.pageviews,
    had_checkout_click = s.had_checkout_click OR EXCLUDED.had_checkout_click,
    checkout_clicked_at = COALESCE(s.checkout_clicked_at, EXCLUDED.checkout_clicked_at),
    -- Duração = do início da sessão até a saída mais recente. Medida pelo
    -- relógio do servidor, que não depende do relógio do visitante.
    duration_seconds = CASE
      WHEN v_exit THEN GREATEST(
        COALESCE(s.duration_seconds, 0),
        COALESCE(EXCLUDED.duration_seconds, 0),
        EXTRACT(EPOCH FROM (v_now - s.started_at))::int
      )
      ELSE s.duration_seconds
    END,
    utm_source   = COALESCE(s.utm_source,   EXCLUDED.utm_source),
    utm_medium   = COALESCE(s.utm_medium,   EXCLUDED.utm_medium),
    utm_campaign = COALESCE(s.utm_campaign, EXCLUDED.utm_campaign),
    utm_content  = COALESCE(s.utm_content,  EXCLUDED.utm_content),
    utm_term     = COALESCE(s.utm_term,     EXCLUDED.utm_term),
    fbclid       = COALESCE(s.fbclid,       EXCLUDED.fbclid),
    gclid        = COALESCE(s.gclid,        EXCLUDED.gclid),
    ad_id        = COALESCE(s.ad_id,        EXCLUDED.ad_id),
    landing_page = CASE WHEN s.landing_page = '' THEN EXCLUDED.landing_page ELSE s.landing_page END
  RETURNING (xmax = 0) INTO v_new_session;

  INSERT INTO tracking_visitors AS v (
    workspace_id, visitor_id, first_seen_at, last_seen_at, total_sessions, total_pageviews,
    first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_referrer,
    country, region, city, device_type
  ) VALUES (
    p_workspace_id, p_visitor_id, v_now, v_now, 1, v_pageviews,
    v_first->>'utm_source', v_first->>'utm_medium', v_first->>'utm_campaign',
    v_first->>'utm_content', v_first->>'referrer',
    p_ctx->>'country', p_ctx->>'region', p_ctx->>'city', p_ctx->>'device_type'
  )
  ON CONFLICT (workspace_id, visitor_id) DO UPDATE SET
    last_seen_at = v_now,
    total_pageviews = v.total_pageviews + EXCLUDED.total_pageviews,
    total_sessions = v.total_sessions + CASE WHEN v_new_session THEN 1 ELSE 0 END,
    country = COALESCE(EXCLUDED.country, v.country),
    region = COALESCE(EXCLUDED.region, v.region),
    city = COALESCE(EXCLUDED.city, v.city),
    device_type = COALESCE(EXCLUDED.device_type, v.device_type);

  INSERT INTO tracking_events (workspace_id, session_id, visitor_id, event_type, event_name, url, metadata, occurred_at)
  SELECT
    p_workspace_id, p_session_id, p_visitor_id,
    e->>'type', e->>'name', e->>'url',
    NULLIF(jsonb_strip_nulls(jsonb_build_object(
      'duration_seconds', e->'duration_seconds',
      'page_id', e->'page_id',
      'referrer', e->'referrer',
      'props', e->'props'
    )), '{}'::jsonb),
    v_now
  FROM jsonb_array_elements(p_events) e;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_ingest(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_ingest(uuid, text, text, jsonb, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 7. Casamento venda ↔ sessão
-- ------------------------------------------------------------
-- Chamado logo depois de a venda ser gravada pelo webhook. Nunca muda a
-- atribuição por UTM (campaign_id, ad_set_id, ad_internal_id): só liga a
-- venda à visita, para mostrar a jornada e medir conversão.
--
-- Ordem, do mais para o menos confiável:
--
--   order   outra linha do mesmo pedido já foi casada (order bump da Hubla)
--   sck     o snippet escreveu stl_<session_id> no link do checkout, e a
--           plataforma devolveu no webhook. Casamento exato.
--   fbclid  o mesmo clique do Facebook na venda e na sessão.
--   utm_exact  source + campaign + content iguais, com clique no checkout
--           nas 24h anteriores à venda — e SÓ se houver uma única sessão
--           candidata. Com duas pessoas vindas do mesmo anúncio, escolher
--           uma seria chute; melhor deixar sem vínculo do que mostrar a
--           jornada de outra pessoa.
--
-- Não há casamento por e-mail nem por IP + user agent: o webhook traz o IP do
-- servidor da plataforma, não o do comprador, e o snippet não coleta e-mail.
CREATE OR REPLACE FUNCTION public.tracking_match_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_session tracking_sessions%ROWTYPE;
  v_method text;
  v_text text;
  v_sid text;
  v_fbclid text;
  v_candidates int;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.workspace_id IS NULL OR v_sale.session_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Mesmo pedido, outra linha já casada.
  IF v_sale.order_external_id IS NOT NULL THEN
    SELECT s.* INTO v_session
    FROM sales o
    JOIN tracking_sessions s
      ON s.workspace_id = o.workspace_id AND s.session_id = o.session_id
    WHERE o.workspace_id = v_sale.workspace_id
      AND o.order_external_id = v_sale.order_external_id
      AND o.id <> v_sale.id
      AND o.session_id IS NOT NULL
    LIMIT 1;
    IF FOUND THEN v_method := 'order'; END IF;
  END IF;

  -- sck: procura o marcador em qualquer lugar do que a plataforma devolveu.
  -- Cada checkout guarda o parâmetro num campo diferente do metadata; varrer
  -- o texto evita manter um mapa por plataforma.
  IF v_method IS NULL THEN
    v_text := concat_ws(' ', v_sale.metadata::text, v_sale.utm_source, v_sale.utm_medium,
                        v_sale.utm_campaign, v_sale.utm_content, v_sale.utm_term, v_sale.ad_id);
    v_sid := substring(v_text FROM 'stl_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})');
    IF v_sid IS NOT NULL THEN
      SELECT * INTO v_session FROM tracking_sessions
      WHERE workspace_id = v_sale.workspace_id AND session_id = v_sid;
      IF FOUND THEN v_method := 'sck'; END IF;
    END IF;
  END IF;

  -- fbclid: direto, ou dentro do _fbc (fb.1.<timestamp>.<fbclid>).
  IF v_method IS NULL THEN
    v_fbclid := NULLIF(COALESCE(
      v_sale.metadata->>'fbclid',
      v_sale.metadata->'tracking'->>'fbclid',
      NULLIF(split_part(COALESCE(v_sale.metadata->>'fbc', ''), '.', 4), '')
    ), '');
    IF v_fbclid IS NOT NULL THEN
      SELECT * INTO v_session FROM tracking_sessions
      WHERE workspace_id = v_sale.workspace_id
        AND fbclid = v_fbclid
        AND started_at <= v_sale.sold_at + interval '5 minutes'
        AND started_at >= v_sale.sold_at - interval '7 days'
      ORDER BY started_at DESC
      LIMIT 1;
      IF FOUND THEN v_method := 'fbclid'; END IF;
    END IF;
  END IF;

  -- UTMs exatas, candidata única.
  IF v_method IS NULL
     AND v_sale.utm_source IS NOT NULL
     AND v_sale.utm_campaign IS NOT NULL
     AND v_sale.utm_content IS NOT NULL THEN
    SELECT COUNT(*) INTO v_candidates
    FROM tracking_sessions
    WHERE workspace_id = v_sale.workspace_id
      AND utm_source = v_sale.utm_source
      AND utm_campaign = v_sale.utm_campaign
      AND utm_content = v_sale.utm_content
      AND had_checkout_click
      AND sale_id IS NULL
      AND checkout_clicked_at BETWEEN v_sale.sold_at - interval '24 hours'
                                  AND v_sale.sold_at + interval '5 minutes';

    IF v_candidates = 1 THEN
      SELECT * INTO v_session
      FROM tracking_sessions
      WHERE workspace_id = v_sale.workspace_id
        AND utm_source = v_sale.utm_source
        AND utm_campaign = v_sale.utm_campaign
        AND utm_content = v_sale.utm_content
        AND had_checkout_click
        AND sale_id IS NULL
        AND checkout_clicked_at BETWEEN v_sale.sold_at - interval '24 hours'
                                    AND v_sale.sold_at + interval '5 minutes';
      v_method := 'utm_exact';
    END IF;
  END IF;

  IF v_method IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE sales
  SET session_id = v_session.session_id,
      visitor_id = v_session.visitor_id,
      matched_session_at = now(),
      match_method = v_method
  WHERE id = p_sale_id;

  -- A sessão aponta para a primeira linha do pedido; as demais linhas apontam
  -- para a sessão pelo sales.session_id.
  UPDATE tracking_sessions
  SET sale_id = p_sale_id, matched_at = now(), match_method = v_method
  WHERE id = v_session.id AND sale_id IS NULL;

  RETURN jsonb_build_object('session_id', v_session.session_id, 'method', v_method);
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_match_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_match_sale(uuid) TO service_role;

-- ------------------------------------------------------------
-- 8. Leitura: números da página /tracking e dos cards do Dashboard
-- ------------------------------------------------------------
-- "Rejeição" segue a definição do GA4 para sessão não engajada: uma página
-- só, nenhum clique no checkout e menos de 10 segundos. A regra clássica
-- ("uma página só") não serve aqui — página de vendas é uma página só por
-- natureza, e quase toda sessão contaria como rejeição.
--
-- Vendas = pedidos aprovados no período, contados como no Dashboard
-- (DISTINCT order_external_id), casados ou não com uma sessão. É o que torna
-- a conversão comparável com o resto do painel. matched_sales diz quantas
-- desses pedidos têm jornada conhecida.
CREATE OR REPLACE FUNCTION public.tracking_stats(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_today timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_cur jsonb;
  v_prev jsonb;
  v_daily jsonb;
  v_today_visitors int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id AND user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  WITH per AS (
    SELECT 'cur' AS period, p_from AS f, p_to AS t
    UNION ALL
    SELECT 'prev', v_prev_from, p_from
  ),
  sess AS (
    SELECT per.period,
      COUNT(DISTINCT s.visitor_id) AS visitors,
      COUNT(s.id) AS sessions,
      COALESCE(SUM(s.pageviews), 0) AS pageviews,
      AVG(s.duration_seconds) FILTER (WHERE s.duration_seconds IS NOT NULL) AS avg_duration,
      COUNT(s.id) FILTER (
        WHERE s.pageviews <= 1 AND NOT s.had_checkout_click AND COALESCE(s.duration_seconds, 0) < 10
      ) AS bounced,
      COUNT(s.id) FILTER (WHERE s.had_checkout_click) AS checkout_sessions,
      COUNT(DISTINCT s.visitor_id) FILTER (WHERE s.had_checkout_click) AS checkout_visitors
    FROM per
    LEFT JOIN tracking_sessions s
      ON s.workspace_id = p_workspace_id AND s.started_at >= per.f AND s.started_at < per.t
    GROUP BY per.period
  ),
  sal AS (
    SELECT per.period,
      COUNT(DISTINCT COALESCE(x.order_external_id, x.id::text)) AS sales,
      COUNT(DISTINCT COALESCE(x.order_external_id, x.id::text)) FILTER (WHERE x.session_id IS NOT NULL) AS matched_sales
    FROM per
    LEFT JOIN sales x
      ON x.workspace_id = p_workspace_id AND x.user_id = p_user_id AND x.status = 'approved'
     AND x.sold_at >= per.f AND x.sold_at < per.t
    GROUP BY per.period
  )
  SELECT
    jsonb_object_agg(sess.period, jsonb_build_object(
      'visitors', sess.visitors,
      'sessions', sess.sessions,
      'pageviews', sess.pageviews,
      'avg_duration', COALESCE(round(sess.avg_duration), 0),
      'bounced', sess.bounced,
      'checkout_sessions', sess.checkout_sessions,
      'checkout_visitors', sess.checkout_visitors,
      'sales', sal.sales,
      'matched_sales', sal.matched_sales
    ))
  INTO v_cur
  FROM sess JOIN sal USING (period);

  v_prev := v_cur->'prev';
  v_cur := v_cur->'cur';

  SELECT COUNT(DISTINCT visitor_id) INTO v_today_visitors
  FROM tracking_sessions
  WHERE workspace_id = p_workspace_id AND started_at >= v_today;

  WITH days AS (
    SELECT generate_series(
      (p_from AT TIME ZONE 'America/Sao_Paulo')::date,
      ((p_to - interval '1 microsecond') AT TIME ZONE 'America/Sao_Paulo')::date,
      interval '1 day'
    )::date AS d
  ),
  v AS (
    SELECT (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
           COUNT(DISTINCT visitor_id) AS visitors,
           COUNT(*) FILTER (WHERE had_checkout_click) AS checkout_sessions
    FROM tracking_sessions
    WHERE workspace_id = p_workspace_id AND started_at >= p_from AND started_at < p_to
    GROUP BY 1
  ),
  s AS (
    SELECT (sold_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
           COUNT(DISTINCT COALESCE(order_external_id, id::text)) AS sales
    FROM sales
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND status = 'approved'
      AND sold_at >= p_from AND sold_at < p_to
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(days.d, 'YYYY-MM-DD'),
    'visitors', COALESCE(v.visitors, 0),
    'checkout_sessions', COALESCE(v.checkout_sessions, 0),
    'sales', COALESCE(s.sales, 0)
  ) ORDER BY days.d), '[]'::jsonb)
  INTO v_daily
  FROM days
  LEFT JOIN v ON v.d = days.d
  LEFT JOIN s ON s.d = days.d;

  RETURN jsonb_build_object(
    'current', v_cur,
    'previous', v_prev,
    'today_visitors', v_today_visitors,
    'daily', v_daily
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_stats(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_stats(uuid, uuid, timestamptz, timestamptz) TO service_role;

-- Quebra por página de entrada, origem ou campanha. Aqui as vendas são só as
-- casadas com uma sessão: é o único jeito de saber de que página ou origem
-- uma venda veio.
CREATE OR REPLACE FUNCTION public.tracking_breakdown(
  p_user_id uuid,
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_group text,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id AND user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  IF p_group NOT IN ('page', 'source', 'campaign') THEN
    RAISE EXCEPTION 'p_group invalido: %', p_group;
  END IF;

  WITH keyed AS (
    SELECT
      CASE p_group
        WHEN 'page' THEN NULLIF(landing_page, '')
        -- Sem UTM, o id de clique ainda diz a rede; depois, o domínio de
        -- quem mandou o visitante; sem nada disso, é acesso direto.
        WHEN 'source' THEN COALESCE(
          utm_source,
          CASE WHEN fbclid IS NOT NULL THEN 'facebook' WHEN gclid IS NOT NULL THEN 'google' END,
          substring(referrer FROM '^https?://(?:www\.)?([^/:?#]+)'),
          '(direto)'
        )
        WHEN 'campaign' THEN utm_campaign
      END AS key,
      s.*
    FROM tracking_sessions s
    WHERE s.workspace_id = p_workspace_id AND s.started_at >= p_from AND s.started_at < p_to
  ),
  grouped AS (
    SELECT
      COALESCE(key, '(sem valor)') AS key,
      COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(*) AS sessions,
      COALESCE(round(AVG(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL)), 0) AS avg_duration,
      COUNT(*) FILTER (
        WHERE pageviews <= 1 AND NOT had_checkout_click AND COALESCE(duration_seconds, 0) < 10
      ) AS bounced,
      COUNT(*) FILTER (WHERE had_checkout_click) AS checkout_sessions,
      COUNT(DISTINCT sale_id) AS sales
    FROM keyed
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.visitors DESC, g.key), '[]'::jsonb)
  INTO v_rows
  FROM (SELECT * FROM grouped ORDER BY visitors DESC, key LIMIT GREATEST(1, LEAST(p_limit, 200))) g;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_breakdown(uuid, uuid, timestamptz, timestamptz, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_breakdown(uuid, uuid, timestamptz, timestamptz, text, int) TO service_role;

COMMIT;

-- ------------------------------------------------------------
-- 9. Retenção
-- ------------------------------------------------------------
-- Eventos: 90 dias. Sessões sem venda: 1 ano. Sessões casadas ficam — são a
-- jornada da venda. Roda no pg_cron, e não num @Cron do backend: na Vercel
-- não existe processo de pé para disparar o agendamento.
--
-- 04:30 UTC = 01:30 em São Paulo, fora do horário de tráfego.
--
-- Fora da transação: se o pg_cron não estiver disponível, o resto da
-- migration continua valendo e o expurgo pode ser agendado depois.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'tracking-retention',
    '30 4 * * *',
    $job$
      DELETE FROM public.tracking_events WHERE occurred_at < now() - interval '90 days';
      DELETE FROM public.tracking_sessions WHERE sale_id IS NULL AND started_at < now() - interval '1 year';
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel, expurgo nao agendado (%).', SQLERRM;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260929000000_meta_capi.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Meta Conversions API: PageView, InitiateCheckout e Purchase pelo servidor
-- ============================================================
-- Substitui o desenho dos containers do sGTM (Stape Store Writer + Lookup +
-- tag do Facebook) pelo próprio painel:
--
--   página  → snippet no subdomínio do cliente → sessão com fbp, fbc, IP,
--             user agent, cidade, estado → PageView / InitiateCheckout na CAPI
--   webhook → venda → sessão achada pelo indexador stl_<sessão> → Purchase
--
-- O indexador vai no parâmetro que a plataforma devolve no webhook (sck, src,
-- xcod, trk ou utm_term), escolhido em Integrações.
--
-- Muda uma decisão da migration anterior: o IP passa a ser gravado. A CAPI
-- precisa dele (client_ip_address) para casar o evento com a pessoa. Fica 90
-- dias e é apagado (seção 5).

BEGIN;

-- ------------------------------------------------------------
-- 1. Configuração da área
-- ------------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS tracking_platform TEXT,
  ADD COLUMN IF NOT EXISTS tracking_param TEXT NOT NULL DEFAULT 'sck',
  ADD COLUMN IF NOT EXISTS tracking_domain TEXT,
  ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT,
  -- Cifrado pelo EncryptionService do backend, como o token do Meta Ads.
  ADD COLUMN IF NOT EXISTS meta_capi_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_test_event_code TEXT,
  -- Dispara também o pixel do navegador (fbq) com o mesmo event_id, para o
  -- Meta deduplicar. Desligado: só servidor.
  ADD COLUMN IF NOT EXISTS meta_mirror_browser BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_tracking_param_check;
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_tracking_param_check
  CHECK (tracking_param IN ('sck', 'src', 'xcod', 'trk', 'utm_term'));

-- ------------------------------------------------------------
-- 2. Dados de navegação na sessão
-- ------------------------------------------------------------
ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS fbp TEXT,
  ADD COLUMN IF NOT EXISTS fbc TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- ------------------------------------------------------------
-- 3. Ingestão: agora com fbp, fbc, IP e event_id
-- ------------------------------------------------------------
-- Igual à versão anterior, mais:
--   p_ctx.fbp, p_ctx.fbc, p_ctx.ip_address  → sessão
--   evento.event_id                          → metadata do evento
--
-- fbc: o mais recente vence (um clique novo no anúncio troca o fbc).
-- fbp: o primeiro fica (identifica o navegador, não muda).
CREATE OR REPLACE FUNCTION public.tracking_ingest(
  p_workspace_id uuid,
  p_visitor_id text,
  p_session_id text,
  p_ctx jsonb,
  p_events jsonb
)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_first jsonb;
  v_pageviews int;
  v_clicked boolean;
  v_exit boolean;
  v_exit_duration int;
  v_new_session boolean;
  v_count int;
BEGIN
  IF p_events IS NULL OR jsonb_array_length(p_events) = 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id) THEN
    RETURN 0;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE e->>'type' = 'pageview'),
    COALESCE(bool_or(e->>'type' = 'checkout_click'), false),
    COALESCE(bool_or(e->>'type' = 'page_exit'), false),
    MAX((e->>'duration_seconds')::int) FILTER (WHERE e->>'type' = 'page_exit')
  INTO v_pageviews, v_clicked, v_exit, v_exit_duration
  FROM jsonb_array_elements(p_events) e;

  SELECT e INTO v_first
  FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, i)
  ORDER BY (e->>'type' = 'pageview') DESC, i
  LIMIT 1;

  INSERT INTO tracking_sessions AS s (
    workspace_id, visitor_id, session_id, started_at, ended_at, duration_seconds,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, ad_id, landing_page, referrer,
    user_agent, screen_resolution, language, device_type, country, region, city,
    fbp, fbc, ip_address,
    pageviews, had_checkout_click, checkout_clicked_at
  ) VALUES (
    p_workspace_id, p_visitor_id, p_session_id, v_now, v_now,
    CASE WHEN v_exit THEN v_exit_duration END,
    v_first->>'utm_source', v_first->>'utm_medium', v_first->>'utm_campaign',
    v_first->>'utm_content', v_first->>'utm_term',
    v_first->>'fbclid', v_first->>'gclid', v_first->>'ad_id',
    COALESCE(v_first->>'url', ''), v_first->>'referrer',
    p_ctx->>'user_agent', p_ctx->>'screen_resolution', p_ctx->>'language',
    p_ctx->>'device_type', p_ctx->>'country', p_ctx->>'region', p_ctx->>'city',
    p_ctx->>'fbp', p_ctx->>'fbc', p_ctx->>'ip_address',
    v_pageviews, v_clicked, CASE WHEN v_clicked THEN v_now END
  )
  ON CONFLICT (workspace_id, session_id) DO UPDATE SET
    ended_at = v_now,
    pageviews = s.pageviews + EXCLUDED.pageviews,
    had_checkout_click = s.had_checkout_click OR EXCLUDED.had_checkout_click,
    checkout_clicked_at = COALESCE(s.checkout_clicked_at, EXCLUDED.checkout_clicked_at),
    duration_seconds = CASE
      WHEN v_exit THEN GREATEST(
        COALESCE(s.duration_seconds, 0),
        COALESCE(EXCLUDED.duration_seconds, 0),
        EXTRACT(EPOCH FROM (v_now - s.started_at))::int
      )
      ELSE s.duration_seconds
    END,
    utm_source   = COALESCE(s.utm_source,   EXCLUDED.utm_source),
    utm_medium   = COALESCE(s.utm_medium,   EXCLUDED.utm_medium),
    utm_campaign = COALESCE(s.utm_campaign, EXCLUDED.utm_campaign),
    utm_content  = COALESCE(s.utm_content,  EXCLUDED.utm_content),
    utm_term     = COALESCE(s.utm_term,     EXCLUDED.utm_term),
    fbclid       = COALESCE(s.fbclid,       EXCLUDED.fbclid),
    gclid        = COALESCE(s.gclid,        EXCLUDED.gclid),
    ad_id        = COALESCE(s.ad_id,        EXCLUDED.ad_id),
    fbp          = COALESCE(s.fbp,          EXCLUDED.fbp),
    fbc          = COALESCE(EXCLUDED.fbc,   s.fbc),
    ip_address   = COALESCE(EXCLUDED.ip_address, s.ip_address),
    user_agent   = COALESCE(EXCLUDED.user_agent, s.user_agent),
    landing_page = CASE WHEN s.landing_page = '' THEN EXCLUDED.landing_page ELSE s.landing_page END
  RETURNING (xmax = 0) INTO v_new_session;

  INSERT INTO tracking_visitors AS v (
    workspace_id, visitor_id, first_seen_at, last_seen_at, total_sessions, total_pageviews,
    first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_referrer,
    country, region, city, device_type
  ) VALUES (
    p_workspace_id, p_visitor_id, v_now, v_now, 1, v_pageviews,
    v_first->>'utm_source', v_first->>'utm_medium', v_first->>'utm_campaign',
    v_first->>'utm_content', v_first->>'referrer',
    p_ctx->>'country', p_ctx->>'region', p_ctx->>'city', p_ctx->>'device_type'
  )
  ON CONFLICT (workspace_id, visitor_id) DO UPDATE SET
    last_seen_at = v_now,
    total_pageviews = v.total_pageviews + EXCLUDED.total_pageviews,
    total_sessions = v.total_sessions + CASE WHEN v_new_session THEN 1 ELSE 0 END,
    country = COALESCE(EXCLUDED.country, v.country),
    region = COALESCE(EXCLUDED.region, v.region),
    city = COALESCE(EXCLUDED.city, v.city),
    device_type = COALESCE(EXCLUDED.device_type, v.device_type);

  INSERT INTO tracking_events (workspace_id, session_id, visitor_id, event_type, event_name, url, metadata, occurred_at)
  SELECT
    p_workspace_id, p_session_id, p_visitor_id,
    e->>'type', e->>'name', e->>'url',
    NULLIF(jsonb_strip_nulls(jsonb_build_object(
      'event_id', e->'event_id',
      'duration_seconds', e->'duration_seconds',
      'page_id', e->'page_id',
      'referrer', e->'referrer',
      'props', e->'props'
    )), '{}'::jsonb),
    v_now
  FROM jsonb_array_elements(p_events) e;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.tracking_ingest(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_ingest(uuid, text, text, jsonb, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 4. Registro dos envios à CAPI
-- ------------------------------------------------------------
-- Um evento por linha. A unicidade (área, nome, event_id) é o que impede um
-- webhook reenviado pela plataforma de mandar o mesmo Purchase duas vezes: o
-- backend reserva a linha antes de enviar e só envia se a reserva entrou.
--
-- payload guarda o evento como foi (ou será) enviado: dados pessoais já em
-- SHA-256, e IP e user agent em claro, como o Meta exige. Serve para o
-- reenvio e para depurar; sai pela retenção.
CREATE TABLE IF NOT EXISTS public.capi_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  session_id TEXT,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  -- pending (reservado, envio em curso), sent, failed
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  response JSONB,
  fbtrace_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (workspace_id, event_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_capi_events_workspace_created
  ON public.capi_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_retry
  ON public.capi_events (status, created_at) WHERE status IN ('failed', 'pending');

ALTER TABLE public.capi_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono le os envios da area" ON public.capi_events;
CREATE POLICY "Dono le os envios da area" ON public.capi_events
  FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

COMMIT;

-- ------------------------------------------------------------
-- 5. Retenção
-- ------------------------------------------------------------
-- Substitui o job da migration anterior (cron.schedule atualiza pelo nome).
--   eventos de rastreio: 90 dias
--   IP da sessão: apagado aos 90 dias, a sessão fica
--   sessões sem venda: 1 ano
--   envios à CAPI: 30 dias (PageView/InitiateCheckout), 180 dias (Purchase)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'tracking-retention',
    '30 4 * * *',
    $job$
      DELETE FROM public.tracking_events WHERE occurred_at < now() - interval '90 days';
      UPDATE public.tracking_sessions SET ip_address = NULL
        WHERE ip_address IS NOT NULL AND started_at < now() - interval '90 days';
      DELETE FROM public.tracking_sessions WHERE sale_id IS NULL AND started_at < now() - interval '1 year';
      DELETE FROM public.capi_events
        WHERE (event_name <> 'Purchase' AND created_at < now() - interval '30 days')
           OR created_at < now() - interval '180 days';
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel, expurgo nao agendado (%).', SQLERRM;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20260929100000_plataformas_dos_containers.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Nove plataformas novas de checkout
-- ============================================================
-- Wiven, Frendz, Herospark, Kavoo, PagTrust, Assiny, Yampi, Wiapy e Doppus,
-- que até aqui só existiam nos containers do sGTM. O webhook delas é lido pelo
-- GenericCheckoutProcessor (packages/backend/src/modules/webhooks/processors/
-- generic), a partir dos mesmos caminhos que os containers usavam.
--
-- Sem esta migration, criar a integração em Integrações falha no CHECK.

ALTER TABLE public.checkout_integrations
  DROP CONSTRAINT IF EXISTS checkout_integrations_platform_check;

ALTER TABLE public.checkout_integrations
  ADD CONSTRAINT checkout_integrations_platform_check
  CHECK (platform = ANY (ARRAY[
    'hotmart'::text,
    'kiwify'::text,
    'kirvano'::text,
    'guru'::text,
    'perfectpay'::text,
    'ticto'::text,
    'payt'::text,
    'cakto'::text,
    'hubla'::text,
    'cartpanda'::text,
    'ggcheckout'::text,
    'lastlink'::text,
    'eduzz'::text,
    'mundpay'::text,
    'monetizze'::text,
    'greenn'::text,
    'wiven'::text,
    'frendz'::text,
    'herospark'::text,
    'kavoo'::text,
    'pagtrust'::text,
    'assiny'::text,
    'yampi'::text,
    'wiapy'::text,
    'doppus'::text
  ]));


-- >>>>>>>>>>>>>>>>>>>> 20261002000000_capi_events_10_dias.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Envios à CAPI ("Últimos eventos") apagados aos 10 dias
-- ============================================================
-- Antes: 30 dias (PageView/InitiateCheckout) e 180 dias (Purchase). Agora
-- todos aos 10 dias, para a tabela capi_events não crescer.
--
-- A linha do Purchase também é a trava contra Purchase duplicado (unicidade
-- área + nome + event_id): uma plataforma que reentregar o mesmo webhook
-- depois de 10 dias mandaria o Purchase de novo. As plataformas reentregam
-- em horas ou poucos dias, e o reenvio de falhas só olha os últimos 7 dias.
--
-- cron.schedule atualiza o job pelo nome: o corpo inteiro vai de novo, com
-- as outras regras de retenção iguais.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'tracking-retention',
    '30 4 * * *',
    $job$
      DELETE FROM public.tracking_events WHERE occurred_at < now() - interval '90 days';
      UPDATE public.tracking_sessions SET ip_address = NULL
        WHERE ip_address IS NOT NULL AND started_at < now() - interval '90 days';
      DELETE FROM public.tracking_sessions WHERE sale_id IS NULL AND started_at < now() - interval '1 year';
      DELETE FROM public.capi_events WHERE created_at < now() - interval '10 days';
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel, expurgo nao agendado (%).', SQLERRM;
END;
$$;

-- Limpa já o que passou dos 10 dias, sem esperar a madrugada.
DELETE FROM public.capi_events WHERE created_at < now() - interval '10 days';


-- >>>>>>>>>>>>>>>>>>>> 20260816000000_single_user_simplification.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================
-- Simplificação para usuário único
-- ============================================================
-- Roda DEPOIS de todas as migrations anteriores, num banco novo.
--
-- O que muda: sai a cobrança, sai o painel admin, sai o GTM, e o seletor de
-- área some da tela. O que NÃO muda: a forma do schema. workspace_id continua
-- em todas as tabelas, com uma única área criada automaticamente.
--
-- Essa escolha é deliberada. Arrancar workspace_id exigiria refatorar 146
-- arquivos de frontend e backend, e o ganho seria estético: uma coluna a menos
-- numa base que só tem um dono. Manter a coluna deixa todo o código existente
-- funcionando sem alteração.

BEGIN;

-- ------------------------------------------------------------
-- 1. Cobrança
-- ------------------------------------------------------------
-- Não há mais plano, assinatura, excedente nem Stripe.
DROP TABLE IF EXISTS public.usage_overage         CASCADE;
DROP TABLE IF EXISTS public.stripe_webhook_events CASCADE;
DROP TABLE IF EXISTS public.subscriptions         CASCADE;

-- profiles.plan_id aponta para plan_rules; solta o vínculo antes de derrubar.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS plan_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS subscription_start;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS subscription_end;

DROP FUNCTION IF EXISTS public.default_starter_plan_id() CASCADE;
DROP TABLE    IF EXISTS public.plan_rules CASCADE;

-- Coluna que existia só para marcar venda acima do limite do plano.
ALTER TABLE public.sales DROP COLUMN IF EXISTS blocked_by_limit;

-- ------------------------------------------------------------
-- 2. Painel admin e papéis
-- ------------------------------------------------------------
-- Não há mais admin dentro do produto: quem administra usa o painel do Supabase.
DROP FUNCTION IF EXISTS public.admin_dashboard_stats()        CASCADE;
DROP FUNCTION IF EXISTS public.admin_list_users(text, int, int) CASCADE;
DROP FUNCTION IF EXISTS public.admin_user_detail(uuid)         CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role)        CASCADE;
DROP FUNCTION IF EXISTS public.mask_secret(text)               CASCADE;

DROP TABLE IF EXISTS public.user_roles          CASCADE;
DROP TABLE IF EXISTS public.welcome_emails_sent CASCADE;
DROP TYPE  IF EXISTS public.app_role;

-- ------------------------------------------------------------
-- 3. GTM / VTurb
-- ------------------------------------------------------------
-- As abas de Eventos e VTurb saíram do produto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-gtm-events');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Nada a desagendar (%).', SQLERRM;
END;
$$;

DROP FUNCTION IF EXISTS public.gtm_top_visitors(uuid, uuid, timestamptz, timestamptz, int) CASCADE;
DROP FUNCTION IF EXISTS public.gtm_events_page(uuid, uuid, timestamptz, text, int, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.gtm_events_page(uuid, uuid, timestamptz, text, int) CASCADE;
DROP FUNCTION IF EXISTS public.gtm_visit_metrics(uuid, uuid, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.purge_old_gtm_events() CASCADE;

DROP TABLE IF EXISTS public.gtm_events CASCADE;

ALTER TABLE public.workspaces DROP COLUMN IF EXISTS gtm_ingest_token;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS vturb_token;

-- ------------------------------------------------------------
-- 4. Área única
-- ------------------------------------------------------------
-- O seletor de área sai da tela, mas a coluna fica. Para isso funcionar, cada
-- usuário precisa ter exatamente uma área, criada sozinha no cadastro.
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS archived_at;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS archived_by_system;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- A área única. O nome não aparece em lugar nenhum da interface.
  INSERT INTO public.workspaces (user_id, name)
  VALUES (NEW.id, 'Principal');

  RETURN NEW;
END;
$$;

-- Garante uma área para quem já existe (o usuário criado antes desta migration).
DO $$
DECLARE
  u record;
BEGIN
  FOR u IN SELECT id, email FROM auth.users LOOP
    INSERT INTO public.profiles (user_id, email)
    VALUES (u.id, u.email)
    ON CONFLICT (user_id) DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE user_id = u.id) THEN
      INSERT INTO public.workspaces (user_id, name)
      VALUES (u.id, 'Principal');
    END IF;
  END LOOP;
END;
$$;

-- Trava: uma área por usuário. Sem isso, "área única" seria só uma convenção
-- da interface, e um bug no backend poderia criar a segunda.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_one_per_user
  ON public.workspaces (user_id);

-- ------------------------------------------------------------
-- 5. Facebook por token colado
-- ------------------------------------------------------------
-- Não há mais app do Facebook: o cliente cola o token e o sistema descobre as
-- contas. Estas duas colunas guardavam credencial de app e não têm mais uso.
ALTER TABLE public.facebook_connections DROP COLUMN IF EXISTS app_id;
ALTER TABLE public.facebook_connections DROP COLUMN IF EXISTS app_secret;

COMMIT;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

