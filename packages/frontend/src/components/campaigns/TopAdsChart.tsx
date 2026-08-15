import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useChartColors } from '@/hooks/useChartColors';

export interface TopAdData {
  name: string;
  vendas: number;
  faturamento: number;
  gasto: number;
  roas: number;
}

interface TopAdsChartProps {
  topAds: TopAdData[];
  metaTopAds?: TopAdData[];
  loading: boolean;
  title?: string;
}

type TopAdsMode = 'lc' | 'meta';

export function TopAdsChart({ topAds, metaTopAds, loading, title = 'Top Anuncios' }: TopAdsChartProps) {
  const [mode, setMode] = useState<TopAdsMode>('lc');
  const chart = useChartColors();

  const hasMeta = metaTopAds && metaTopAds.length > 0;
  const activeAds = mode === 'meta' && hasMeta ? metaTopAds.slice(0, 5) : topAds.slice(0, 5);
  const maxSales = Math.max(...activeAds.map((a) => a.vendas), 1);

  const fmt = (v: number) =>
    `R$ ${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <div>
        <div className="mb-3">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (activeAds.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-3">{title}</h3>
        <p className="text-muted-foreground/70 text-center text-xs py-4">
          Nenhum anuncio com vendas no periodo
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">{title}</h3>
        {hasMeta && (
          <div className="flex gap-1 bg-foreground/5 rounded-md p-0.5">
            <button
              onClick={() => setMode('lc')}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                mode === 'lc' ? 'bg-primary/20 text-accent-readable' : 'text-muted-foreground/60 hover:text-muted-foreground'
              }`}
            >
              LC
            </button>
            <button
              onClick={() => setMode('meta')}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                mode === 'meta' ? 'bg-info/20 text-info' : 'text-muted-foreground/60 hover:text-muted-foreground'
              }`}
            >
              Meta
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {activeAds.map((ad, index) => {
          const barWidth = (ad.vendas / maxSales) * 100;
          const accentColor = mode === 'meta' ? chart.info : chart.accent;
          const accentBarColor = mode === 'meta' ? chart.info : chart.primary;

          return (
            <TooltipProvider key={`${ad.name}-${index}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 group cursor-default">
                    <span className="text-[10px] text-muted-foreground/40 w-4 text-right shrink-0">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">
                          {ad.name}
                        </span>
                        <span
                          className="text-xs font-semibold tabular-nums shrink-0"
                          style={{ color: accentColor }}
                        >
                          {ad.vendas}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-foreground/5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: index === 0
                              ? accentBarColor
                              : chart.withAlpha(mode === 'meta' ? '--info' : '--primary', 0.25),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  <p className="font-medium mb-1">{ad.name}</p>
                  <p>Vendas: <span className="font-semibold">{ad.vendas}</span></p>
                  <p>Gasto: <span className="text-destructive">{fmt(ad.gasto)}</span></p>
                  <p>Faturamento: <span style={{ color: accentColor }}>{fmt(ad.faturamento)}</span></p>
                  <p>
                    ROAS:{' '}
                    <span className={(ad.roas ?? 0) >= 1 ? 'text-accent-readable' : 'text-destructive'}>
                      {(ad.roas ?? 0).toFixed(2)}x
                    </span>
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    </div>
  );
}
