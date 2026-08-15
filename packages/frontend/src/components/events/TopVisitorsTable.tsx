import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { GtmTopVisitor } from '@/types/gtmEvents';

interface TopVisitorsTableProps {
  visitors: GtmTopVisitor[];
  loading: boolean;
}

/**
 * Ceiling on the per-event columns.
 *
 * The set of event names comes from the tags, so it is unbounded in principle.
 * Beyond this the table stops being readable, and the tail is summed into
 * "outros" rather than dropped — a column that silently hides events would be
 * worse than one that lumps them.
 */
const MAX_EVENT_COLUMNS = 8;

/**
 * Funnel order for the columns that have one.
 *
 * Ordering by volume put the top of the funnel on the left by coincidence, not
 * by meaning — and the coincidence breaks the moment a period has more carts
 * than accesses. Names are matched normalised (lowercased, underscores
 * removed), since tag templates spell them `page_view`, `pageview` or
 * `PageView` interchangeably.
 *
 * Anything not listed here keeps falling in behind, ordered by volume.
 */
const FUNNEL_ORDER = ['page_view', 'add_to_cart', 'begin_checkout', 'purchase'];

const normalizeEventName = (name: string) => name.toLowerCase().replace(/_/g, '');

const FUNNEL_RANK = new Map(
  FUNNEL_ORDER.map((name, index) => [normalizeEventName(name), index]),
);

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Who came back the most in the selected period, and how far each got.
 *
 * Ranked by accesses (`page_view`). The per-event columns turn each row into a
 * funnel: how many accesses, how many carts, how many purchases.
 */
export function TopVisitorsTable({ visitors, loading }: TopVisitorsTableProps) {
  // Which columns exist still comes from the data — the tags decide what gets
  // sent. Only the order is fixed: funnel steps first, in funnel order, then
  // everything else by volume.
  const { columns, hasOthers } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const visitor of visitors) {
      for (const [name, count] of Object.entries(visitor.events_by_name ?? {})) {
        totals.set(name, (totals.get(name) ?? 0) + count);
      }
    }

    const ranked = Array.from(totals.entries()).sort((a, b) => {
      const rankA = FUNNEL_RANK.get(normalizeEventName(a[0]));
      const rankB = FUNNEL_RANK.get(normalizeEventName(b[0]));

      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      // A funnel step always outranks one that isn't in the funnel.
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return b[1] - a[1];
    });

    const names = ranked.map(([name]) => name);

    return {
      columns: names.slice(0, MAX_EVENT_COLUMNS),
      hasOthers: names.length > MAX_EVENT_COLUMNS,
    };
  }, [visitors]);

  const othersFor = (visitor: GtmTopVisitor): number => {
    const shown = new Set(columns);
    return Object.entries(visitor.events_by_name ?? {})
      .filter(([name]) => !shown.has(name))
      .reduce((sum, [, count]) => sum + count, 0);
  };

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full bg-foreground/5" />
        ))}
      </div>
    );
  }

  if (visitors.length === 0) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-muted-foreground">Ninguém identificado neste período</p>
        <p className="max-w-sm text-xs text-muted-foreground/60">
          Só entram aqui pessoas com <code>id_do_usuario</code> ou <code>_fbp</code>. Sem uma
          das duas não dá para saber que dois acessos são da mesma pessoa.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-foreground/5 text-left">
            <Th className="w-[52px]">#</Th>
            <Th>Pessoa</Th>
            {columns.map((name) => (
              <Th key={name} className="text-right font-mono normal-case tracking-normal">
                {name}
              </Th>
            ))}
            {hasOthers && <Th className="text-right">outros</Th>}
            <Th className="text-right">Receita</Th>
            <Th className="text-right">Sites</Th>
            <Th className="text-right">Último acesso</Th>
          </tr>
        </thead>
        <tbody>
          {visitors.map((visitor, index) => (
            <tr
              key={visitor.visitor_key}
              className="border-b border-foreground/5 transition-colors hover:bg-foreground/[0.03]"
            >
              <Td className="tabular-nums text-muted-foreground/60">{index + 1}</Td>
              <Td>
                {visitor.external_user_id ? (
                  <span className="font-mono text-xs text-foreground">
                    {visitor.external_user_id}
                  </span>
                ) : (
                  <span
                    className="text-xs text-muted-foreground/60"
                    title="Sem id_do_usuario — identificada apenas pelo cookie do navegador"
                  >
                    anônimo
                  </span>
                )}
              </Td>

              {columns.map((name) => (
                <Td key={name} className="text-right">
                  <Count value={visitor.events_by_name?.[name] ?? 0} />
                </Td>
              ))}
              {hasOthers && (
                <Td className="text-right">
                  <Count value={othersFor(visitor)} />
                </Td>
              )}

              <Td className="text-right tabular-nums">
                {visitor.revenue > 0 ? (
                  <span className="text-accent-readable">{formatCurrency(visitor.revenue)}</span>
                ) : (
                  <span className="text-muted-foreground/40">—</span>
                )}
              </Td>
              <Td className="text-right tabular-nums text-muted-foreground">{visitor.hosts}</Td>
              <Td className="text-right text-xs tabular-nums text-muted-foreground/70">
                {formatDateTime(visitor.last_seen)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Zero is dimmed rather than shown as a number — the eye should land on what happened. */
function Count({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground/25 tabular-nums">—</span>;
  return <span className="tabular-nums text-foreground">{value}</span>;
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5', className)}>{children}</td>;
}
