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
-- wraps each migration in a transaction (CREATE INDEX CONCURRENTLY would fail
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
