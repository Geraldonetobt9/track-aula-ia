-- Migration: Add ON DELETE CASCADE to workspace_connections.facebook_connection_id FK
-- Fix: Deleting a facebook_connection fails when workspace_connections rows reference it.
-- workspace_connections are link records with no standalone meaning, so cascade is correct.

ALTER TABLE public.workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_facebook_connection_id_fkey;

ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_facebook_connection_id_fkey
  FOREIGN KEY (facebook_connection_id)
  REFERENCES public.facebook_connections(id)
  ON DELETE CASCADE;
