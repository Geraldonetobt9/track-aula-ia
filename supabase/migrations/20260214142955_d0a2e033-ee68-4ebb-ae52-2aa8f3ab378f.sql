
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
