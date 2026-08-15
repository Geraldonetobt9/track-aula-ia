-- Add ad-spend tax percentage to workspaces.
-- This is an income tax that incides on Meta Ads spend (e.g. user pays X% on
-- top of every R$ spent on ads). The value is shown in the dashboard and
-- discounted from profit on both /metrics/dashboard and /financial/summary.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ad_spend_tax_percentage numeric NOT NULL DEFAULT 0
  CHECK (ad_spend_tax_percentage >= 0 AND ad_spend_tax_percentage <= 100);
