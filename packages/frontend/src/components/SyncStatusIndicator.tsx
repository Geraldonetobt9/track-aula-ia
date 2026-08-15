import { useSyncSchedule } from '@/hooks/useSyncSchedule';
import { useFacebookConnection } from '@/hooks/useFacebookConnection';
import { useFacebookSync } from '@/hooks/useFacebookSync';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocation } from 'react-router-dom';

export function SyncStatusIndicator() {
  const location = useLocation();
  const periodParam = new URLSearchParams(location.search).get('period');
  const period = periodParam === 'today' || periodParam === '7d' || periodParam === '30d' ? periodParam : undefined;

  const { isConfigured, isValid } = useFacebookConnection();
  const { isActive, isSyncing: scheduleSyncing, hasError, lastSyncFormatted } = useSyncSchedule();
  const { syncData, syncing } = useFacebookSync();

  if (!isConfigured) {
    return null;
  }

  // Combined syncing state from schedule and manual sync
  const isSyncing = scheduleSyncing || syncing;

  const getStatus = () => {
    if (isSyncing) {
      return {
        color: 'bg-foreground/40',
        text: 'Sincronizando...',
        animate: true,
      };
    }
    if (hasError || !isValid) {
      return {
        color: 'bg-foreground/30',
        text: 'Erro na sincronização',
        animate: false,
      };
    }
    if (isActive) {
      return {
        color: 'bg-primary',
        text: `Sync ativo · ${lastSyncFormatted || 'Nunca sincronizado'}`,
        animate: false,
      };
    }
    return {
      color: 'bg-muted-foreground',
      text: 'Sync inativo',
      animate: false,
    };
  };

  const status = getStatus();

  const handleSync = async () => {
    if (isSyncing) return;
    await syncData(period ? { period } : undefined);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-2 py-1 h-auto"
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                status.color,
                status.animate && 'animate-pulse'
              )}
            />
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground',
                isSyncing && 'animate-spin'
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{status.text}</p>
          {!isSyncing && <p className="text-xs text-muted-foreground">Clique para sincronizar</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
