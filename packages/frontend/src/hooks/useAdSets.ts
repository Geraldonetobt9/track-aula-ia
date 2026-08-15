import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';

export interface AdSet {
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
  campaign_id: string;
  facebook_adset_id: string | null;
  date_start: string | null;
  date_end: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdSetWithMetrics extends AdSet {
  sales: number;
  revenue: number;
  campaign_name?: string;
  roi: number;
  roas: number;
  cpa_real: number;
}

interface DateRange {
  start: Date;
  end: Date;
}

export function useAdSets(dateRange?: DateRange, campaignIds?: string[], connectionIds?: string[]) {
  const [adSets, setAdSets] = useState<AdSetWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchAdSets = async () => {
    if (!effectiveId || !activeWorkspaceId || !dateRange) {
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
      params.set('workspace_id', activeWorkspaceId);
      if (campaignIds && campaignIds.length > 0) params.set('campaign_ids', campaignIds.join(','));
      if (connectionIds && connectionIds.length > 0) params.set('connection_ids', connectionIds.join(','));
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const data = await api.get<AdSetWithMetrics[]>(`/metrics/ad-sets?${params}`);
      setAdSets(data || []);
    } catch (err: any) {
      console.error('Error fetching ad sets:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdSets();
  }, [effectiveId, dateRange?.start?.getTime(), dateRange?.end?.getTime(), campaignIds?.join(','), refetchSignal, activeWorkspaceId, connectionIds?.join(',')]);

  const patchStatus = (facebookId: string, newStatus: string) => {
    setAdSets((prev) =>
      prev.map((a) =>
        a.facebook_adset_id === facebookId ? { ...a, status: newStatus } : a,
      ),
    );
  };

  const patchBudget = (facebookId: string, budgetType: 'daily' | 'lifetime', amountCents: number) => {
    const amountInReais = amountCents / 100;
    setAdSets((prev) =>
      prev.map((a) => {
        if (a.facebook_adset_id !== facebookId) return a;
        return budgetType === 'daily'
          ? { ...a, daily_budget: amountInReais, lifetime_budget: null }
          : { ...a, lifetime_budget: amountInReais, daily_budget: null };
      }),
    );
  };

  return { adSets, loading, error, refetch: fetchAdSets, patchBudget, patchStatus };
}
