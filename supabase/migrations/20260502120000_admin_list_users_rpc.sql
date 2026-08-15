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
