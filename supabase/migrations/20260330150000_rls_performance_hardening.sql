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
