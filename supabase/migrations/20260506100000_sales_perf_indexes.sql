-- Performance indexes for the Sales screen.
-- Server-side filtering, pagination, and aggregations all rely on
-- (workspace_id, sold_at) and (workspace_id, status, sold_at) lookups.
-- Use CONCURRENTLY so the migration does not block writes in production.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_workspace_sold_at_desc
  ON public.sales (workspace_id, sold_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_workspace_status_sold_at
  ON public.sales (workspace_id, status, sold_at DESC);

-- Partial index for the product filter dropdown (distinct product_name).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_workspace_product_name
  ON public.sales (workspace_id, product_name)
  WHERE product_name IS NOT NULL;
