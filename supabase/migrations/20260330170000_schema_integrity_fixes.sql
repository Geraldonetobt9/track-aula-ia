-- Migration: Schema Integrity Fixes
-- 1. Add missing updated_at trigger on workspaces
-- 2. Fix workspace_connections.facebook_connection_id: text -> uuid with FK
-- 3. Fix workspace_checkout_integrations.checkout_integration_id: text -> uuid with FK

-- ============================================================
-- 1. Missing trigger: workspaces.updated_at
-- The column exists but there's no trigger to auto-update it
-- ============================================================
CREATE OR REPLACE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. Fix workspace_connections.facebook_connection_id
-- Currently TEXT, should be UUID with FK to facebook_connections.id
-- This ensures referential integrity (can't point to deleted connections)
-- ============================================================

-- Drop the unique constraint that depends on the column
ALTER TABLE public.workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_workspace_id_facebook_connection_id_key;

-- Convert text -> uuid
ALTER TABLE public.workspace_connections
  ALTER COLUMN facebook_connection_id TYPE uuid USING facebook_connection_id::uuid;

-- Add FK constraint
ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_facebook_connection_id_fkey
  FOREIGN KEY (facebook_connection_id) REFERENCES public.facebook_connections(id);

-- Recreate unique constraint
ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_workspace_id_facebook_connection_id_key
  UNIQUE (workspace_id, facebook_connection_id);

-- ============================================================
-- 3. Fix workspace_checkout_integrations.checkout_integration_id
-- Currently TEXT, should be UUID with FK to checkout_integrations.id
-- ============================================================

-- Drop the unique constraint that depends on the column
ALTER TABLE public.workspace_checkout_integrations
  DROP CONSTRAINT IF EXISTS workspace_checkout_integratio_workspace_id_checkout_integra_key;

-- Convert text -> uuid
ALTER TABLE public.workspace_checkout_integrations
  ALTER COLUMN checkout_integration_id TYPE uuid USING checkout_integration_id::uuid;

-- Add FK constraint
ALTER TABLE public.workspace_checkout_integrations
  ADD CONSTRAINT workspace_checkout_integrations_checkout_integration_id_fkey
  FOREIGN KEY (checkout_integration_id) REFERENCES public.checkout_integrations(id);

-- Recreate unique constraint
ALTER TABLE public.workspace_checkout_integrations
  ADD CONSTRAINT workspace_checkout_integratio_workspace_id_checkout_integra_key
  UNIQUE (workspace_id, checkout_integration_id);
