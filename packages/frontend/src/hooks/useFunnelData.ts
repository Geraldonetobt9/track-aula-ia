import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { DateRange } from '@/components/DateRangeFilter';
import { format } from 'date-fns';

export interface FunnelData {
  linkClicks: number;
  landingPageViews: number;
  initiateCheckouts: number;
  sales: number;
  loading: boolean;
}

export function useFunnelData(dateRange: DateRange): FunnelData {
  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();
  const [data, setData] = useState<Omit<FunnelData, 'loading'>>({
    linkClicks: 0,
    landingPageViews: 0,
    initiateCheckouts: 0,
    sales: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchFunnelData = useCallback(async () => {
    if (!effectiveId || !activeWorkspaceId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('from', format(dateRange.from, 'yyyy-MM-dd'));
      params.set('to', format(dateRange.to, 'yyyy-MM-dd'));
      params.set('workspace_id', activeWorkspaceId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const result = await api.get<any>(`/metrics/daily-spend?${params}`);

      setData({
        linkClicks: result?.linkClicks || 0,
        landingPageViews: result?.landingPageViews || 0,
        initiateCheckouts: result?.initiateCheckouts || 0,
        sales: result?.sales || 0,
      });
    } catch (error) {
      console.error('Error fetching funnel data:', error);
    } finally {
      setLoading(false);
    }
  }, [effectiveId, activeWorkspaceId, dateRange, refetchSignal]);

  useEffect(() => {
    fetchFunnelData();
  }, [fetchFunnelData]);

  return {
    ...data,
    loading,
  };
}
