
CREATE TABLE public.company_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.company_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own costs"
ON public.company_costs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own costs"
ON public.company_costs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own costs"
ON public.company_costs FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own costs"
ON public.company_costs FOR UPDATE
USING (auth.uid() = user_id);
