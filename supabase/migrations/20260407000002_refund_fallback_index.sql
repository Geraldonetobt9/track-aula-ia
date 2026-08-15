-- Index to support fallback refund matching when external_id doesn't match.
-- Used by webhooksService.findAndRefundOriginalSale() to find the most recent
-- approved sale by (user_id, checkout_integration_id, customer_email, product_name).
-- Partial index (only approved rows) keeps the index small and write-overhead minimal.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_refund_fallback
  ON public.sales (user_id, checkout_integration_id, customer_email, product_name, sold_at DESC)
  WHERE status = 'approved';
