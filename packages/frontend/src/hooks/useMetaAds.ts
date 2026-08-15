import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { AdWithMetrics } from './useAds';

interface DateRange {
  start: Date;
  end: Date;
}

export function useMetaAds(dateRange?: DateRange, adSetId?: string) {
  const [ads, setAds] = useState<AdWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchAds = async () => {
    if (!effectiveId || !dateRange || !activeWorkspaceId) {
      setAds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('from', format(dateRange.start, 'yyyy-MM-dd'));
      params.set('to', format(dateRange.end, 'yyyy-MM-dd'));
      params.set('source', 'meta');
      params.set('workspace_id', activeWorkspaceId);
      if (adSetId) params.set('ad_set_id', adSetId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const data = await api.get<AdWithMetrics[]>(`/metrics/ads?${params}`);
      setAds(data || []);
    } catch (err: any) {
      console.error('Error fetching meta ads:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();
  }, [effectiveId, dateRange?.start?.getTime(), dateRange?.end?.getTime(), adSetId, refetchSignal, activeWorkspaceId]);

  return { ads, loading, error, refetch: fetchAds };
}
