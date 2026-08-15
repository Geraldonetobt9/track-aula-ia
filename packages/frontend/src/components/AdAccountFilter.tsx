import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown } from 'lucide-react';
import { useFacebookConnection, FacebookConnectionInfo } from '@/hooks/useFacebookConnection';
import { cn } from '@/lib/utils';

interface AdAccountFilterProps {
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function AdAccountFilter({ selectedIds, onSelectionChange }: AdAccountFilterProps) {
  const { connections, loading } = useFacebookConnection();
  const [open, setOpen] = useState(false);

  const activeConnections = useMemo(
    () => connections.filter((c) => c.is_active && c.is_valid),
    [connections],
  );

  if (loading || activeConnections.length <= 1) return null;

  const allSelected = selectedIds.length === 0 || selectedIds.length === activeConnections.length;

  const handleToggle = (connId: string) => {
    if (selectedIds.length === 0) {
      // "All" was selected — switch to all except this one
      const allExceptThis = activeConnections.filter((c) => c.id !== connId).map((c) => c.id);
      onSelectionChange(allExceptThis);
      return;
    }

    if (selectedIds.includes(connId)) {
      const next = selectedIds.filter((id) => id !== connId);
      onSelectionChange(next.length === 0 ? [] : next);
    } else {
      const next = [...selectedIds, connId];
      onSelectionChange(next.length === activeConnections.length ? [] : next);
    }
  };

  const handleSelectAll = () => {
    onSelectionChange([]);
  };

  const getLabel = () => {
    if (allSelected) return 'Todas as contas';
    if (selectedIds.length === 1) {
      const conn = activeConnections.find((c) => c.id === selectedIds[0]);
      return conn?.account_name || `act_****${conn?.ad_account_id?.slice(-4) || ''}`;
    }
    return `${selectedIds.length} contas`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'gap-1.5 text-xs h-8',
            !allSelected && 'border-accent-readable/30 text-accent-readable',
          )}
        >
          {getLabel()}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="space-y-1">
          <button
            onClick={handleSelectAll}
            className={cn(
              'flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-foreground/5 transition-colors',
              allSelected && 'text-accent-readable',
            )}
          >
            <Checkbox checked={allSelected} className="h-3.5 w-3.5" />
            <span>Todas as contas</span>
          </button>

          <div className="h-px bg-foreground/5 my-1" />

          {activeConnections.map((conn) => {
            const isChecked = allSelected || selectedIds.includes(conn.id);
            const displayName = conn.account_name || conn.ad_account_id;

            return (
              <button
                key={conn.id}
                onClick={() => handleToggle(conn.id)}
                className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-foreground/5 transition-colors text-left"
              >
                <Checkbox checked={isChecked} className="h-3.5 w-3.5" />
                <span className="truncate">{displayName}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
