import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useFacebookConnection } from '@/hooks/useFacebookConnection';
import { useFacebookSync } from '@/hooks/useFacebookSync';
import { useRefetch } from '@/contexts/RefetchContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface SyncButtonProps {
  variant?: 'outline' | 'ghost';
  size?: 'sm' | 'default' | 'icon';
  showLabel?: boolean;
}

/**
 * Busca os dados no Meta e depois recarrega as telas.
 *
 * Antes este botao so chamava triggerRefetch(), que re-executa as consultas ao
 * banco. Com o banco vazio isso relia zero e continuava zero: nada nunca
 * buscava as campanhas no Meta.
 *
 * A sincronizacao existia em useFacebookSync, mas o unico componente que a
 * chamava (SyncStatusIndicator) nao era renderizado em lugar nenhum — desde o
 * projeto original. La isso passava despercebido porque o backend ficava de pe
 * no Render e algo externo disparava a sincronizacao periodicamente. Em funcao
 * serverless nao ha processo permanente, entao o gatilho manual deixou de ser
 * conveniencia e virou o unico caminho.
 */
export function SyncButton({ variant = 'outline', size = 'sm', showLabel = true }: SyncButtonProps) {
  const { isConfigured, isValid, loading } = useFacebookConnection();
  const { syncData, syncing } = useFacebookSync();
  const { triggerRefetch } = useRefetch();
  const { toast } = useToast();

  if (loading || !isConfigured || !isValid) return null;

  const handleSync = async () => {
    try {
      const ok = await syncData();

      // Recarrega as telas so depois que os dados chegaram.
      triggerRefetch();

      toast({
        title: ok ? 'Dados atualizados' : 'Sincronizacao nao concluida',
        description: ok
          ? 'As campanhas e o gasto foram buscados no Meta.'
          : 'Verifique a conexao em Integracoes.',
        variant: ok ? undefined : 'destructive',
      });
    } catch (err) {
      toast({
        title: 'Erro ao sincronizar',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSync}
      disabled={syncing}
      className={cn('gap-2', syncing && 'opacity-70')}
      title="Buscar dados no Meta e atualizar"
    >
      <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
      {showLabel && (syncing ? 'Sincronizando...' : 'Atualizar')}
    </Button>
  );
}
