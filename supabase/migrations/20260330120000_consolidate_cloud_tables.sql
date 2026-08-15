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
