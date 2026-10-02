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
  /** O pixel que recebeu o envio. */
  pixel_id: string | null;
}

/** Um campo do user_data: o dado de origem ao lado do que saiu para o Meta. */
export interface CapiUserDataField {
  key: string;
  label: string;
  original: string | null;
  normalized: string | null;
  sent: string | null;
  hashed: boolean;
  /** Veio da visita gravada no banco (no Purchase: IP, navegador, fbp, fbc...). */
  fromDatabase: boolean;
  /** O dado de hoje ainda produz o que foi enviado? */
  matches: boolean;
}

/** Um envio aberto: o corpo mandado ao Meta (sem o token) e a resposta dele. */
export interface CapiEventDetail extends Omit<CapiEventRow, 'sale_id' | 'pixel_id'> {
  request: { data: unknown[] };
  response: unknown;
  original: CapiUserDataField[];
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

/** Payload de um envio, buscado só quando alguém abre o detalhe. */
export function useCapiEvent(id: string | null) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const query = useQuery<CapiEventDetail, Error>({
    queryKey: ['capi-event', activeWorkspaceId, id],
    enabled: !!id && !!activeWorkspaceId,
    retry: false,
    queryFn: () => api.get<CapiEventDetail>(`/capi/events/${id}?workspace_id=${activeWorkspaceId}`),
  });
  return { event: query.data ?? null, loading: query.isLoading, error: query.error?.message ?? null };
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
