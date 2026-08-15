import { useQuery } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { GtmEvent } from '@/types/gtmEvents';

interface EventDetailDrawerProps {
  event: GtmEvent | null;
  workspaceId: string | null;
  onClose: () => void;
}

/** The payload never changes once stored, so it only needs fetching once. */
const STALE_TIME_MS = Infinity;

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

const isPurchase = (eventName: string) => eventName.toLowerCase() === 'purchase';

/**
 * The visit number answers a different question depending on the event, even
 * though it is the same count: on a PageView it is which access this is, on a
 * Purchase it is how many visits it took the person to buy.
 */
function visitLabel(event: GtmEvent): string {
  return isPurchase(event.event_name) ? 'Visitas até a compra' : 'Visita';
}

function visitValue(event: GtmEvent): string {
  if (event.visit_number === null) return 'pessoa não identificada';
  if (event.visit_number === 0) return 'nenhum PageView registrado antes';

  // Naming the scope matters: the same number means "on this site" or "across
  // every site" depending on whether the event knew its own URL.
  const scope =
    event.visit_scope === 'all_hosts'
      ? ' (somando todos os sites)'
      : event.page_host
        ? ` em ${event.page_host}`
        : '';

  if (isPurchase(event.event_name)) {
    return `comprou na ${event.visit_number}ª visita${scope}`;
  }
  return `${event.visit_number}ª desta pessoa${scope}`;
}

export function EventDetailDrawer({ event, workspaceId, onClose }: EventDetailDrawerProps) {
  const { data, isLoading } = useQuery<{ id: string; raw: unknown } | null>({
    queryKey: ['gtm-event-raw', event?.id],
    enabled: !!event && !!workspaceId,
    staleTime: STALE_TIME_MS,
    queryFn: () =>
      api.get(`/gtm/events/${event!.id}/raw?workspace_id=${workspaceId}`),
  });

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{event?.event_name ?? 'Evento'}</SheetTitle>
          <SheetDescription>
            {event ? formatDateTime(event.created_at) : null}
          </SheetDescription>
        </SheetHeader>

        {event && (
          <div className="mt-6 space-y-5">
            <dl className="space-y-2 rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3">
              <DetailRow label={visitLabel(event)} value={visitValue(event)} />
              <DetailRow label="id_do_usuario" value={event.external_user_id ?? '—'} />
              <DetailRow label="event_id" value={event.event_id ?? '—'} />
              <DetailRow label="Horário do evento" value={formatDateTime(event.event_time)} />
              <DetailRow
                label="Valor"
                value={
                  event.value === null
                    ? '—'
                    : `${event.value.toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                      })} ${event.currency ?? ''}`.trim()
                }
              />
              <DetailRow label="_fbp" value={event.has_fbp ? 'presente' : 'ausente'} />
              <DetailRow label="_fbc" value={event.has_fbc ? 'presente' : 'ausente'} />
              <DetailRow label="fbclid" value={event.fbclid ?? '—'} />
              <DetailRow label="URL" value={event.page_url ?? '—'} />
            </dl>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Payload recebido
              </p>
              <p className="mb-2 text-[11px] text-muted-foreground/60">
                Cookies e dados pessoais são removidos antes de gravar, então não aparecem aqui.
              </p>
              {isLoading ? (
                <Skeleton className="h-40 w-full bg-foreground/5" />
              ) : (
                <pre className="max-h-[420px] overflow-auto rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(data?.raw ?? {}, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all text-right text-xs font-medium text-foreground">{value}</dd>
    </div>
  );
}
