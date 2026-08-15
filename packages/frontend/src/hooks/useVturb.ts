import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { DateRange } from '@/components/DateRangeFilter';
import { VturbOverview, VturbVideoDetail } from '@/types/vturb';

/**
 * VTurb aggregates on their side and the backend fans out one request per
 * video, so this data is expensive and never real time. The backend caches it
 * for five minutes; matching that here avoids refetching what it would answer
 * from cache anyway.
 */
const OVERVIEW_STALE_MS = 5 * 60_000;
const DETAIL_STALE_MS = 60_000;

/**
 * VTurb filters dates inclusively on both ends, so the range goes through as
 * plain days with no exclusive-end conversion.
 */
function toRangeParams(workspaceId: string, range: DateRange): URLSearchParams {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (!range.allTime) {
    params.set('from', format(range.from, 'yyyy-MM-dd'));
    params.set('to', format(range.to, 'yyyy-MM-dd'));
  }
  return params;
}

export function useVturbStatus() {
  const { activeWorkspaceId } = useWorkspaceContext();

  return useQuery<{ configured: boolean }>({
    queryKey: ['vturb-status', activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    staleTime: OVERVIEW_STALE_MS,
    queryFn: () => api.get(`/vturb/status?workspace_id=${activeWorkspaceId}`),
  });
}

export function useVturbOverview(range: DateRange, enabled: boolean) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const params = activeWorkspaceId ? toRangeParams(activeWorkspaceId, range) : null;

  return useQuery<VturbOverview>({
    queryKey: ['vturb-overview', activeWorkspaceId, params?.toString()],
    enabled: enabled && !!activeWorkspaceId,
    staleTime: OVERVIEW_STALE_MS,
    // A quota rejection does not get better by trying again immediately.
    retry: false,
    queryFn: () => api.get<VturbOverview>(`/vturb/overview?${params}`),
  });
}

export function useVturbVideo(playerId: string | null, range: DateRange) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const params = activeWorkspaceId ? toRangeParams(activeWorkspaceId, range) : null;

  return useQuery<VturbVideoDetail>({
    queryKey: ['vturb-video', activeWorkspaceId, playerId, params?.toString()],
    enabled: !!playerId && !!activeWorkspaceId,
    staleTime: DETAIL_STALE_MS,
    retry: false,
    queryFn: () => api.get<VturbVideoDetail>(`/vturb/videos/${playerId}?${params}`),
  });
}

export function useSaveVturbToken() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) =>
      api.post<{ players: number }>('/vturb/token', {
        workspace_id: activeWorkspaceId,
        token,
      }),
    onSuccess: () => {
      // Both the gate and the data behind it change with the key.
      queryClient.invalidateQueries({ queryKey: ['vturb-status'] });
      queryClient.invalidateQueries({ queryKey: ['vturb-overview'] });
      queryClient.invalidateQueries({ queryKey: ['vturb-video'] });
    },
  });
}

export function useRemoveVturbToken() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/vturb/token?workspace_id=${activeWorkspaceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vturb-status'] });
      queryClient.invalidateQueries({ queryKey: ['vturb-overview'] });
    },
  });
}
