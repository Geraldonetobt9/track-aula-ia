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
