
-- Create workspaces table
CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own workspaces"
  ON public.workspaces FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workspaces"
  ON public.workspaces FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workspaces"
  ON public.workspaces FOR DELETE
  USING (auth.uid() = user_id);

-- Mapping: workspace <-> facebook_connection (external IDs stored as text)
CREATE TABLE public.workspace_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  facebook_connection_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, facebook_connection_id)
);

ALTER TABLE public.workspace_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace connections via workspace ownership"
  ON public.workspace_connections FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid())
  );

-- Mapping: workspace <-> checkout_integration (external IDs stored as text)
CREATE TABLE public.workspace_checkout_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  checkout_integration_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, checkout_integration_id)
);

ALTER TABLE public.workspace_checkout_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace checkout integrations via workspace ownership"
  ON public.workspace_checkout_integrations FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid())
  );

-- Add max_workspaces to plan_rules
ALTER TABLE public.plan_rules ADD COLUMN max_workspaces INTEGER NOT NULL DEFAULT 1;

-- Trigger for updated_at on workspaces
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.update_plan_rules_updated_at();
