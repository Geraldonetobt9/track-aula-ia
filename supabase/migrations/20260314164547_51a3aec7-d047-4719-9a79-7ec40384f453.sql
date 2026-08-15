CREATE POLICY "Users can update financial entries"
ON public.financial_entries
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspaces
    WHERE workspaces.id = financial_entries.workspace_id
    AND workspaces.user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM workspaces
    WHERE workspaces.id = financial_entries.workspace_id
    AND workspaces.user_id = auth.uid()
  )
);