
-- Create webhook queue table for async processing
CREATE TABLE public.webhook_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for efficient polling
CREATE INDEX idx_webhook_queue_pending ON public.webhook_queue (status, next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_webhook_queue_created ON public.webhook_queue (created_at);

-- Enable RLS
ALTER TABLE public.webhook_queue ENABLE ROW LEVEL SECURITY;

-- Only service role can access (edge functions use service role)
-- No public policies needed since this is internal infrastructure
