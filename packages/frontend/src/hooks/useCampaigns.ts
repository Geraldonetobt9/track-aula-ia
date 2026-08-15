import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { format } from 'date-fns';

export interface Campaign {
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
  facebook_campaign_id: string | null;
  date_start: string | null;
  date_end: string | null;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignWithMetrics extends Campaign {
  sales: number;
  revenue: number;
  refunds: number;
  refund_amount: number;
  net_sales: number;
  net_revenue: number;
  roi: number;
  roas: number;
  cpa_real: number;
}

interface DateRange {
  start: Date;
  end: Date;
}

export function useCampaigns(dateRange?: DateRange, connectionIds?: string[]) {
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchCampaigns = async () => {
    if (!effectiveId || !activeWorkspaceId) {
      setCampaigns([]);
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
      if (connectionIds && connectionIds.length > 0) params.set('connection_ids', connectionIds.join(','));
      if (isImpersonating && target) {
        params.set('target_user_id', target.userId);
      }

      const data = await api.get<CampaignWithMetrics[]>(`/metrics/campaigns?${params}`);
      setCampaigns(data || []);
    } catch (err: any) {
      console.error('Error fetching campaigns:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [effectiveId, dateRange?.start?.getTime(), dateRange?.end?.getTime(), refetchSignal, activeWorkspaceId, connectionIds?.join(',')]);

  const patchStatus = (facebookId: string, newStatus: string) => {
    setCampaigns((prev) =>
      prev.map((c) =>
        c.facebook_campaign_id === facebookId ? { ...c, status: newStatus } : c,
      ),
    );
  };

  const patchBudget = (facebookId: string, budgetType: 'daily' | 'lifetime', amountCents: number) => {
    const amountInReais = amountCents / 100;
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.facebook_campaign_id !== facebookId) return c;
        return budgetType === 'daily'
          ? { ...c, daily_budget: amountInReais, lifetime_budget: null }
          : { ...c, lifetime_budget: amountInReais, daily_budget: null };
      }),
    );
  };

  return {
    campaigns,
    loading,
    error,
    refetch: fetchCampaigns,
    patchBudget,
    patchStatus,
  };
}
