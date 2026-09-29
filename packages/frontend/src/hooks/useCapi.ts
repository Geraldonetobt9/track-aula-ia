import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import type { TrackingParam } from '@/lib/trackingPlatforms';

export interface CapiSettings {
  tracking_platform: string | null;
  tracking_param: TrackingParam;
  tracking_domain: string | null;
  meta_pixel_id: string | null;
  meta_test_event_code: string | null;
  meta_mirror_browser: boolean;
  /** O token nunca volta: só se sabe se existe. */
  has_capi_token: boolean;
}

export interface CapiSettingsUpdate {
  tracking_platform?: string;
  tracking_param?: TrackingParam;
  tracking_domain?: string;
  meta_pixel_id?: string;
  /** Vazio apaga; omitido mantém. */
  meta_capi_token?: string;
  meta_test_event_code?: string;
  meta_mirror_browser?: boolean;
}

export interface CapiEventRow {
  id: string;
  event_name: string;
  event_id: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  error: string | null;
  fbtrace_id: string | null;
  created_at: string;
  sent_at: string | null;
  sale_id: string | null;
}

export interface CapiEventsResponse {
  summary: Record<string, { sent: number; failed: number }>;
  events: CapiEventRow[];
}

export function useCapiSettings() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = ['capi-settings', activeWorkspaceId];

  const query = useQuery<CapiSettings, Error>({
    queryKey: key,
    enabled: !!activeWorkspaceId,
    retry: false,
    queryFn: () => api.get<CapiSettings>(`/capi/settings?workspace_id=${activeWorkspaceId}`),
  });

  const mutation = useMutation<CapiSettings, Error, CapiSettingsUpdate>({
    mutationFn: (update) => api.patch<CapiSettings>('/capi/settings', { workspace_id: activeWorkspaceId, ...update }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  return {
    settings: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    save: mutation.mutateAsync,
    saving: mutation.isPending,
  };
}

/** Últimos envios à CAPI. Atualiza sozinho enquanto a tela está aberta. */
export function useCapiEvents(enabled = true) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = ['capi-events', activeWorkspaceId];

  const query = useQuery<CapiEventsResponse, Error>({
    queryKey: key,
    enabled: enabled && !!activeWorkspaceId,
    refetchInterval: 30_000,
    retry: false,
    queryFn: () => api.get<CapiEventsResponse>(`/capi/events?workspace_id=${activeWorkspaceId}`),
  });

  const retry = useMutation<{ retried: number; sent: number }, Error>({
    mutationFn: () => api.post('/capi/retry', { workspace_id: activeWorkspaceId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    retry: retry.mutateAsync,
    retrying: retry.isPending,
  };
}
