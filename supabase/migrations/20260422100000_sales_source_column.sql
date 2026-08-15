-- Add source marker to sales for webhook vs import distinction.
-- Plan-limit count queries only count source='webhook'.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (source IN ('webhook', 'import', 'manual'));

-- Partial index matching the plan-limit count predicate.
-- (user_id, sold_at DESC) WHERE status='approved' AND blocked_by_limit=false AND source='webhook'
--
-- Note: not using CONCURRENTLY here because this migration is applied via the
-- Supabase SQL Editor, which wraps statements in a transaction (CONCURRENTLY
-- cannot run inside a transaction block). The index is created at feature-launch
-- time when the table's row count is low, so the brief write lock is acceptable.
CREATE INDEX IF NOT EXISTS idx_sales_planlimits_webhook
  ON public.sales (user_id, sold_at DESC)
  WHERE status = 'approved' AND blocked_by_limit = false AND source = 'webhook';
