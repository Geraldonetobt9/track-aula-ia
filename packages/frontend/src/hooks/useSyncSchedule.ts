import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { SyncSchedule, SyncLog } from '@/types/sync';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

export function useSyncSchedule() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspaceContext();

  // Fetch schedule with dynamic refetch interval
  const { data: schedule, isLoading: loadingSchedule, refetch: refetchSchedule } = useQuery({
    queryKey: ['sync-schedule', user?.id, activeWorkspaceId],
    queryFn: async () => {
      if (!user?.id) return null;
      const params = new URLSearchParams();
      if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
      const data = await api.get<SyncSchedule[]>(`/integrations/sync-schedules?${params}`);
      const fbSchedule = (data || []).find(s => s.sync_type === 'facebook_ads');
      return fbSchedule || null;
    },
    enabled: !!user?.id,
    refetchInterval: (query) => {
      const data = query.state.data as SyncSchedule | null;
      return data?.last_sync_status === 'running' ? 5000 : 30000;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  // Fetch logs
  const { data: logs = [], isLoading: loadingLogs, refetch: refetchLogs } = useQuery({
    queryKey: ['sync-logs', user?.id, activeWorkspaceId],
    queryFn: async () => {
      if (!user?.id) return [];
      const params = new URLSearchParams({ sync_type: 'facebook_ads', limit: '20' });
      if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
      return api.get<SyncLog[]>(`/integrations/sync-logs?${params}`);
    },
    enabled: !!user?.id,
    staleTime: 0,
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      if (!schedule?.id) throw new Error('No schedule found');
      await api.patch(`/integrations/sync-schedules/${schedule.id}`, { is_active: isActive });
    },
    onSuccess: (_, isActive) => {
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
      toast({
        title: isActive ? 'Sincronização ativada' : 'Sincronização desativada',
        description: isActive
          ? 'Os dados serão sincronizados automaticamente.'
          : 'A sincronização automática foi pausada.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Erro ao atualizar',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Update interval mutation
  const updateIntervalMutation = useMutation({
    mutationFn: async (minutes: number) => {
      if (!schedule?.id) throw new Error('No schedule found');
      await api.patch(`/integrations/sync-schedules/${schedule.id}`, { interval_minutes: minutes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
      toast({
        title: 'Frequência atualizada',
        description: 'O intervalo de sincronização foi alterado.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Erro ao atualizar',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Create schedule if it doesn't exist
  const createSchedule = useCallback(async (_userId: string) => {
    try {
      await api.post('/integrations/sync-schedules', {
        sync_type: 'facebook_ads',
        interval_minutes: 30,
        is_active: true,
        workspace_id: activeWorkspaceId || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
    } catch (err) {
      console.error('Error creating schedule:', err);
    }
  }, [queryClient, activeWorkspaceId]);

  // Update schedule after manual sync
  const updateAfterSync = useCallback(async (result: {
    campaigns: number;
    adSets: number;
    ads: number;
  }, salesRematched: number = 0) => {
    // The backend handles sync schedule and log updates during sync
    // Just invalidate queries to refresh the UI
    queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
    queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
  }, [queryClient]);

  // Derived state
  const isActive = schedule?.is_active ?? false;
  const isSyncing = schedule?.last_sync_status === 'running';
  const hasError = schedule?.last_sync_status === 'error';

  const lastSyncFormatted = schedule?.last_sync_at
    ? formatDistanceToNow(new Date(schedule.last_sync_at), {
        addSuffix: true,
        locale: ptBR
      })
    : null;

  const nextSyncFormatted = schedule?.next_sync_at && schedule.is_active
    ? formatDistanceToNow(new Date(schedule.next_sync_at), {
        addSuffix: true,
        locale: ptBR
      })
    : null;

  return {
    schedule,
    logs,
    loading: loadingSchedule,
    loadingLogs,

    // Derived state
    isActive,
    isSyncing,
    hasError,
    lastSyncFormatted,
    nextSyncFormatted,

    // Actions
    toggleActive: (active: boolean) => toggleActiveMutation.mutateAsync(active),
    updateInterval: (minutes: number) => updateIntervalMutation.mutateAsync(minutes),
    createSchedule,
    updateAfterSync,
    refetch: () => {
      refetchSchedule();
      refetchLogs();
    },
  };
}
