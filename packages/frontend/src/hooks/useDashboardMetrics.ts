import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { DateRange } from '@/components/DateRangeFilter';

export interface DashboardMetrics {
  grossRevenue: number;
  netRevenue: number;
  adSpend: number;
  adSpendTax: number;
  adSpendTaxPercentage: number;
  roas: number;
  cpa: number;
  salesCount: number;
}

export interface ChartPoint {
  date: string;
  revenue: number;
  spend: number;
}

export interface RegionPoint {
  state: string;
  sales: number;
  revenue: number;
  percentage: number;
}

export interface RecentSale {
  id: string;
  product_name: string | null;
  sold_at: string;
  amount: number;
}

export interface DashboardResponse {
  metrics: DashboardMetrics;
  chartData: ChartPoint[];
  regions: RegionPoint[];
  lifetimeRevenue: number;
  recentSales: RecentSale[];
}

const EMPTY_RESPONSE: DashboardResponse = {
  metrics: {
    grossRevenue: 0,
    netRevenue: 0,
    adSpend: 0,
    adSpendTax: 0,
    adSpendTaxPercentage: 0,
    roas: 0,
    cpa: 0,
    salesCount: 0,
  },
  chartData: [],
  regions: [],
  lifetimeRevenue: 0,
  recentSales: [],
};

export function useDashboardMetrics(
  dateRange: DateRange,
  connectionIds?: string[],
  productNames?: string[],
) {
  const [data, setData] = useState<DashboardResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchData = useCallback(async () => {
    if (!effectiveId || !activeWorkspaceId) {
      setData(EMPTY_RESPONSE);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // "Todo período" sends no dates at all. The backend resolves the start
      // from the first sale, bounded by Facebook's insights retention, and uses
      // that one window for both revenue and ad spend — sending a date from
      // here is how the two end up on different windows and ROAS goes wrong.
      if (dateRange.allTime) {
        params.set('period', 'all');
      } else {
        params.set('from', format(dateRange.from, 'yyyy-MM-dd'));
        params.set('to', format(dateRange.to, 'yyyy-MM-dd'));
      }
      params.set('workspace_id', activeWorkspaceId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);
      if (connectionIds && connectionIds.length > 0) params.set('connection_ids', connectionIds.join(','));
      if (productNames && productNames.length > 0) params.set('product_names', productNames.join(','));

      const result = await api.get<DashboardResponse>(`/metrics/dashboard?${params}`);
      setData(result ?? EMPTY_RESPONSE);
    } catch (err) {
      console.error('[useDashboardMetrics] Error:', err);
      setData(EMPTY_RESPONSE);
    } finally {
      setLoading(false);
    }
  }, [effectiveId, activeWorkspaceId, dateRange.allTime, format(dateRange.from, 'yyyy-MM-dd'), format(dateRange.to, 'yyyy-MM-dd'), connectionIds?.join(','), productNames?.join(','), isImpersonating, target]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refetchSignal]);

  return { ...data, loading, refetch: fetchData };
}
