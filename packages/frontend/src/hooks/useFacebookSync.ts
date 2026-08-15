import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useRefetch } from '@/contexts/RefetchContext';
import { useFacebookConnection } from '@/hooks/useFacebookConnection';

interface SyncResult {
  campaigns: number;
  adSets: number;
  ads: number;
}

interface SyncPeriod {
  start: string;
  end: string;
}

interface RematchResult {
  total_unmatched: number;
  rematched: number;
  still_unmatched: number;
}

type SyncOptions = {
  period?: 'today' | '7d' | '30d';
  since?: string;
  until?: string;
  silent?: boolean;
};

export function useFacebookSync() {
  const [syncing, setSyncing] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [lastSyncPeriod, setLastSyncPeriod] = useState<SyncPeriod | null>(null);
  const [lastRematchResult, setLastRematchResult] = useState<RematchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { triggerRefetch } = useRefetch();
  const { connections } = useFacebookConnection();

  // Use ref to always access latest connections (avoids stale closures)
  const connectionsRef = useRef(connections);
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  const rematchSales = async (): Promise<RematchResult | null> => {
    setRematching(true);

    try {
      const data = await api.post<RematchResult & { success: boolean; error?: string }>('/facebook/rematch', {});

      if (!data?.success) {
        throw new Error(data?.error || 'Falha no rematch');
      }

      setLastRematchResult(data);

      if (data.rematched > 0) {
        toast({
          title: 'Vendas re-associadas!',
          description: `${data.rematched} vendas foram vinculadas a anúncios do Facebook.`,
        });
      }

      return data;
    } catch (err: any) {
      console.error('Rematch error:', err);
      return null;
    } finally {
      setRematching(false);
    }
  };

  const syncSingleConnection = async (connectionId: string, options?: SyncOptions): Promise<SyncResult | null> => {
    const { period, since, until } = options ?? {};
    const data = await api.post<any>('/facebook/insights/sync', {
      ...(period ? { period } : {}),
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
      connection_id: connectionId,
    });

    if (!data?.success || !data?.job_id) throw new Error(data?.error || 'Falha ao iniciar sincronização');

    // Poll for job completion
    const startTime = Date.now();
    const maxWaitMs = 300000;
    let delay = 3000;
    const maxDelay = 6000;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const jobStatus = await api.get<any>(`/facebook/insights/job/${data.job_id}`);

        consecutiveErrors = 0;

        if (jobStatus.status === 'completed') {
          const result = jobStatus.result;
          setLastSyncPeriod(result.period);
          return result.synced as SyncResult;
        }

        if (jobStatus.status === 'failed') {
          throw new Error(jobStatus.error || 'Sincronização falhou');
        }
      } catch (pollError: any) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) throw pollError;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.3, maxDelay);
    }

    throw new Error('Sincronização expirou. Tente novamente.');
  };

  const syncData = async (options?: SyncOptions): Promise<boolean> => {
    const silent = options?.silent ?? false;
    setSyncing(true);
    setSyncProgress(0);
    setError(null);

    try {
      const connectionsToSync = connectionsRef.current.length > 0 ? connectionsRef.current : [];
      if (connectionsToSync.length === 0) {
        throw new Error('Nenhuma conta de anúncios conectada.');
      }

      if (!silent) {
        toast({
          title: 'Sincronização iniciada',
          description: `Processando ${connectionsToSync.length} conta(s) de anúncios...`,
        });
      }

      const accumulated: SyncResult = { campaigns: 0, adSets: 0, ads: 0 };
      let syncedCount = 0;

      for (const conn of connectionsToSync) {
        try {
          const result = await syncSingleConnection(conn.id, options);
          if (result) {
            accumulated.campaigns += result.campaigns;
            accumulated.adSets += result.adSets;
            accumulated.ads += result.ads;
            syncedCount++;
          }
          setSyncProgress(Math.round((syncedCount / connectionsToSync.length) * 100));
        } catch (connErr: any) {
          console.warn(`Sync failed for connection ${conn.id}:`, connErr?.message);
          // Continue with next connection
        }
      }

      if (syncedCount === 0) {
        throw new Error('Nenhuma conta sincronizou com sucesso.');
      }

      setLastSyncResult(accumulated);

      if (!silent) {
        toast({
          title: 'Sincronização concluída!',
          description: `${accumulated.campaigns} campanhas, ${accumulated.adSets} conjuntos e ${accumulated.ads} anúncios sincronizados em ${syncedCount} conta(s).`,
        });
      }

      // Rematch sales once after all connections synced
      const rematchResult = await rematchSales();
      if (!silent && rematchResult && rematchResult.rematched > 0) {
        toast({
          title: 'Atribuição de vendas atualizada!',
          description: `${rematchResult.rematched} vendas foram vinculadas aos anúncios sincronizados.`,
        });
      }

      triggerRefetch();
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['adSets'] });
      queryClient.invalidateQueries({ queryKey: ['ads'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] });

      return true;
    } catch (err: any) {
      console.error('Sync error:', err);
      setError(err.message);

      if (!silent) {
        toast({
          title: 'Erro na sincronização',
          description: err.message || 'Não foi possível sincronizar os dados.',
          variant: 'destructive',
        });
      }

      return false;
    } finally {
      setSyncing(false);
      setSyncProgress(0);
    }
  };

  return {
    syncData,
    rematchSales,
    syncing,
    rematching,
    syncProgress,
    lastSyncResult,
    lastSyncPeriod,
    lastRematchResult,
    error,
  };
}
