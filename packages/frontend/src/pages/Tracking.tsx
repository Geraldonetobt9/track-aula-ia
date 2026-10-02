import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { DateRangeFilter, DateRange, getDefaultDateRange } from '@/components/DateRangeFilter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Code2, Eye, EyeOff } from 'lucide-react';
import { usePrivacyMode } from '@/hooks/usePrivacyMode';
import {
  useTrackingByPage,
  useTrackingStats,
  useTrackingStatus,
} from '@/hooks/useTracking';
import { TrackingSummaryCards } from '@/components/tracking/TrackingSummaryCards';
import { TrackingFunnel } from '@/components/tracking/TrackingFunnel';
import { TrackingDailyCharts } from '@/components/tracking/TrackingDailyCharts';
import { TrackingBreakdownTable } from '@/components/tracking/TrackingBreakdownTable';
import { CapiEventsCard } from '@/components/tracking/CapiEventsCard';

export default function Tracking() {
  const [dateRange, setDateRange] = useState<DateRange>(() => getDefaultDateRange());
  const { isHidden, toggle } = usePrivacyMode();

  const { data, loading, error } = useTrackingStats(dateRange);
  const { status } = useTrackingStatus();
  const pages = useTrackingByPage(dateRange);

  // Nunca chegou evento: a página inteira seria zeros. Melhor dizer o que falta.
  const neverTracked = !loading && status !== null && status.lastEventAt === null;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Eventos</h1>
            <p className="text-sm text-muted-foreground/80 mt-1">
              Quem chegou na página de vendas, quem clicou em comprar e quem comprou
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
            <Button
              variant="outline"
              size="sm"
              onClick={toggle}
              aria-label={isHidden ? 'Mostrar dados' : 'Ocultar dados'}
              aria-pressed={isHidden}
              className="px-3"
            >
              {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {neverTracked ? (
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Code2 className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma visita registrada ainda</h2>
              <p className="text-sm text-muted-foreground/70 max-w-sm mb-5">
                Cole o código de rastreio na sua página de vendas. As visitas aparecem aqui em segundos.
              </p>
              <Button asChild size="sm">
                <Link to="/integrations#rastreio">Pegar o código</Link>
              </Button>
            </CardContent>
          </Card>
        ) : error && !data ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Não foi possível carregar as visitas: {error}
            </CardContent>
          </Card>
        ) : (
          <>
            <TrackingSummaryCards stats={data?.stats ?? null} loading={loading} blurValues={isHidden} />

            {data && data.stats.sales > 0 && (
              <p className="text-xs text-muted-foreground/70 -mt-3">
                {data.stats.matchedSales.toLocaleString('pt-BR')} de {data.stats.sales.toLocaleString('pt-BR')} vendas
                do período foram ligadas à visita que as trouxe.
              </p>
            )}

            <div className="grid gap-3 grid-cols-1 lg:grid-cols-[1fr_2fr]">
              <TrackingFunnel funnel={data?.funnel ?? null} loading={loading} />
              <TrackingDailyCharts daily={data?.daily ?? []} loading={loading} blurValues={isHidden} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Páginas de entrada</CardTitle>
                <CardDescription>
                  Onde a visita começou. Vendas aqui são só as ligadas a uma visita — é o que diz de que página
                  cada uma veio.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TrackingBreakdownTable
                  rows={pages.rows}
                  loading={pages.loading}
                  keyLabel="Página"
                  isUrl
                  blurValues={isHidden}
                />
              </CardContent>
            </Card>
          </>
        )}

        <CapiEventsCard />
      </div>
    </DashboardLayout>
  );
}
