import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Layers, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateRangeFilter, DateRange, getDefaultDateRange } from '@/components/DateRangeFilter';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { usePrivacyMode } from '@/hooks/usePrivacyMode';
import { useVturbOverview, useVturbStatus } from '@/hooks/useVturb';
import { VturbSummary } from '@/components/vturb/VturbSummary';
import { VturbVideoRanking } from '@/components/vturb/VturbVideoRanking';
import { VturbVideoDetail } from '@/components/vturb/VturbVideoDetail';
import { VturbTokenForm } from '@/components/vturb/VturbTokenForm';
import { VturbLogo } from '@/components/vturb/VturbLogo';
import { startOfDay, endOfDay, subDays } from 'date-fns';
import { VturbVideoRow } from '@/types/vturb';

/** VTurb's own dashboard opens on the last 30 days; matching it avoids surprises. */
function getInitialRange(): DateRange {
  const today = new Date();
  return { from: startOfDay(subDays(today, 29)), to: endOfDay(today) };
}

export default function Vturb() {
  const { activeWorkspaceId, workspaces } = useWorkspaceContext();
  const { isHidden: isPrivacyHidden, toggle: togglePrivacy } = usePrivacyMode();

  const [dateRange, setDateRange] = useState<DateRange>(getInitialRange);
  const [selectedVideo, setSelectedVideo] = useState<VturbVideoRow | null>(null);

  const hasWorkspace = workspaces.length > 0 && !!activeWorkspaceId;

  const { data: status, isLoading: statusLoading } = useVturbStatus();
  const configured = !!status?.configured;

  const {
    data: overview,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useVturbOverview(dateRange, configured);

  return (
    <DashboardLayout>
      <div className="animate-sentinel-in space-y-6">
        <div className="flex items-center gap-3">
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <VturbLogo />
              <h1 className="text-xl font-semibold text-foreground">VTurb</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground/80">
              Desempenho dos seus VSLs — retenção, pitch e conversão
            </p>
          </div>

          {configured && (
            <div className="flex flex-wrap items-center gap-2">
              <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
              <Button
                variant="outline"
                size="sm"
                onClick={togglePrivacy}
                aria-label={isPrivacyHidden ? 'Mostrar dados' : 'Ocultar dados'}
                aria-pressed={isPrivacyHidden}
                className="px-3"
              >
                {isPrivacyHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="gap-2"
              >
                <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
                <span className="hidden sm:inline">Atualizar</span>
              </Button>
            </div>
          )}
        </div>

        {!hasWorkspace ? (
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Layers className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="mb-1 text-lg font-semibold text-foreground">Nenhuma área criada</h2>
              <p className="max-w-sm text-sm text-muted-foreground/70">
                Crie uma área no Dashboard para conectar sua conta VTurb.
              </p>
            </CardContent>
          </Card>
        ) : statusLoading ? null : !configured ? (
          <VturbTokenForm />
        ) : (
          <>
            {error ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-foreground">{(error as Error).message}</p>
                  <p className="max-w-md text-xs text-muted-foreground/60">
                    Se o erro for de cota, a VTurb limita por minuto e por volume de dados lido —
                    esperar alguns minutos costuma resolver.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    Tentar de novo
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {!!overview?.failedVideos && (
                  <Card className="border-foreground/10">
                    <CardContent className="p-4">
                      <p className="text-sm text-foreground">
                        {overview.failedVideos} vídeo(s) não retornaram dados
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground/70">
                        Ficaram de fora dos totais abaixo, então os números estão incompletos.
                        O motivo exato está no log do backend.
                      </p>
                    </CardContent>
                  </Card>
                )}

                <VturbSummary
                  overview={overview}
                  loading={isLoading}
                  blurValues={isPrivacyHidden}
                />

                <div>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-medium text-foreground">
                      Vídeos, do mais assistido ao menos
                    </h2>
                    {!!overview?.totalVideosInAccount && (
                      <p className="text-xs text-muted-foreground/50">
                        Top {overview.videos.length} de {overview.totalVideosInAccount} vídeos da conta
                      </p>
                    )}
                  </div>
                  <VturbVideoRanking
                    videos={overview?.videos ?? []}
                    loading={isLoading}
                    selectedId={selectedVideo?.playerId ?? null}
                    onSelect={setSelectedVideo}
                    blurValues={isPrivacyHidden}
                  />
                </div>
              </>
            )}

            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-foreground">Chave da API conectada</p>
                  <p className="text-xs text-muted-foreground/60">
                    Guardada criptografada. Cole uma nova para substituir.
                  </p>
                </div>
                <div className="sm:w-[360px]">
                  <VturbTokenForm compact />
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <VturbVideoDetail
        video={selectedVideo}
        range={dateRange}
        onClose={() => setSelectedVideo(null)}
        blurValues={isPrivacyHidden}
      />
    </DashboardLayout>
  );
}
