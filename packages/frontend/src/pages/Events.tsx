import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { endOfDay } from 'date-fns';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { isOperatorEmail } from '@/lib/featureAccess';
import { useGtmEventStream } from '@/hooks/useGtmEventStream';
import { useGtmTopVisitors } from '@/hooks/useGtmTopVisitors';
import { DateRangeFilter, DateRange } from '@/components/DateRangeFilter';
import { EventStreamList } from '@/components/events/EventStreamList';
import { EventDetailDrawer } from '@/components/events/EventDetailDrawer';
import { TopVisitorsTable } from '@/components/events/TopVisitorsTable';
import { GtmEvent } from '@/types/gtmEvents';

const ALL_EVENTS = '__all__';

/** Placeholder start for the all-time default; `allTime` is what the request acts on. */
const ALL_TIME_PLACEHOLDER_START = new Date(2015, 0, 1);

/**
 * Defaults to everything.
 *
 * Retention already caps this at 30 days, and a diagnostics screen that hides
 * data behind a filter you did not set is a good way to chase a bug that is not
 * there.
 */
function defaultRange(): DateRange {
  return { from: ALL_TIME_PLACEHOLDER_START, to: endOfDay(new Date()), allTime: true };
}

export default function Events() {
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspaceContext();
  const [eventNameFilter, setEventNameFilter] = useState<string>(ALL_EVENTS);
  const [selectedEvent, setSelectedEvent] = useState<GtmEvent | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);

  // "Todo período" sends no bounds at all; the 30-day purge is the real floor.
  const range = useMemo(
    () =>
      dateRange.allTime
        ? {}
        : { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() },
    [dateRange],
  );

  const {
    events,
    counters,
    loading,
    loadingMore,
    connected,
    paused,
    bufferedCount,
    hasMore,
    togglePaused,
    loadMore,
    refresh,
  } = useGtmEventStream({
    eventName: eventNameFilter === ALL_EVENTS ? undefined : eventNameFilter,
    from: range.from,
    to: range.to,
  });

  const { data: visitorsData, isLoading: visitorsLoading } = useGtmTopVisitors(range);

  // Names come from what has actually arrived — there is no fixed list, since
  // the sGTM triggers decide which events reach us.
  const eventNames = useMemo(() => {
    const names = new Set(events.map((event) => event.event_name));
    return Array.from(names).sort();
  }, [events]);

  if (!isOperatorEmail(user?.email)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-foreground">Eventos</h1>
              <ConnectionIndicator connected={connected} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground/80">
              Eventos que o GTM Server está enviando para a Meta, em tempo real
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={eventNameFilter} onValueChange={setEventNameFilter}>
              <SelectTrigger className="w-[190px] h-8 text-xs">
                <SelectValue placeholder="Todos os eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EVENTS}>Todos os eventos</SelectItem>
                {eventNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />

            <Button
              variant={paused ? 'default' : 'outline'}
              size="sm"
              onClick={togglePaused}
              className="gap-2"
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused
                ? bufferedCount > 0
                  ? `Retomar (${bufferedCount})`
                  : 'Retomar'
                : 'Pausar'}
            </Button>

            <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <CounterCard label="Eventos na janela" value={String(counters.total)} />
          <CounterCard label="Por minuto" value={String(counters.perMinute)} />
          <CounterCard label="Com _fbp" value={`${counters.fbpPercentage}%`} />
          <CounterCard label="Com _fbc" value={`${counters.fbcPercentage}%`} />
        </div>

        <Tabs defaultValue="stream">
          <TabsList>
            <TabsTrigger value="stream">Eventos</TabsTrigger>
            <TabsTrigger value="visitors">Quem mais visita</TabsTrigger>
          </TabsList>

          <TabsContent value="stream" className="mt-4">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <EventStreamList
                  events={events}
                  loading={loading}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                  onSelect={setSelectedEvent}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visitors" className="mt-4">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <TopVisitorsTable
                  visitors={visitorsData?.visitors ?? []}
                  loading={visitorsLoading}
                />
              </CardContent>
            </Card>
            <p className="mt-3 text-xs text-muted-foreground/50">
              Linhas ordenadas por acessos (
              <code className="text-muted-foreground/70">page_view</code>). As colunas de evento vêm
              dos seus próprios dados, na ordem do funil; o que não faz parte dele entra depois, por
              volume. Tudo contado dentro do período selecionado — pergunta diferente da que o número
              na lista responde, que é qual visita daquela pessoa foi aquele evento, sobre o
              histórico inteiro.
            </p>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground/50">
          Mostra o que sai do container, não a resposta da Meta. Rejeições e{' '}
          <code className="text-muted-foreground/70">fbtrace_id</code> continuam apenas no painel da
          Stape. Eventos são mantidos por 30 dias.
        </p>
      </div>

      <EventDetailDrawer
        event={selectedEvent}
        workspaceId={activeWorkspaceId ?? null}
        onClose={() => setSelectedEvent(null)}
      />
    </DashboardLayout>
  );
}

function CounterCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function ConnectionIndicator({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          connected ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30',
        )}
      />
      {connected ? 'Ao vivo' : 'Reconectando'}
    </span>
  );
}
