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
