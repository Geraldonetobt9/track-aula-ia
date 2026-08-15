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
