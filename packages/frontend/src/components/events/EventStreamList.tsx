import { memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { GtmEvent } from '@/types/gtmEvents';

interface EventStreamListProps {
  events: GtmEvent[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (event: GtmEvent) => void;
}

const ROW_HEIGHT = 56;

/** Rows rendered outside the viewport, to keep fast scrolling from flashing blanks. */
const OVERSCAN = 8;

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const formatValue = (event: GtmEvent) => {
  if (event.value === null) return null;
  return `${event.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${
    event.currency ?? ''
  }`.trim();
};

/**
 * Memoized because while the stream is paused, buffered events keep updating
 * the page's counters. Without this, every buffered arrival would re-render the
 * list the user just asked to freeze.
 */
export const EventStreamList = memo(function EventStreamList({
  events,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onSelect,
}: EventStreamListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Virtualized because a live stream passes a hundred rows within minutes and
  // the DOM cost of keeping them all mounted shows up as scroll jank.
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full bg-foreground/5" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-muted-foreground">Nenhum evento recebido ainda</p>
        <p className="max-w-sm text-xs text-muted-foreground/60">
          Configure a tag no container do GTM Server apontando para a URL de ingestão em
          Integrações. Os eventos aparecem aqui assim que começarem a chegar.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div ref={scrollRef} className="h-[520px] overflow-auto">
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const event = events[virtualRow.index];
            const value = formatValue(event);
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => onSelect(event)}
                className="absolute left-0 top-0 flex w-full items-center gap-3 border-b border-foreground/5 px-4 text-left transition-colors hover:bg-foreground/[0.03]"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span className="w-[68px] shrink-0 text-xs tabular-nums text-muted-foreground/70">
                  {formatTime(event.created_at)}
                </span>
                <span className="w-[140px] shrink-0 truncate text-sm font-medium text-foreground">
                  {event.event_name}
                </span>
                <VisitBadge visitNumber={event.visit_number} />
                <span className="w-[120px] shrink-0 text-xs tabular-nums text-muted-foreground">
                  {value ?? '—'}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <CookieBadge label="fbp" present={event.has_fbp} />
                  <CookieBadge label="fbc" present={event.has_fbc} />
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground/50">
                  {event.event_id ?? 'sem event_id'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {hasMore && (
        <div className="flex justify-center border-t border-foreground/5 p-3">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </div>
  );
});

/**
 * How many visits that person had up to this event.
 *
 * The first visit is highlighted because "new person or returning one" is the
 * question this column is usually being scanned for.
 */
function VisitBadge({ visitNumber }: { visitNumber: number | null }) {
  if (visitNumber === null || visitNumber === 0) {
    return (
      <span
        className="w-[92px] shrink-0 text-xs text-muted-foreground/40"
        title={
          visitNumber === 0
            ? 'Nenhum PageView registrado desta pessoa antes deste evento'
            : 'Sem id_do_usuario nem _fbp — não dá para saber de quem é'
        }
      >
        —
      </span>
    );
  }

  return (
    <span className="w-[92px] shrink-0">
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
          visitNumber === 1
            ? 'bg-primary/10 text-accent-readable'
            : 'bg-foreground/5 text-muted-foreground',
        )}
      >
        {visitNumber}ª visita
      </span>
    </span>
  );
}

function CookieBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        present
          ? 'bg-primary/10 text-accent-readable'
          : 'bg-foreground/5 text-muted-foreground/40 line-through',
      )}
    >
      {label}
    </span>
  );
}
