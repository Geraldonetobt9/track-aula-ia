export interface SyncSchedule {
  id: string;
  user_id: string;
  sync_type: string;
  interval_minutes: number;
  is_active: boolean;
  last_sync_at: string | null;
  next_sync_at: string | null;
  last_sync_status: 'success' | 'error' | 'pending' | 'running';
  last_sync_error: string | null;
  last_sync_duration_ms: number | null;
  synced_campaigns: number;
  synced_ad_sets: number;
  synced_ads: number;
  consecutive_errors: number;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  user_id: string;
  sync_schedule_id: string | null;
  sync_type: string;
  status: 'success' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  campaigns_synced: number;
  ad_sets_synced: number;
  ads_synced: number;
  sales_rematched: number;
  error_message: string | null;
  created_at: string;
}

export type SyncStatus = 'active' | 'syncing' | 'error' | 'inactive';

export interface SyncIntervalOption {
  value: number;
  label: string;
}

export const SYNC_INTERVAL_OPTIONS: SyncIntervalOption[] = [
  { value: 15, label: '15 minutos' },
  { value: 30, label: '30 minutos' },
  { value: 60, label: '1 hora' },
  { value: 180, label: '3 horas' },
  { value: 360, label: '6 horas' },
  { value: 720, label: '12 horas' },
];
