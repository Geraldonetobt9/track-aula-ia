import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, Eye, Play, TrendingUp, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { privacyBlurClass } from '@/lib/privacyBlur';
import { VturbCountryRow, VturbOverview } from '@/types/vturb';

interface VturbSummaryProps {
  overview?: VturbOverview;
  loading: boolean;
  blurValues?: boolean;
}

const formatInteger = (value: number) => value.toLocaleString('pt-BR');

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatPercentage = (value: number) => `${value.toFixed(2).replace('.', ',')}%`;

/**
 * Account totals for the period, then the country split.
 *
 * Revenue leads on its own row because it is the number the operator opens the
 * screen for; the rest reads as the funnel behind it.
 */
export function VturbSummary({ overview, loading, blurValues }: VturbSummaryProps) {
  const blur = privacyBlurClass(blurValues);

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at top right, rgba(209,254,23,0.10) 0%, transparent 55%)',
          }}
        />
        <CardContent className="relative p-5 sm:p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Receita</span>
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-11 w-56 bg-foreground/5" />
          ) : (
            <p
              className={cn(
                'mt-1 text-3xl font-semibold tabular-nums text-foreground sm:text-4xl',
                blur,
              )}
            >
              {formatCurrency(overview?.revenue ?? 0)}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Visualizações"
          icon={<Eye className="h-4 w-4" />}
          value={formatInteger(overview?.views ?? 0)}
          loading={loading}
          blur={blur}
        />
        <MetricTile
          label="Plays"
          icon={<Play className="h-4 w-4" />}
          value={formatInteger(overview?.plays ?? 0)}
          loading={loading}
          blur={blur}
        />
        <MetricTile
          label="Conversões"
          icon={<TrendingUp className="h-4 w-4" />}
          value={formatInteger(overview?.conversions ?? 0)}
          loading={loading}
          blur={blur}
        />
        <MetricTile
          label="Taxa de conversão"
          icon={<BarChart3 className="h-4 w-4" />}
          value={formatPercentage(overview?.conversionRate ?? 0)}
          loading={loading}
          blur={blur}
        />
      </div>

      <CountriesCard
        countries={overview?.countries ?? []}
        fromVideos={overview?.countriesFromVideos ?? 0}
        loading={loading}
      />
    </div>
  );
}

function MetricTile({
  label,
  icon,
  value,
  loading,
  blur,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  loading: boolean;
  blur: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <span className="shrink-0 text-muted-foreground/60">{icon}</span>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-20 bg-foreground/5" />
        ) : (
          <p className={cn('mt-1 text-2xl font-semibold tabular-nums text-foreground', blur)}>
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CountriesCard({
  countries,
  fromVideos,
  loading,
}: {
  countries: VturbCountryRow[];
  fromVideos: number;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Top países
        </p>

        {loading ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full bg-foreground/5" />
            ))}
          </div>
        ) : countries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            A VTurb não devolveu divisão por país neste período.
          </p>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {countries.map((row) => (
                <li key={row.country}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-foreground">{row.country}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {row.percentage.toFixed(1).replace('.', ',')}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/5">
                    <div
                      className="h-full rounded-full bg-primary/70 transition-[width] duration-500"
                      style={{ width: `${Math.max(row.percentage, 1)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {fromVideos > 0 && (
              <p className="mt-4 text-[11px] text-muted-foreground/50">
                Somado a partir dos {fromVideos} vídeos mais assistidos.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
