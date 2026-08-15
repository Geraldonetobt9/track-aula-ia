-- Performance indexes for common query patterns
-- Note: CONCURRENTLY removed because Supabase migrations run inside a transaction.
-- For large production tables, run these manually with CONCURRENTLY outside a transaction.

-- Dashboard and sales page: filter by user + date
CREATE INDEX IF NOT EXISTS idx_sales_user_sold_at
  ON public.sales(user_id, sold_at DESC);

-- Daily ad spend: filter by user + date
CREATE INDEX IF NOT EXISTS idx_daily_ad_spend_user_date_desc
  ON public.daily_ad_spend(user_id, date DESC);

-- Profile FK join on plan_id
CREATE INDEX IF NOT EXISTS idx_profiles_plan_id
  ON public.profiles(plan_id);

-- BRIN indexes for append-only timestamp columns (10x smaller than B-tree)

-- Drop existing B-tree on webhook_queue.created_at if exists, replace with BRIN
DROP INDEX IF EXISTS idx_webhook_queue_created;
CREATE INDEX IF NOT EXISTS idx_webhook_queue_created_brin
  ON public.webhook_queue USING brin(created_at);

-- BRIN on sync_logs.created_at
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_brin
  ON public.sync_logs USING brin(created_at);
