-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE public.campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  facebook_campaign_id text,
  name text NOT NULL,
  status text DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])),
  objective text,
  spend numeric DEFAULT 0,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  conversions integer DEFAULT 0,
  cpc numeric DEFAULT 0,
  cpm numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  date_start date,
  date_end date,
  synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  daily_budget numeric,
  lifetime_budget numeric,
  facebook_connection_id uuid,
  CONSTRAINT campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT campaigns_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.ad_sets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  facebook_adset_id text,
  name text NOT NULL,
  status text DEFAULT 'active'::text,
  spend numeric DEFAULT 0,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  conversions integer DEFAULT 0,
  cpc numeric DEFAULT 0,
  cpm numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  date_start date,
  date_end date,
  synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  daily_budget numeric,
  lifetime_budget numeric,
  facebook_connection_id uuid,
  CONSTRAINT ad_sets_pkey PRIMARY KEY (id),
  CONSTRAINT ad_sets_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id),
  CONSTRAINT ad_sets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.ads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  ad_set_id uuid NOT NULL,
  facebook_ad_id text,
  name text NOT NULL,
  status text DEFAULT 'active'::text,
  spend numeric DEFAULT 0,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  conversions integer DEFAULT 0,
  cpc numeric DEFAULT 0,
  cpm numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  date_start date,
  date_end date,
  synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  facebook_connection_id uuid,
  CONSTRAINT ads_pkey PRIMARY KEY (id),
  CONSTRAINT ads_ad_set_id_fkey FOREIGN KEY (ad_set_id) REFERENCES public.ad_sets(id),
  CONSTRAINT ads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.checkout_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform = ANY (ARRAY['hotmart'::text, 'kiwify'::text, 'kirvano'::text, 'guru'::text, 'perfectpay'::text, 'ticto'::text, 'payt'::text, 'cakto'::text, 'hubla'::text, 'cartpanda'::text, 'ggcheckout'::text, 'lastlink'::text, 'eduzz'::text, 'mundpay'::text, 'monetizze'::text, 'greenn'::text])),
  webhook_secret text,
  is_active boolean DEFAULT true,
  last_webhook_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  webhook_url text,
  api_token text,
  use_commission_value boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  CONSTRAINT checkout_integrations_pkey PRIMARY KEY (id),
  CONSTRAINT checkout_integrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT checkout_integrations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.company_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  type text CHECK (type = ANY (ARRAY['percentage'::text, 'fixed'::text])),
  value numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT company_costs_pkey PRIMARY KEY (id),
  CONSTRAINT company_costs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.daily_ad_spend (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid,
  ad_set_id uuid,
  ad_id uuid,
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
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  link_clicks integer DEFAULT 0,
  landing_page_views integer DEFAULT 0,
  initiate_checkouts integer DEFAULT 0,
  purchase_value numeric DEFAULT 0,
  facebook_connection_id uuid,
  CONSTRAINT daily_ad_spend_pkey PRIMARY KEY (id),
  CONSTRAINT daily_ad_spend_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id),
  CONSTRAINT daily_ad_spend_ad_set_id_fkey FOREIGN KEY (ad_set_id) REFERENCES public.ad_sets(id),
  CONSTRAINT daily_ad_spend_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id),
  CONSTRAINT daily_ad_spend_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.facebook_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  app_id text,
  app_secret text,
  access_token text NOT NULL,
  ad_account_id text NOT NULL,
  account_name text,
  account_status integer,
  is_valid boolean DEFAULT false,
  is_active boolean DEFAULT false,
  last_validated_at timestamp with time zone,
  token_expires_at timestamp with time zone,
  facebook_user_id text,
  facebook_user_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facebook_connections_pkey PRIMARY KEY (id),
  CONSTRAINT facebook_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.plan_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan text NOT NULL UNIQUE,
  max_sales_monthly integer NOT NULL DEFAULT -1,
  max_active_ad_accounts integer NOT NULL DEFAULT -1,
  max_checkout_integrations integer NOT NULL DEFAULT 1,
  max_workspaces integer NOT NULL DEFAULT 1,
  max_active_rules integer NOT NULL DEFAULT 0,
  overage_price_cents integer NOT NULL DEFAULT 0,
  stripe_product_id text,
  stripe_price_id_base text,
  stripe_price_id_metered text,
  stripe_meter_event_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT plan_rules_pkey PRIMARY KEY (id)
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plan_rules(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','trialing','past_due','canceled','paused')),
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text UNIQUE,
  scheduled_plan_id    uuid REFERENCES public.plan_rules(id),
  scheduled_changes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.usage_overage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  price_cents integer NOT NULL,
  reported_to_stripe_at   timestamptz,
  stripe_usage_record_id  text,
  settled_at              timestamptz, -- set quando overage é cobrada via invoice extra no upgrade de plano (overrride do fluxo meter event)
  settled_by_invoice_id   text,        -- Stripe Invoice ID que cobrou esta row
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_overage_unsettled_unreported
  ON public.usage_overage (id)
  WHERE reported_to_stripe_at IS NULL AND settled_at IS NULL;

CREATE TABLE public.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);

CREATE TABLE public.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  ad_spend_tax_percentage numeric NOT NULL DEFAULT 0
    CHECK (ad_spend_tax_percentage >= 0 AND ad_spend_tax_percentage <= 100),
  gtm_ingest_token text,  -- see GTM SERVER EVENTS section
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  archived_at timestamp with time zone,
  archived_by_system boolean NOT NULL DEFAULT false,
  CONSTRAINT workspaces_pkey PRIMARY KEY (id)
);

CREATE TABLE public.financial_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid,
  type text CHECK (type = ANY (ARRAY['expense'::text, 'revenue'::text, 'tax'::text])),
  name text NOT NULL,
  amount numeric DEFAULT 0,
  reference_month date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT financial_entries_pkey PRIMARY KEY (id),
  CONSTRAINT financial_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.processing_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  job_type text NOT NULL DEFAULT 'sync'::text,
  status text NOT NULL DEFAULT 'processing'::text,
  progress integer DEFAULT 0,
  result jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT processing_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT processing_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  name text,
  email text,
  avatar_url text,
  plan_id uuid NOT NULL DEFAULT (SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  cpf text,
  subscription_start date,
  subscription_end date,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT profiles_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plan_rules(id)
);

CREATE TABLE public.sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid,
  checkout_integration_id uuid,
  external_id text,
  customer_email text,
  customer_name text,
  product_name text,
  amount numeric NOT NULL,
  currency text DEFAULT 'BRL'::text,
  status text DEFAULT 'approved'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'refunded'::text, 'chargeback'::text])),
  payment_method text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  sold_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ad_id text,
  ad_set_id uuid,
  ad_internal_id uuid,
  customer_phone text,
  customer_doc text,
  checkout_source text,
  metadata jsonb,
  customer_state text,
  customer_city text,
  customer_country text DEFAULT 'BR'::text,
  blocked_by_limit boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'webhook'::text CHECK (source = ANY (ARRAY['webhook'::text, 'import'::text, 'manual'::text])),
  CONSTRAINT sales_pkey PRIMARY KEY (id),
  CONSTRAINT sales_ad_set_id_fkey FOREIGN KEY (ad_set_id) REFERENCES public.ad_sets(id),
  CONSTRAINT sales_ad_internal_id_fkey FOREIGN KEY (ad_internal_id) REFERENCES public.ads(id),
  CONSTRAINT sales_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT sales_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id),
  CONSTRAINT sales_checkout_integration_id_fkey FOREIGN KEY (checkout_integration_id) REFERENCES public.checkout_integrations(id),
  CONSTRAINT sales_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.sync_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  sync_type text NOT NULL DEFAULT 'facebook_ads'::text,
  interval_minutes integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamp with time zone,
  next_sync_at timestamp with time zone,
  last_sync_status text DEFAULT 'pending'::text,
  last_sync_error text,
  last_sync_duration_ms integer,
  synced_campaigns integer DEFAULT 0,
  synced_ad_sets integer DEFAULT 0,
  synced_ads integer DEFAULT 0,
  consecutive_errors integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sync_schedules_pkey PRIMARY KEY (id),
  CONSTRAINT sync_schedules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.sync_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  sync_schedule_id uuid,
  sync_type text NOT NULL DEFAULT 'facebook_ads'::text,
  status text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  duration_ms integer,
  campaigns_synced integer DEFAULT 0,
  ad_sets_synced integer DEFAULT 0,
  ads_synced integer DEFAULT 0,
  sales_rematched integer DEFAULT 0,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sync_logs_pkey PRIMARY KEY (id),
  CONSTRAINT sync_logs_sync_schedule_id_fkey FOREIGN KEY (sync_schedule_id) REFERENCES public.sync_schedules(id),
  CONSTRAINT sync_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
);

CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role app_role NOT NULL DEFAULT 'user'::app_role,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_pkey PRIMARY KEY (id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.webhook_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending'::text,
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  processed_at timestamp with time zone,
  next_retry_at timestamp with time zone DEFAULT now(),
  CONSTRAINT webhook_queue_pkey PRIMARY KEY (id)
);

CREATE TABLE public.welcome_emails_sent (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  sent_at timestamp with time zone DEFAULT now(),
  CONSTRAINT welcome_emails_sent_pkey PRIMARY KEY (id)
);

-- ============================================================
-- INDEXES
-- ============================================================

-- ad_sets
CREATE INDEX idx_ad_sets_campaign_id ON public.ad_sets USING btree (campaign_id);
CREATE INDEX idx_ad_sets_facebook_adset_id ON public.ad_sets USING btree (facebook_adset_id);
CREATE INDEX idx_ad_sets_user_id ON public.ad_sets USING btree (user_id);
CREATE INDEX idx_ad_sets_workspace ON public.ad_sets USING btree (workspace_id);

-- ads
CREATE INDEX idx_ads_ad_set_id ON public.ads USING btree (ad_set_id);
CREATE INDEX idx_ads_facebook_ad_id ON public.ads USING btree (facebook_ad_id);
CREATE INDEX idx_ads_user_id ON public.ads USING btree (user_id);
CREATE INDEX idx_ads_workspace ON public.ads USING btree (workspace_id);

-- campaigns
CREATE INDEX idx_campaigns_facebook_id ON public.campaigns USING btree (facebook_campaign_id);
CREATE INDEX idx_campaigns_user_id ON public.campaigns USING btree (user_id);
CREATE INDEX idx_campaigns_workspace ON public.campaigns USING btree (workspace_id);

-- checkout_integrations
CREATE INDEX idx_checkout_integrations_user_id ON public.checkout_integrations USING btree (user_id);
CREATE INDEX idx_checkout_integrations_workspace ON public.checkout_integrations USING btree (workspace_id);

-- company_costs
CREATE INDEX idx_company_costs_user_id ON public.company_costs USING btree (user_id);
CREATE INDEX idx_company_costs_workspace ON public.company_costs USING btree (workspace_id);

-- daily_ad_spend
CREATE INDEX idx_daily_ad_spend_ad_date ON public.daily_ad_spend USING btree (ad_id, date);
CREATE INDEX idx_daily_ad_spend_adset_date ON public.daily_ad_spend USING btree (ad_set_id, date);
CREATE INDEX idx_daily_ad_spend_campaign_date ON public.daily_ad_spend USING btree (campaign_id, date);
CREATE INDEX idx_daily_ad_spend_connection_id ON public.daily_ad_spend USING btree (facebook_connection_id);
CREATE UNIQUE INDEX idx_daily_ad_spend_unique ON public.daily_ad_spend USING btree (workspace_id, COALESCE(facebook_campaign_id, ''::text), COALESCE(facebook_adset_id, ''::text), COALESCE(facebook_ad_id, ''::text), date);
CREATE INDEX idx_daily_ad_spend_user_date ON public.daily_ad_spend USING btree (user_id, date);
CREATE INDEX idx_daily_ad_spend_user_date_desc ON public.daily_ad_spend USING btree (user_id, date DESC);
CREATE INDEX idx_daily_ad_spend_workspace ON public.daily_ad_spend USING btree (workspace_id);

-- facebook_connections
CREATE INDEX idx_facebook_connections_user_id ON public.facebook_connections USING btree (user_id);
CREATE INDEX idx_facebook_connections_fb_user_id ON public.facebook_connections USING btree (facebook_user_id) WHERE facebook_user_id IS NOT NULL;
CREATE INDEX idx_facebook_connections_workspace ON public.facebook_connections USING btree (workspace_id);

-- financial_entries
CREATE INDEX idx_financial_entries_reference_month ON public.financial_entries USING btree (reference_month);
CREATE INDEX idx_financial_entries_workspace_month_type ON public.financial_entries USING btree (workspace_id, reference_month, type);
CREATE INDEX idx_financial_entries_user_id ON public.financial_entries USING btree (user_id);
CREATE INDEX idx_financial_entries_workspace_id ON public.financial_entries USING btree (workspace_id);

-- processing_jobs
CREATE INDEX idx_processing_jobs_created_brin ON public.processing_jobs USING brin (created_at);
CREATE INDEX idx_processing_jobs_user_status ON public.processing_jobs USING btree (user_id, status);
CREATE INDEX idx_processing_jobs_workspace ON public.processing_jobs USING btree (workspace_id);

-- profiles
CREATE UNIQUE INDEX idx_profiles_cpf_unique ON public.profiles USING btree (cpf) WHERE (cpf IS NOT NULL);
CREATE INDEX idx_profiles_plan_id ON public.profiles USING btree (plan_id);
CREATE INDEX idx_profiles_user_id ON public.profiles USING btree (user_id);
CREATE INDEX idx_profiles_created_at_desc ON public.profiles USING btree (created_at DESC);

-- sales
CREATE INDEX idx_sales_ad_id ON public.sales USING btree (ad_id);
CREATE INDEX idx_sales_ad_internal_id ON public.sales USING btree (ad_internal_id);
CREATE INDEX idx_sales_ad_set_id ON public.sales USING btree (ad_set_id);
CREATE INDEX idx_sales_approved_user ON public.sales USING btree (user_id, sold_at DESC) WHERE status = 'approved';
CREATE INDEX idx_sales_campaign_id ON public.sales USING btree (campaign_id);
CREATE INDEX idx_sales_customer_state ON public.sales USING btree (user_id, customer_state) WHERE (customer_state IS NOT NULL);
CREATE INDEX idx_sales_planlimits_webhook ON public.sales USING btree (user_id, sold_at DESC) WHERE (status = 'approved' AND blocked_by_limit = false AND source = 'webhook');
CREATE INDEX idx_sales_sold_at ON public.sales USING btree (sold_at);
CREATE INDEX idx_sales_user_sold_at ON public.sales USING btree (user_id, sold_at DESC);
CREATE INDEX idx_sales_workspace_sold_at ON public.sales USING btree (workspace_id, sold_at DESC);
CREATE UNIQUE INDEX sales_external_id_workspace_unique ON public.sales USING btree (external_id, workspace_id);

-- sync_logs
CREATE INDEX idx_sync_logs_created_brin ON public.sync_logs USING brin (created_at);
CREATE INDEX idx_sync_logs_user_id ON public.sync_logs USING btree (user_id, created_at DESC);
CREATE INDEX idx_sync_logs_workspace ON public.sync_logs USING btree (workspace_id);

-- sync_schedules
CREATE INDEX idx_sync_schedules_next_sync ON public.sync_schedules USING btree (next_sync_at) WHERE (is_active = true);
CREATE INDEX idx_sync_schedules_workspace ON public.sync_schedules USING btree (workspace_id);
CREATE UNIQUE INDEX sync_schedules_workspace_sync_type_key ON public.sync_schedules USING btree (workspace_id, sync_type);
CREATE INDEX idx_sync_schedules_errored ON public.sync_schedules USING btree (last_sync_at DESC) WHERE last_sync_status = 'error';

-- user_roles
CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);
CREATE UNIQUE INDEX user_roles_user_id_role_key ON public.user_roles USING btree (user_id, role);

-- webhook_queue
CREATE INDEX idx_webhook_queue_created_brin ON public.webhook_queue USING brin (created_at);
CREATE INDEX idx_webhook_queue_next_retry_at ON public.webhook_queue USING btree (next_retry_at);
CREATE INDEX idx_webhook_queue_pending ON public.webhook_queue USING btree (next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_webhook_queue_status ON public.webhook_queue USING btree (status);

-- workspaces
CREATE INDEX idx_workspaces_user_id ON public.workspaces USING btree (user_id);

-- ============================================================
-- FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.default_starter_plan_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
AS $function$
  SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1;
$function$;

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

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

-- Pick first numeric segment (>= 6 digits) from a piped/slashed string. Used by
-- sales_grouped_by_ad to derive an ad_id from sales.ad_id / utm_term / utm_content.
CREATE OR REPLACE FUNCTION public.extract_numeric_ad_id(raw text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $function$
  SELECT trim(p)
  FROM regexp_split_to_table(coalesce(raw, ''), '[|/]') AS p
  WHERE trim(p) ~ '^[0-9]{6,}$'
  LIMIT 1;
$function$;

-- Server-side aggregation for /metrics/dashboard. Returns gross/count/lifetime/
-- chart_data/regions/recent_sales as a single jsonb so the backend gets every
-- shape the dashboard needs in one round trip (and bypasses PostgREST's 1000-row cap).
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
  SET search_path TO 'public'
AS $function$
  -- See migration 20260428100000_dashboard_aggregation_rpcs.sql for full body.
  -- Output keys: gross_revenue, sales_count, lifetime_revenue, chart_data, regions, recent_sales.
$function$;

-- LC sales aggregated by ad_id (or extracted from utm_term/utm_content). Feeds
-- campaign/adset/ad attribution maps in LiveMetricsService.
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
  SET search_path TO 'public'
AS $function$
  -- See migration 20260428100000_dashboard_aggregation_rpcs.sql for full body.
$function$;

-- Single round-trip aggregation for the /sales screen: metrics, by_product,
-- by_ad, refunds_by_state, and a refunded_sample (capped at 500). Falls back
-- to in-memory aggregation in sales.service.ts when this RPC is unavailable.
-- The by_ad grouping key is COALESCE(utm_content, ads.name, sales.ad_id,
-- 'Sem anúncio') — utm_content first (the click-time UTM), then the joined
-- ad name (via sales.ad_internal_id → ads.id), then the raw Facebook ad_id,
-- then the placeholder. ad_set / campaign names are intentionally NOT used
-- as fallbacks (the card is "Vendas por Anúncio", not by ad set).
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
  SET search_path TO 'public'
AS $function$
  -- See migration 20260508120000_sales_summary_rpc_v2.sql for full body.
$function$;

-- Single round-trip aggregation for the AdminDashboard at /admin. Replaces
-- the 11 sequential queries that AdminService.getStats() used to make. Returns
-- counts (total_users, active_users_30d, new_users_7d, facebook_connections_active,
-- total_campaigns, total_sales, checkout_integrations_active), total_revenue
-- (SUM of approved sales — previously summed in Node and silently truncated by
-- PostgREST's 1000-row cap), users_by_plan, new_users_by_day (last 30 days),
-- recent_users (top 10), and users_with_sync_errors (top 10).
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public'
AS $function$
  -- See migration 20260502100000_admin_dashboard_stats_rpc.sql for full body.
  -- Output keys: total_users, active_users_30d, new_users_7d,
  -- facebook_connections_active, total_campaigns, total_sales, total_revenue,
  -- checkout_integrations_active, users_by_plan, new_users_by_day,
  -- recent_users, users_with_sync_errors.
$function$;

-- Single round-trip listing for the AdminUsers page at /admin/users. Replaces
-- AdminService.listUsers(), which had three correctness bugs (auth.admin
-- listUsers cap of 1000, PostgREST 1000-row truncation of campaigns/sales
-- aggregates, post-pagination role/facebook filters that broke total_count) and
-- shipped six unused fields. Filters apply in SQL; aggregates run only on the
-- page's surviving rows via LATERAL.
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
  SET search_path TO 'public'
AS $function$
  -- See migration 20260502120000_admin_list_users_rpc.sql for full body.
  -- Output: { users: row[], total_count: bigint, page: int, total_pages: int }.
  -- Each row carries: id, user_id, name, email, avatar_url, cpf, plan, role,
  -- facebook_connected, campaigns_count, sales_count, total_revenue,
  -- subscription_start, subscription_end, last_sign_in_at.
$function$;

-- Helper for admin_user_detail: mask a secret string for display ('••••••••' +
-- last 4 chars when length > 4; bullets only otherwise; null when empty).
CREATE OR REPLACE FUNCTION public.mask_secret(s text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $function$
  -- See migration 20260502130000_admin_user_detail_rpc.sql for full body.
$function$;

-- Single round-trip detail payload for the AdminUserDetail page at
-- /admin/users/:id. Replaces AdminService.getUserDetail()'s 13 sequential
-- queries plus auth.admin.getUserById call. Returns:
--   { profile, subscription, health, facebook, checkouts, automation_rules }.
-- Profile carries last_sign_in_at (joined from auth.users via SECURITY DEFINER,
-- removing the previous extra Admin-API call). Health.total_revenue is computed
-- via SUM in SQL (the old Node reduce was silently truncated by PostgREST's
-- 1000-row cap). Checkouts ship with masked secret/token; full credentials are
-- exposed by a separate admin endpoint guarded by AuthGuard+AdminGuard.
CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  -- See migration 20260502130000_admin_user_detail_rpc.sql for full body.
$function$;

-- Syncs profiles.email when auth.users.email is updated. Defense-in-depth for
-- the Settings/Profile feature: covers code paths that bypass PATCH /me/email.
-- SECURITY DEFINER so the trigger can write to public.profiles from auth schema.
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

-- EXECUTE on dashboard_metrics, sales_grouped_by_ad, extract_numeric_ad_id,
-- admin_dashboard_stats, admin_list_users, admin_user_detail, mask_secret is
-- granted to service_role only and revoked from PUBLIC. The functions either
-- take p_user_id directly or aggregate across all users for admin endpoints, so
-- granting frontend roles would defeat tenancy isolation or leak admin-level
-- metrics.

-- ============================================================
-- TRIGGERS
-- ============================================================

-- handle_new_user is triggered on auth.users INSERT (defined in Supabase Dashboard)

CREATE TRIGGER update_ad_sets_updated_at
  BEFORE UPDATE ON public.ad_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ads_updated_at
  BEFORE UPDATE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_checkout_integrations_updated_at
  BEFORE UPDATE ON public.checkout_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_ad_spend_updated_at
  BEFORE UPDATE ON public.daily_ad_spend
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_facebook_connections_updated_at
  BEFORE UPDATE ON public.facebook_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_processing_jobs_updated_at
  BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_schedules_updated_at
  BEFORE UPDATE ON public.sync_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- on_auth_user_email_changed (auth.users)
-- After every UPDATE on auth.users, syncs profiles.email when the email changes.
-- Defends against future code paths that bypass the backend's PATCH /me/email endpoint.
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_profile_email();

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

-- ad_sets
ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;

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

-- ads
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

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

-- campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

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

-- checkout_integrations
ALTER TABLE public.checkout_integrations ENABLE ROW LEVEL SECURITY;

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

-- company_costs
ALTER TABLE public.company_costs ENABLE ROW LEVEL SECURITY;

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

-- daily_ad_spend
ALTER TABLE public.daily_ad_spend ENABLE ROW LEVEL SECURITY;

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

-- facebook_connections
ALTER TABLE public.facebook_connections ENABLE ROW LEVEL SECURITY;

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

-- financial_entries
ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

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

-- plan_rules
ALTER TABLE public.plan_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plan rules" ON public.plan_rules
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Admins can manage plan rules" ON public.plan_rules
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- processing_jobs
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own jobs" ON public.processing_jobs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert their own jobs" ON public.processing_jobs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- sales
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

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

-- sync_logs
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sync logs" ON public.sync_logs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can view all sync logs" ON public.sync_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- sync_schedules
ALTER TABLE public.sync_schedules ENABLE ROW LEVEL SECURITY;

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

-- user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- webhook_queue
ALTER TABLE public.webhook_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage webhook queue" ON public.webhook_queue
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- welcome_emails_sent
ALTER TABLE public.welcome_emails_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage welcome emails sent" ON public.welcome_emails_sent
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- workspaces
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- AUTOMATION RULES (migration 20260401000008)
-- ============================================================

CREATE TABLE public.automation_rules (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL,
  name              text        NOT NULL,
  is_active         boolean     NOT NULL DEFAULT false,
  connection_id     uuid,                            -- nullable FK → facebook_connections
  target_entity     text        NOT NULL,            -- 'campaign' | 'adset' | 'ad'
  target_status     text        NOT NULL,            -- 'active' | 'paused' | 'any'
  name_filter       text,                            -- optional substring filter on entity name
  action_type       text        NOT NULL,            -- 'activate' | 'pause' | 'increase_budget' | 'decrease_budget'
  budget_adjustment jsonb,                           -- { type: 'percent'|'fixed', value: number }
  evaluation_period text        NOT NULL,            -- 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'custom'
  custom_start_date date,                            -- used when evaluation_period = 'custom'
  frequency_minutes integer     NOT NULL,            -- 10 | 15 | 30 | 60 | 120 | 180 | 360 | 1440
  daily_run_time    time,                            -- optional wall-clock time for daily rules
  last_executed_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
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

CREATE TABLE public.automation_rule_conditions (
  id       uuid    NOT NULL DEFAULT gen_random_uuid(),
  rule_id  uuid    NOT NULL,
  metric   text    NOT NULL,  -- 'spend'|'cpa'|'roi'|'roas'|'profit'|'profit_margin'|'cpc'|'ctr'|'cpm'|'impressions'|'clicks'|'conversions'
  operator text    NOT NULL,  -- 'gt'|'lt'|'gte'|'lte'
  value    numeric NOT NULL,
  CONSTRAINT automation_rule_conditions_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rule_conditions_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_conditions_metric_check
    CHECK (metric IN ('spend','cpa','roi','roas','profit','profit_margin','cpc','ctr','cpm','impressions','clicks','conversions')),
  CONSTRAINT automation_rule_conditions_operator_check
    CHECK (operator IN ('gt','lt','gte','lte'))
);

CREATE TABLE public.automation_rule_executions (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  rule_id            uuid        NOT NULL,
  workspace_id       uuid        NOT NULL,
  entity_facebook_id text        NOT NULL,
  entity_name        text,
  action_taken       text        NOT NULL,
  metrics_snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status             text        NOT NULL,  -- 'success' | 'error'
  error_message      text,
  executed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_rule_executions_pkey PRIMARY KEY (id),
  CONSTRAINT automation_rule_executions_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_executions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT automation_rule_executions_status_check
    CHECK (status IN ('success','error'))
);

-- Indexes
CREATE INDEX idx_automation_rules_workspace_active
  ON public.automation_rules (workspace_id, is_active);

CREATE INDEX idx_automation_rules_active_last_executed
  ON public.automation_rules (is_active, last_executed_at)
  WHERE is_active = true;

CREATE INDEX idx_automation_rule_conditions_rule_id
  ON public.automation_rule_conditions (rule_id);

CREATE INDEX idx_automation_rule_executions_rule_date
  ON public.automation_rule_executions (rule_id, executed_at DESC);

CREATE INDEX idx_automation_rule_executions_workspace_date
  ON public.automation_rule_executions (workspace_id, executed_at DESC);

CREATE INDEX idx_automation_rule_executions_executed_at_brin
  ON public.automation_rule_executions USING BRIN (executed_at);

-- RLS
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can manage their automation rules"
  ON public.automation_rules FOR ALL TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Workspace members can manage their rule conditions"
  ON public.automation_rule_conditions FOR ALL TO authenticated
  USING (rule_id IN (
    SELECT ar.id FROM public.automation_rules ar
    JOIN public.workspaces w ON w.id = ar.workspace_id
    WHERE w.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (rule_id IN (
    SELECT ar.id FROM public.automation_rules ar
    JOIN public.workspaces w ON w.id = ar.workspace_id
    WHERE w.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Workspace members can view their rule executions"
  ON public.automation_rule_executions FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = (SELECT auth.uid())));

-- ============================================================
-- GTM SERVER EVENTS (Feature 16)
-- ============================================================

-- Ingestion token on workspaces: the shared secret the sGTM tag sends in the
-- X-Sentinela-Token header. Generated on demand from the Integrations screen.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS gtm_ingest_token text;

CREATE UNIQUE INDEX idx_workspaces_gtm_ingest_token
  ON public.workspaces (gtm_ingest_token)
  WHERE gtm_ingest_token IS NOT NULL;

-- Events posted by the server-side GTM container, alongside its Meta CAPI tag.
-- Append-only, purged after 30 days by the pg_cron job below.
CREATE TABLE public.gtm_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_name text NOT NULL,
  event_id text,                    -- dedup key shared with the browser pixel
  event_time timestamptz NOT NULL DEFAULT now(),
  value numeric,
  currency text,
  page_url text,
  has_fbp boolean NOT NULL DEFAULT false,
  has_fbc boolean NOT NULL DEFAULT false,
  visitor_hash text,                -- sha256(_fbp + GTM_VISITOR_SALT); raw cookie never stored
  fbclid text,
  raw jsonb,                        -- payload as received, PII already stripped
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gtm_events_pkey PRIMARY KEY (id),
  CONSTRAINT gtm_events_workspace_id_fkey FOREIGN KEY (workspace_id)
    REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_gtm_events_workspace_created
  ON public.gtm_events (workspace_id, created_at DESC);

-- Covers the visitors aggregation: INCLUDE keeps COUNT(DISTINCT) index-only.
CREATE INDEX idx_gtm_events_visits
  ON public.gtm_events (workspace_id, event_name, created_at)
  INCLUDE (visitor_hash);

-- For the daily purge, which scans by age across all workspaces.
CREATE INDEX idx_gtm_events_created_brin
  ON public.gtm_events USING BRIN (created_at);

-- Deduplication. Not partial: ON CONFLICT cannot infer a partial index through
-- PostgREST's on_conflict, and NULL event_ids are distinct by default anyway.
CREATE UNIQUE INDEX idx_gtm_events_dedup
  ON public.gtm_events (workspace_id, event_id);

-- RLS
ALTER TABLE public.gtm_events ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner. Also what gates Supabase Realtime delivery.
-- No write policies: inserts come from the backend with the service role.
CREATE POLICY "Users can view their own gtm events" ON public.gtm_events
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Function: gtm_visit_metrics(p_user_id, p_workspace_id, p_from, p_to) -> jsonb
--   Unique visitors, total visits, average visits per visitor and unidentified
--   visits, over PageView events only. Kept out of dashboard_metrics so other
--   users don't pay for a COUNT(DISTINCT) that always returns zero for them.
--   Returns: { unique_visitors, total_visits, avg_visits_per_visitor, unidentified_visits }

-- Realtime: the table must belong to the publication Realtime listens on.
-- Done in the migration, so there is no manual panel step. Only INSERT is
-- subscribed, so the default replica identity is sufficient.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.gtm_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Retention: 30 days, purged daily at 04:00 UTC (01:00 São Paulo).
-- A pg_cron job rather than an application cron — it is a pure database
-- operation, and this keeps the purge independent of any app server being up.
-- cron.schedule upserts by job name, so re-running is safe.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'gtm-events-retention',
  '0 4 * * *',
  $$DELETE FROM public.gtm_events WHERE created_at < now() - interval '30 days'$$
);

-- ------------------------------------------------------------
-- Visit numbering (2026-08-05)
-- ------------------------------------------------------------

-- The site's own identifier for the person, sent in the payload as
-- `id_do_usuario`. Named external_* because `user_id` on this table already
-- means the workspace owner. Not hashed, unlike visitor_hash: this is the
-- operator's own id for their own user and has to stay readable to be useful.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS external_user_id text;

-- One key to group visits by, so queries and indexes don't repeat the fallback.
-- STORED because it is read far more than written.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS visitor_key text
  GENERATED ALWAYS AS (COALESCE(external_user_id, visitor_hash)) STORED;

CREATE INDEX idx_gtm_events_visitor_key
  ON public.gtm_events (workspace_id, visitor_key, created_at);

-- Function: gtm_events_page(p_user_id, p_workspace_id, p_before, p_event_name, p_limit) -> jsonb
--   Keyset page of events, each carrying `visit_number` — which visit of that
--   person the event belongs to. A visit is a SESSION (30 min of inactivity
--   ends it), not a pageview, and sessions are cut over all events, not just
--   PageView. The number cannot be derived from a page of rows alone, so the
--   RPC selects the page first and then scans only those visitors' histories.

-- Function: gtm_visit_metrics(...) -- REDEFINED
--   Now counts sessions rather than PageView rows, so "visita" means the same
--   thing here and on the Events page. Groups by visitor_key.

-- NOTE (2026-08-05): gtm_visit_metrics has no caller. The Dashboard visitors
-- card that used it was removed at the user's request; the function is kept
-- because dropping it would need another manual migration for no gain, and the
-- aggregate is ready if the metric ever returns to any screen.

-- ------------------------------------------------------------
-- Visit = access (2026-08-05, supersedes the session definition)
-- ------------------------------------------------------------

-- gtm_events_page and gtm_visit_metrics redefined: a visit is one PageView,
-- not a 30-minute session. Three accesses in a row are three visits, however
-- close together.
--
-- An event's visit_number is the running count of that visitor's PageViews up
-- to and including it — on a PageView that is its own position, on a Purchase
-- it is how many visits the person had before buying. Event names are
-- normalised (lower + strip '_') because tag templates spell PageView, pageview
-- and page_view interchangeably.

-- ------------------------------------------------------------
-- Visits counted per subdomain (2026-08-05)
-- ------------------------------------------------------------

-- Host derived from page_url. Generated, so events already stored get the
-- value without a backfill. Scheme, path, query and port removed, lowercased.
-- `www.` is KEPT: counting is at subdomain granularity, so loja.exemplo.com and
-- blog.exemplo.com are separate sites and www. is a subdomain like any other.
ALTER TABLE public.gtm_events
  ADD COLUMN IF NOT EXISTS page_host text
  GENERATED ALWAYS AS (
    NULLIF(
      split_part(
        lower(COALESCE(substring(page_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/?#]+)'), '')),
        ':', 1
      ),
      ''
    )
  ) STORED;

CREATE INDEX idx_gtm_events_visitor_host
  ON public.gtm_events (workspace_id, visitor_key, page_host, created_at);

-- gtm_events_page redefined: the running count of PageViews is now partitioned
-- by (visitor_key, page_host), so the same person has an independent visit
-- sequence on each site.

-- gtm_events_page (2026-08-05, hostless events): an event with a page_host is
-- counted on that host; an event WITHOUT one (page_url absent — Purchase
-- typically) is counted across every host of that person. The RPC computes both
-- running sums and picks by the presence of the host, returning `visit_scope`
-- ('host' | 'all_hosts') so the UI can say which number it is showing.

-- ------------------------------------------------------------
-- Events date filter + visitor ranking (2026-08-06)
-- ------------------------------------------------------------

-- Function: gtm_events_page(..., p_from, p_to) -- REDEFINED
--   Gained a date range. Only the `page` CTE is filtered by it; the `history`
--   CTE behind the visit number is deliberately NOT, because the visit number
--   is a fact about the person's history, not about the current filter.
--   Filtering it would renumber someone's 5th visit as their 1st the moment you
--   filtered to today.

-- Function: gtm_top_visitors(p_user_id, p_workspace_id, p_from, p_to, p_limit) -> jsonb
--   People with the most visits, ranked. Unlike the per-event visit number,
--   this one DOES count inside the selected window — the question is "who
--   showed up most in this period". Returns visits (PageViews), total events,
--   purchases, revenue, distinct hosts touched, first_seen and last_seen.
--   LIMIT is applied before building the JSON so only the top rows are built.

-- gtm_top_visitors (2026-08-06, breakdown): each row now carries
-- `events_by_name`, a jsonb object with the count per event name
-- ({"page_view": 6, "add_to_cart": 1, ...}). An object rather than fixed
-- columns because the set of names is whatever the sGTM triggers send. The
-- LIMIT still applies before the breakdown runs, so it only builds top rows.

-- ------------------------------------------------------------
-- VTurb Analytics (Feature 17, 2026-08-13)
-- ------------------------------------------------------------

-- API token for the VTurb Analytics API, per workspace. Stored encrypted
-- (EncryptionService, AES-256-GCM) like the Facebook access tokens, and never
-- returned to the browser: every VTurb call is proxied by the backend.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS vturb_api_token text;
