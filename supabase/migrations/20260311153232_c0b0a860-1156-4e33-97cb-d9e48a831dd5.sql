CREATE TABLE public.workspace_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, product_name)
);

ALTER TABLE public.workspace_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace products via workspace ownership"
  ON public.workspace_products
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE workspaces.id = workspace_products.workspace_id
      AND workspaces.user_id = auth.uid()
  ));