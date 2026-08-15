import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { privacyBlurClass } from '@/lib/privacyBlur';
import { VturbVideoRow } from '@/types/vturb';

interface VturbVideoRankingProps {
  videos: VturbVideoRow[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (video: VturbVideoRow) => void;
  blurValues?: boolean;
}

const formatInteger = (value: number) => value.toLocaleString('pt-BR');

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDuration = (seconds: number) => {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

/**
 * Videos ranked by views, most watched first.
 *
 * Two layouts on purpose: a table from `sm` up, and stacked cards below it. A
 * horizontally scrolling table on a phone hides the columns that matter behind
 * a gesture nobody thinks to make.
 */
export function VturbVideoRanking({
  videos,
  loading,
  selectedId,
  onSelect,
  blurValues,
}: VturbVideoRankingProps) {
  const blur = privacyBlurClass(blurValues);

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full bg-foreground/5" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (videos.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-14 text-center">
          <p className="text-sm text-muted-foreground">Nenhum vídeo com dados neste período</p>
          <p className="max-w-sm text-xs text-muted-foreground/60">
            Ou a conta não tem players, ou nenhum recebeu visualização na janela escolhida.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Desktop: full table */}
        <div className="hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/5 text-left">
                <Th className="w-[52px]">#</Th>
                <Th>Vídeo</Th>
                <Th className="text-right">Visualizações</Th>
                <Th className="text-right">Plays</Th>
                <Th className="text-right">Conversões</Th>
                <Th className="text-right">Receita</Th>
                <Th className="w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {videos.map((video, index) => (
                <tr
                  key={video.playerId}
                  onClick={() => onSelect(video)}
                  className={cn(
                    'cursor-pointer border-b border-foreground/5 transition-colors hover:bg-foreground/[0.03]',
                    selectedId === video.playerId && 'bg-foreground/[0.05]',
                  )}
                >
                  <Td className="tabular-nums text-muted-foreground/60">{index + 1}</Td>
                  <Td>
                    <p className="max-w-[280px] truncate font-medium text-foreground">
                      {video.name || 'Sem nome'}
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      {formatDuration(video.durationSeconds)}
                    </p>
                  </Td>
                  <Td className={cn('text-right tabular-nums text-foreground', blur)}>
                    {formatInteger(video.views)}
                  </Td>
                  <Td className={cn('text-right tabular-nums text-muted-foreground', blur)}>
                    {formatInteger(video.plays)}
                  </Td>
                  <Td className={cn('text-right tabular-nums text-muted-foreground', blur)}>
                    {formatInteger(video.conversions)}
                  </Td>
                  <Td className={cn('text-right tabular-nums', blur)}>
                    {video.revenue > 0 ? (
                      <span className="text-accent-readable">{formatCurrency(video.revenue)}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: one card per video, no horizontal scrolling */}
        <ul className="divide-y divide-foreground/5 sm:hidden">
          {videos.map((video, index) => (
            <li key={video.playerId}>
              <button
                type="button"
                onClick={() => onSelect(video)}
                className={cn(
                  'w-full px-4 py-3 text-left transition-colors active:bg-foreground/[0.05]',
                  selectedId === video.playerId && 'bg-foreground/[0.05]',
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-muted-foreground/60">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {video.name || 'Sem nome'}
                    </p>
                    <div
                      className={cn(
                        'mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground',
                        blur,
                      )}
                    >
                      <span>{formatInteger(video.views)} views</span>
                      <span>{formatInteger(video.plays)} plays</span>
                      <span>{formatInteger(video.conversions)} conv.</span>
                      {video.revenue > 0 && (
                        <span className="text-accent-readable">
                          {formatCurrency(video.revenue)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
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
  return <td className={cn('px-3 py-3', className)}>{children}</td>;
}
