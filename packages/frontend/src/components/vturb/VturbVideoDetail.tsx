import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { privacyBlurClass } from '@/lib/privacyBlur';
import { useVturbVideo } from '@/hooks/useVturb';
import { DateRange } from '@/components/DateRangeFilter';
import { VturbVideoRow } from '@/types/vturb';

interface VturbVideoDetailProps {
  video: VturbVideoRow | null;
  range: DateRange;
  onClose: () => void;
  blurValues?: boolean;
}

const formatInteger = (value: number) => value.toLocaleString('pt-BR');

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatPercentage = (value: number) => `${value.toFixed(2).replace('.', ',')}%`;

const formatDuration = (seconds: number) => {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

/**
 * The per-video metrics strip, mirroring what VTurb's own dashboard shows.
 *
 * Fetched on open rather than with the ranking: the ranking already costs one
 * upstream request per video, and pulling every video's full detail up front
 * would spend quota on panels nobody opens.
 */
export function VturbVideoDetail({ video, range, onClose, blurValues }: VturbVideoDetailProps) {
  const { data, isLoading, error } = useVturbVideo(video?.playerId ?? null, range);
  const blur = privacyBlurClass(blurValues);

  return (
    <Sheet open={!!video} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6 text-left">{video?.name || 'Vídeo'}</SheetTitle>
          <SheetDescription className="text-left">
            {data
              ? `${formatDuration(data.durationSeconds)} de vídeo · pitch aos ${formatDuration(
                  data.pitchTimeSeconds,
                )}`
              : 'Carregando métricas…'}
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <p className="mt-6 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 text-sm text-muted-foreground">
            {(error as Error).message}
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Metric label="Visualizações" value={data && formatInteger(data.views)} loading={isLoading} blur={blur} />
            <Metric
              label="Visualizações Únicas"
              value={data && formatInteger(data.uniqueViews)}
              loading={isLoading}
              blur={blur}
            />
            <Metric label="Plays" value={data && formatInteger(data.plays)} loading={isLoading} blur={blur} />
            <Metric
              label="Plays Únicos"
              value={data && formatInteger(data.uniquePlays)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Play Rate"
              value={data && formatPercentage(data.playRate)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Retenção ao Pitch"
              value={data && formatPercentage(data.pitchRetentionRate)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Audiência do Pitch"
              value={data && formatInteger(data.pitchAudience)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Engajamento"
              value={data && formatPercentage(data.engagementRate)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Cliques no Botão"
              value={data && formatInteger(data.buttonClicks)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Conversões"
              value={data && formatInteger(data.conversions)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Taxa de Conversão"
              value={data && formatPercentage(data.conversionRate)}
              loading={isLoading}
              blur={blur}
            />
            <Metric
              label="Receita"
              value={data && formatCurrency(data.revenue)}
              loading={isLoading}
              blur={blur}
              highlight
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Metric({
  label,
  value,
  loading,
  blur,
  highlight,
}: {
  label: string;
  value: string | undefined | null | false;
  loading: boolean;
  blur: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3">
      {loading ? (
        <Skeleton className="h-7 w-20 bg-foreground/5" />
      ) : (
        <p
          className={cn(
            'text-xl font-semibold tabular-nums',
            highlight ? 'text-accent-readable' : 'text-foreground',
            blur,
          )}
        >
          {value || '—'}
        </p>
      )}
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
