-- ============================================================
-- financial_entries: allow the 'tax' type
-- ============================================================
-- Adds a second, independent tax: a monetary amount the user records per month.
-- It does NOT replace workspaces.ad_spend_tax_percentage — the two coexist and
-- are shown side by side on /financial. The percentage one is applied over Meta
-- Ads spend and is summed into "Gasto com Ads"; this one is typed in by hand and
-- subtracted from profit on its own.
--
-- Reusing financial_entries means the period filters, the year/total aggregation
-- and the month import all keep working unchanged.

ALTER TABLE public.financial_entries
  DROP CONSTRAINT IF EXISTS financial_entries_type_check;

ALTER TABLE public.financial_entries
  ADD CONSTRAINT financial_entries_type_check
  CHECK (type = ANY (ARRAY['expense'::text, 'revenue'::text, 'tax'::text]));

-- The page always reads entries scoped to a workspace and a reference_month
-- range, so keep that path indexed as the table grows.
--
-- Built without CONCURRENTLY on purpose: migrations run inside a transaction
-- (both the Supabase SQL editor and `supabase db push`), and CONCURRENTLY is
-- rejected there. The usual reason to pay that cost — avoiding a write lock on
-- a large table — does not apply: financial_entries holds a handful of manual
-- rows per workspace per month, so the build is effectively instant.
CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_month_type
  ON public.financial_entries (workspace_id, reference_month, type);
