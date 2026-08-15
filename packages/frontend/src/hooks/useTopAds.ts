import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';

export interface TopAd {
  name: string;
  vendas: number;
  faturamento: number;
  gasto: number;
  roas: number;
}

interface DateRange {
  start: Date;
  end: Date;
}

export function useTopAds(dateRange?: DateRange) {
  const [topAds, setTopAds] = useState<TopAd[]>([]);
  const [metaTopAds, setMetaTopAds] = useState<TopAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchTopAds = async () => {
    if (!effectiveId || !activeWorkspaceId) {
      setTopAds([]);
      setMetaTopAds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (dateRange) {
        params.set('from', format(dateRange.start, 'yyyy-MM-dd'));
        params.set('to', format(dateRange.end, 'yyyy-MM-dd'));
      }
      params.set('workspace_id', activeWorkspaceId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const data = await api.get<any[]>(`/metrics/ads?${params}`);
      const rows = data || [];

      const sortedLastClick = rows
        .filter((ad: any) => ad.sales > 0)
        .sort((a: any, b: any) => b.sales - a.sales)
        .slice(0, 10)
        .map((ad: any) => ({
          name: ad.name,
          vendas: ad.sales || 0,
          faturamento: ad.revenue || 0,
          gasto: ad.spend || 0,
          roas: ad.roas || 0,
        }));

      const sortedMeta = rows
        .filter((ad: any) => (ad.conversions ?? 0) > 0)
        .sort((a: any, b: any) => (b.conversions ?? 0) - (a.conversions ?? 0))
        .slice(0, 10)
        .map((ad: any) => ({
          name: ad.name,
          vendas: ad.conversions ?? 0,
          faturamento: ad.meta_revenue || 0,
          gasto: ad.spend || 0,
          roas: ad.spend > 0 ? (ad.meta_revenue || 0) / ad.spend : 0,
        }));

      setTopAds(sortedLastClick);
      setMetaTopAds(sortedMeta);
    } catch (err: any) {
      console.error('Error fetching top ads:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopAds();
  }, [effectiveId, dateRange?.start?.getTime(), dateRange?.end?.getTime(), refetchSignal, activeWorkspaceId]);

  return { topAds, metaTopAds, loading, error, refetch: fetchTopAds };
}
