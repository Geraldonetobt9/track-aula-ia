import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface StatusSelectProps {
  status: string;
  facebookId: string | null;
  isUpdating: boolean;
  onStatusChange: (newStatus: 'ACTIVE' | 'PAUSED') => void;
}

export function StatusSelect({ status, facebookId, isUpdating, onStatusChange }: StatusSelectProps) {
  const handleChange = (value: string) => {
    if (value === status) return;
    const newFbStatus = value === 'active' ? 'ACTIVE' : 'PAUSED';
    onStatusChange(newFbStatus);
  };

  if (isUpdating) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-xs">Atualizando...</span>
      </div>
    );
  }

  return (
    <Select
      value={status}
      onValueChange={handleChange}
      disabled={!facebookId}
    >
      <SelectTrigger
        className={cn(
          "h-7 w-[110px] text-xs font-semibold border-0 focus:ring-0 focus:ring-offset-0",
          status === 'active'
            ? "bg-primary/20 text-accent-readable hover:bg-primary/30"
            : "bg-muted text-muted-foreground hover:bg-muted/80",
          !facebookId && "opacity-50 cursor-not-allowed"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        <SelectItem value="active">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Ativo
          </span>
        </SelectItem>
        <SelectItem value="paused">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
            Pausado
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
