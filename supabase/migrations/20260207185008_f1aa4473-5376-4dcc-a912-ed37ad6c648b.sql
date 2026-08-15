-- Create sync_schedules table for managing automatic sync scheduling
CREATE TABLE public.sync_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sync_type text NOT NULL DEFAULT 'facebook_ads',
  interval_minutes integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  last_sync_status text DEFAULT 'pending',
  last_sync_error text,
  last_sync_duration_ms integer,
  synced_campaigns integer DEFAULT 0,
  synced_ad_sets integer DEFAULT 0,
  synced_ads integer DEFAULT 0,
  consecutive_errors integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sync_type)
);

-- Create sync_logs table for detailed sync history
CREATE TABLE public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sync_schedule_id uuid REFERENCES public.sync_schedules(id) ON DELETE SET NULL,
  sync_type text NOT NULL DEFAULT 'facebook_ads',
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  campaigns_synced integer DEFAULT 0,
  ad_sets_synced integer DEFAULT 0,
  ads_synced integer DEFAULT 0,
  sales_rematched integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.sync_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for sync_schedules
CREATE POLICY "Users can view their own sync schedules"
  ON public.sync_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own sync schedules"
  ON public.sync_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sync schedules"
  ON public.sync_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sync schedules"
  ON public.sync_schedules FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for sync_logs
CREATE POLICY "Users can view their own sync logs"
  ON public.sync_logs FOR SELECT USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_sync_logs_created_at ON public.sync_logs(created_at);
CREATE INDEX idx_sync_logs_user_id ON public.sync_logs(user_id, created_at DESC);
CREATE INDEX idx_sync_schedules_next_sync ON public.sync_schedules(next_sync_at) WHERE is_active = true;

-- Trigger for updated_at on sync_schedules
CREATE TRIGGER update_sync_schedules_updated_at
  BEFORE UPDATE ON public.sync_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();