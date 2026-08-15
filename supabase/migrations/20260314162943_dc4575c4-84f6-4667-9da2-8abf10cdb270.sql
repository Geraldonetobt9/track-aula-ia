
DROP POLICY "Users manage financial entries via workspace ownership" ON public.financial_entries;

CREATE POLICY "Users can select financial entries" ON public.financial_entries
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM workspaces
  WHERE workspaces.id = financial_entries.workspace_id
  AND workspaces.user_id = auth.uid()
));

CREATE POLICY "Users can insert financial entries" ON public.financial_entries
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM workspaces
    WHERE workspaces.id = financial_entries.workspace_id
    AND workspaces.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete financial entries" ON public.financial_entries
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM workspaces
  WHERE workspaces.id = financial_entries.workspace_id
  AND workspaces.user_id = auth.uid()
));
