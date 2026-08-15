import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { AdSetWithMetrics } from './useAdSets';

interface DateRange {
  start: Date;
  end: Date;
}

export function useMetaAdSets(dateRange?: DateRange, campaignId?: string) {
  const [adSets, setAdSets] = useState<AdSetWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchAdSets = async () => {
    if (!effectiveId || !dateRange || !activeWorkspaceId) {
      setAdSets([]);
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
      if (campaignId) params.set('campaign_id', campaignId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const data = await api.get<AdSetWithMetrics[]>(`/metrics/ad-sets?${params}`);
      setAdSets(data || []);
    } catch (err: any) {
      console.error('Error fetching meta ad sets:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdSets();
  }, [effectiveId, dateRange?.start?.getTime(), dateRange?.end?.getTime(), campaignId, refetchSignal, activeWorkspaceId]);

  return { adSets, loading, error, refetch: fetchAdSets };
}
