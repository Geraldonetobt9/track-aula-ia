-- Create processing_jobs table for background job tracking
CREATE TABLE public.processing_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'sync',
  status TEXT NOT NULL DEFAULT 'processing',
  progress INTEGER DEFAULT 0,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

-- Users can view their own jobs
CREATE POLICY "Users can view their own jobs" 
ON public.processing_jobs 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users can insert their own jobs
CREATE POLICY "Users can insert their own jobs" 
ON public.processing_jobs 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for edge functions)
CREATE POLICY "Service role full access" 
ON public.processing_jobs 
FOR ALL 
USING (auth.role() = 'service_role');

-- Add index for faster lookups
CREATE INDEX idx_processing_jobs_user_status ON public.processing_jobs(user_id, status);

-- Trigger for updated_at
CREATE TRIGGER update_processing_jobs_updated_at
BEFORE UPDATE ON public.processing_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();