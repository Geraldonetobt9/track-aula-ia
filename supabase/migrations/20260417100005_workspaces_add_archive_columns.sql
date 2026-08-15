-- supabase/migrations/20260417100005_workspaces_add_archive_columns.sql

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workspaces_active
  ON public.workspaces(user_id) WHERE archived_at IS NULL;

COMMENT ON COLUMN public.workspaces.archived_at IS
  'Quando NOT NULL, workspace foi arquivado (tipicamente por downgrade). Dados preservados.';
COMMENT ON COLUMN public.workspaces.archived_by_system IS
  'true se foi arquivado pelo auto-trim de downgrade; false se foi manual.';
