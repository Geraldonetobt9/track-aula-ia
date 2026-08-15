import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useFacebookConnection } from '@/hooks/useFacebookConnection';
import { useRefetch } from '@/contexts/RefetchContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface SyncButtonProps {
  variant?: 'outline' | 'ghost';
  size?: 'sm' | 'default' | 'icon';
  showLabel?: boolean;
}

export function SyncButton({ variant = 'outline', size = 'sm', showLabel = true }: SyncButtonProps) {
  const { isConfigured, isValid, loading } = useFacebookConnection();
  const { triggerRefetch } = useRefetch();
  const [refreshing, setRefreshing] = useState(false);

  if (loading || !isConfigured || !isValid) return null;

  const handleRefresh = () => {
    setRefreshing(true);
    triggerRefetch();
    // Visual feedback for 1s
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleRefresh}
      disabled={refreshing}
      className={cn('gap-2', refreshing && 'opacity-70')}
      title="Atualizar dados"
    >
      <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
      {showLabel && (refreshing ? 'Atualizando...' : 'Atualizar')}
    </Button>
  );
}
