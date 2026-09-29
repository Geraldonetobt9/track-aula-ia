import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useRefetch } from '@/contexts/RefetchContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import type { DateRange } from '@/components/DateRangeFilter';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Tipos — espelham o que TrackingService devolve
// ---------------------------------------------------------------------------

export interface TrackingStats {
  totalVisitors: number;
  totalSessions: number;
  totalPageviews: number;
  uniqueVisitorsToday: number;
  /** Segundos. */
  averageSessionDuration: number;
  averagePageviewsPerSession: number;
  /** Percentuais de 0 a 100. */
  bounceRate: number;
  checkoutClickRate: number;
  conversionRate: number;
  /** Pedidos aprovados no período, contados como no Dashboard. */
  sales: number;
  /** Desses pedidos, quantos têm a visita conhecida. */
  matchedSales: number;
  /** Variação contra o período anterior, em %. null quando não há base. */
  visitorsChange: number | null;
  conversionRateChange: number | null;
}

export interface FunnelData {
  visitors: number;
  checkoutClicks: number;
  sales: number;
  checkoutRate: number;
  purchaseRate: number;
}

export interface TrackingDailyPoint {
  date: string;
  visitors: number;
  checkoutClicks: number;
  sales: number;
}

export interface TrackingStatsResponse {
  stats: TrackingStats;
  funnel: FunnelData;
  daily: TrackingDailyPoint[];
}

export interface TrackingBreakdownRow {
  key: string;
  visitors: number;
  sessions: number;
  averageDuration: number;
  bounceRate: number;
  checkoutClicks: number;
  checkoutRate: number;
  sales: number;
  conversionRate: number;
}

export type TrackingBreakdownBy = 'page' | 'source' | 'campaign';

export interface TrackingStatus {
  eventsToday: number;
  lastEventAt: string | null;
}

export type SaleJourney =
  | { matched: false }
  | {
      matched: true;
      matchMethod: string;
      soldAt: string;
      session: {
        started_at: string;
        duration_seconds: number | null;
        landing_page: string;
        referrer: string | null;
        utm_source: string | null;
        utm_campaign: string | null;
        device_type: string | null;
        city: string | null;
        region: string | null;
        pageviews: number;
        checkout_clicked_at: string | null;
      } | null;
      visitor: { first_seen_at: string; total_sessions: number } | null;
      events: {
        event_type: string;
        event_name: string | null;
        url: string | null;
        metadata: Record<string, unknown> | null;
        occurred_at: string;
      }[];
    };

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function rangeParams(workspaceId: string, dateRange: DateRange): URLSearchParams {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (dateRange.allTime) {
    params.set('period', 'all');
  } else {
    params.set('from', format(dateRange.from, 'yyyy-MM-dd'));
    params.set('to', format(dateRange.to, 'yyyy-MM-dd'));
  }
  return params;
}

function rangeKey(dateRange: DateRange) {
  return dateRange.allTime
    ? 'all'
    : `${format(dateRange.from, 'yyyy-MM-dd')}_${format(dateRange.to, 'yyyy-MM-dd')}`;
}

/** Cards, funil e série diária — uma requisição só. */
export function useTrackingStats(dateRange: DateRange) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const { refetchSignal } = useRefetch();

  const query = useQuery<TrackingStatsResponse, Error>({
    queryKey: ['tracking-stats', activeWorkspaceId, rangeKey(dateRange), refetchSignal],
    enabled: !!activeWorkspaceId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // Sem a migration aplicada a rota falha; não vale insistir.
    retry: false,
    queryFn: () =>
      api.get<TrackingStatsResponse>(`/tracking/stats?${rangeParams(activeWorkspaceId!, dateRange)}`),
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

/** Só as etapas do funil. Mesma consulta de useTrackingStats, sem requisição extra. */
export function useTrackingFunnel(dateRange: DateRange) {
  const { data, loading, error } = useTrackingStats(dateRange);
  return { funnel: data?.funnel ?? null, loading, error };
}

export function useTrackingBreakdown(by: TrackingBreakdownBy, dateRange: DateRange) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const { refetchSignal } = useRefetch();

  const query = useQuery<TrackingBreakdownRow[], Error>({
    queryKey: ['tracking-breakdown', by, activeWorkspaceId, rangeKey(dateRange), refetchSignal],
    enabled: !!activeWorkspaceId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => {
      const params = rangeParams(activeWorkspaceId!, dateRange);
      params.set('by', by);
      return api.get<TrackingBreakdownRow[]>(`/tracking/breakdown?${params}`);
    },
  });

  return {
    rows: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export const useTrackingByPage = (dateRange: DateRange) => useTrackingBreakdown('page', dateRange);
export const useTrackingBySource = (dateRange: DateRange) => useTrackingBreakdown('source', dateRange);

/** O snippet está mandando eventos? Atualiza sozinho enquanto a tela está aberta. */
export function useTrackingStatus() {
  const { activeWorkspaceId } = useWorkspaceContext();

  const query = useQuery<TrackingStatus, Error>({
    queryKey: ['tracking-status', activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    refetchInterval: 30_000,
    retry: false,
    queryFn: () => api.get<TrackingStatus>(`/tracking/status?workspace_id=${activeWorkspaceId}`),
  });

  return { status: query.data ?? null, loading: query.isLoading, error: query.error?.message ?? null };
}

export function useSaleJourney(saleId: string | null) {
  const query = useQuery<SaleJourney, Error>({
    queryKey: ['sale-journey', saleId],
    enabled: !!saleId,
    staleTime: 60_000,
    retry: false,
    queryFn: () => api.get<SaleJourney>(`/tracking/journey/${saleId}`),
  });

  return { journey: query.data ?? null, loading: query.isLoading };
}

// ---------------------------------------------------------------------------
// Formatação compartilhada
// ---------------------------------------------------------------------------

/** 192 → "3min12s"; 45 → "45s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}min`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
