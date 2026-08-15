import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { CampaignWithMetrics } from './useCampaigns';

interface DateRange {
  start: Date;
  end: Date;
}

export function useMetaCampaigns(dateRange?: DateRange) {
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchCampaigns = async () => {
    if (!effectiveId || !dateRange || !activeWorkspaceId) {
      setCampaigns([]);
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
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const data = await api.get<CampaignWithMetrics[]>(`/metrics/campaigns?${params}`);
      setCampaigns(data || []);
    } catch (err: any) {
      console.error('Error fetching meta campaigns:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [effectiveId, dateRange?.start?.getTime(), dateRange?.end?.getTime(), refetchSignal, activeWorkspaceId]);

  return { campaigns, loading, error, refetch: fetchCampaigns };
}
