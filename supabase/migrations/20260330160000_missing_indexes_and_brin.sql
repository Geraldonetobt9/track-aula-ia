-- Migration: Missing Indexes & BRIN Conversions
-- Adds indexes for RLS-referenced columns and query patterns found in codebase.
-- Converts B-tree to BRIN on append-only tables (10x smaller).
-- Note: CONCURRENTLY cannot be used inside Supabase migrations (transaction block).
-- For large production tables, run these manually with CONCURRENTLY outside a transaction.

-- ============================================================
-- Missing indexes for columns used in RLS or frequent queries
-- ============================================================

-- facebook_connections: RLS filters by user_id but no index exists
CREATE INDEX IF NOT EXISTS idx_facebook_connections_user_id
  ON public.facebook_connections USING btree (user_id);

-- daily_ad_spend: sync queries filter by facebook_connection_id
CREATE INDEX IF NOT EXISTS idx_daily_ad_spend_connection_id
  ON public.daily_ad_spend USING btree (facebook_connection_id);

-- ============================================================
-- Partial indexes for frequently filtered subsets
-- ============================================================

-- Webhook processing: always queries WHERE status = 'pending' ORDER BY next_retry_at
CREATE INDEX IF NOT EXISTS idx_webhook_queue_pending
  ON public.webhook_queue USING btree (next_retry_at)
  WHERE status = 'pending';

-- Dashboard/reports: almost always filter by approved sales
CREATE INDEX IF NOT EXISTS idx_sales_approved_user
  ON public.sales USING btree (user_id, sold_at DESC)
  WHERE status = 'approved';

-- ============================================================
-- BRIN indexes for append-only timestamp columns
-- BRIN is ~10x smaller than B-tree for monotonically increasing values
-- ============================================================

-- processing_jobs: append-only, created_at only used for time-range queries
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_brin
  ON public.processing_jobs USING brin (created_at);

-- sync_logs: replace existing B-tree with BRIN
DROP INDEX IF EXISTS idx_sync_logs_created_at;
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_brin
  ON public.sync_logs USING brin (created_at);

-- webhook_queue: append-only, BRIN for created_at range queries
CREATE INDEX IF NOT EXISTS idx_webhook_queue_created_brin
  ON public.webhook_queue USING brin (created_at);

-- ============================================================
-- Remove redundant single-column index covered by composite
-- ============================================================

-- idx_sales_user_id (user_id) is covered by idx_sales_user_sold_at (user_id, sold_at DESC)
-- which already exists in migration 20260330140000
DROP INDEX IF EXISTS idx_sales_user_id;
