import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';

export interface CampaignsFunnelData {
  linkClicks: number;
  landingPageViews: number;
  initiateCheckouts: number;
  sales: number;
  loading: boolean;
}

interface DateRange {
  start: Date;
  end: Date;
}

export function useCampaignsFunnel(
  dateRange: DateRange,
  campaignIds: string[]
): CampaignsFunnelData {
  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { activeWorkspaceId } = useWorkspaceContext();
  const [data, setData] = useState<Omit<CampaignsFunnelData, 'loading'>>({
    linkClicks: 0,
    landingPageViews: 0,
    initiateCheckouts: 0,
    sales: 0,
  });
  const [loading, setLoading] = useState(true);

  const campaignIdsKey = campaignIds.join(',');
  const targetUserId = isImpersonating ? target?.userId : null;
  const rangeFrom = dateRange.start.getTime();
  const rangeTo = dateRange.end.getTime();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!effectiveId || !activeWorkspaceId || campaignIdsKey === '') {
        setData({ linkClicks: 0, landingPageViews: 0, initiateCheckouts: 0, sales: 0 });
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('from', format(dateRange.start, 'yyyy-MM-dd'));
        params.set('to', format(dateRange.end, 'yyyy-MM-dd'));
        params.set('workspace_id', activeWorkspaceId);
        if (targetUserId) params.set('target_user_id', targetUserId);

        const rows = await api.get<any[]>(`/metrics/daily-spend?${params}`);
        if (cancelled) return;
        const arr = Array.isArray(rows) ? rows : [];

        let linkClicks = 0;
        let landingPageViews = 0;
        let initiateCheckouts = 0;
        let sales = 0;

        for (const row of arr) {
          linkClicks += row.link_clicks || 0;
          landingPageViews += row.landing_page_views || 0;
          initiateCheckouts += row.initiate_checkouts || 0;
          sales += row.conversions || 0;
        }

        setData({ linkClicks, landingPageViews, initiateCheckouts, sales });
      } catch (error) {
        if (!cancelled) console.error('Error fetching campaigns funnel:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, activeWorkspaceId, rangeFrom, rangeTo, campaignIdsKey, targetUserId]);

  return { ...data, loading };
}
