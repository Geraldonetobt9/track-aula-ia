CREATE TABLE public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('expense', 'revenue')),
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  reference_month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage financial entries via workspace ownership"
  ON public.financial_entries FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE workspaces.id = financial_entries.workspace_id
      AND workspaces.user_id = auth.uid()
  ));