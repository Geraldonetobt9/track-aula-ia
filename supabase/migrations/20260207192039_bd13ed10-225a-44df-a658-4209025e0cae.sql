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