import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDownRight, ArrowUpRight, MousePointerClick, Percent, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPercent, type TrackingStats } from '@/hooks/useTracking';

interface TileProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: React.ReactNode;
  loading?: boolean;
  blurValue?: boolean;
}

function Tile({ title, value, icon, subtitle, loading, blurValue }: TileProps) {
  const blur = blurValue ? 'blur-md select-none' : '';
  return (
    <Card>
      <CardContent className="p-4 pb-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
            <div className="text-muted-foreground/60">{icon}</div>
          </div>
          {loading ? (
            <Skeleton className="h-9 w-24 bg-foreground/5" />
          ) : (
            <p className={cn('metric-number text-foreground transition-[filter] duration-200 ease-out', blur)}>{value}</p>
          )}
          {!loading && subtitle && (
            <p className={cn('text-xs text-muted-foreground/85 leading-snug pt-0.5 transition-[filter] duration-200 ease-out', blur)}>
              {subtitle}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Seta + valor da variação. Cor só reforça: o sinal e a seta dizem a direção. */
function Change({ value, label }: { value: number | null; label: string }) {
  if (value == null) return <span>{label}</span>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-flex items-center font-medium', up ? 'text-green-500' : 'text-red-500')}>
        <Icon className="h-3 w-3" aria-hidden />
        {up ? '+' : ''}
        {formatPercent(value)}
      </span>
      <span>{label}</span>
    </span>
  );
}

/** Os três números do funil, na página de Eventos. */
export function TrackingSummaryCards({
  stats,
  loading,
  blurValues,
}: {
  stats: TrackingStats | null;
  loading: boolean;
  blurValues?: boolean;
}) {
  const s = stats;
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
      <Tile
        title="Visitantes Únicos"
        value={(s?.totalVisitors ?? 0).toLocaleString('pt-BR')}
        icon={<Users className="h-4 w-4" />}
        loading={loading}
        blurValue={blurValues}
        subtitle={s && <Change value={s.visitorsChange} label="vs. período anterior" />}
      />
      <Tile
        title="Taxa de Conversão"
        value={formatPercent(s?.conversionRate ?? 0)}
        icon={<Percent className="h-4 w-4" />}
        loading={loading}
        blurValue={blurValues}
        subtitle={
          s && (
            <Change
              value={s.conversionRateChange}
              label={`${s.sales.toLocaleString('pt-BR')} vendas / visitantes`}
            />
          )
        }
      />
      <Tile
        title="Cliques no Checkout"
        value={formatPercent(s?.checkoutClickRate ?? 0)}
        icon={<MousePointerClick className="h-4 w-4" />}
        loading={loading}
        blurValue={blurValues}
        subtitle="das visitas clicaram em comprar"
      />
    </div>
  );
}
