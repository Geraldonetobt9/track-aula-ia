import { cn } from '@/lib/utils';
import { STATUS_LABELS, type AbStatus } from '@/hooks/useAbTests';

const TONES: Record<AbStatus, string> = {
  draft: 'bg-foreground/8 text-muted-foreground',
  running: 'bg-success/15 text-success',
  paused: 'bg-warning/15 text-warning',
  finished: 'bg-info/15 text-info',
};

export function AbStatusBadge({ status, className }: { status: AbStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[status],
        className,
      )}
    >
      {status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {STATUS_LABELS[status]}
    </span>
  );
}
