import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';

export interface Ad {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  initiate_checkouts: number;
  cpc: number;
  cpm: number;
  ctr: number;
  ad_set_id: string;
  facebook_ad_id: string | null;
  date_start: string | null;
  date_end: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdWithMetrics extends Ad {
  sales: number;
  revenue: number;
  ad_set_name?: string;
  roi: number;
  roas: number;
  cpa_real: number;
}

interface DateRange {
  start: Date;
  end: Date;
}

export function useAds(dateRange?: DateRange, adSetIds?: string[], connectionIds?: string[], campaignIds?: string[]) {
  const [ads, setAds] = useState<AdWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchAds = async () => {
    if (!effectiveId || !activeWorkspaceId || !dateRange) {
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
      params.set('workspace_id', activeWorkspaceId);
      if (adSetIds && adSetIds.length > 0) params.set('ad_set_ids', adSetIds.join(','));
      if (campaignIds && campaignIds.length > 0) params.set('campaign_ids', campaignIds.join(','));
      if (connectionIds && connectionIds.length > 0) params.set('connection_ids', connectionIds.join(','));
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const data = await api.get<AdWithMetrics[]>(`/metrics/ads?${params}`);
      setAds(data || []);
    } catch (err: any) {
      console.error('Error fetching ads:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();
  }, [effectiveId, dateRange?.start?.getTime(), dateRange?.end?.getTime(), adSetIds?.join(','), campaignIds?.join(','), refetchSignal, activeWorkspaceId, connectionIds?.join(',')]);

  return { ads, loading, error, refetch: fetchAds };
}
