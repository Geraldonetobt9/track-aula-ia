import { useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';

interface DateRange {
  from: Date;
  to: Date;
}

export interface Sale {
  id: string;
  product_name: string | null;
  amount: number;
  status: string | null;
  sold_at: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_doc: string | null;
  customer_state: string | null;
  payment_method: string | null;
  campaign_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  external_id: string | null;
  created_at: string;
  ad_id: string | null;
}

export interface SaleWithDetails extends Sale {
  campaign_name: string | null;
  checkout_platform: string | null;
  ad_set_name: string | null;
  ad_name: string | null;
  type: 'paid' | 'organic';
}

export interface SalesFilters {
  dateRange?: DateRange;
  statuses?: string[];
  checkoutIds?: string[];
  productNames?: string[];
  campaignIds?: string[];
  q?: string;
  page?: number;
  pageSize?: number;
}

interface SalesResponse {
  data: SaleWithDetails[];
  total: number;
  page: number;
  page_size: number;
}

const DEFAULT_STATUSES = ['approved', 'refunded'];

function buildQueryString(
  workspaceId: string,
  filters: SalesFilters,
  targetUserId?: string,
): string {
  const params = new URLSearchParams();
  params.set('workspace_id', workspaceId);

  const statuses = filters.statuses && filters.statuses.length > 0 ? filters.statuses : DEFAULT_STATUSES;
  params.set('status', statuses.join(','));

  if (filters.dateRange) {
    params.set('from', format(filters.dateRange.from, 'yyyy-MM-dd'));
    params.set('to', format(filters.dateRange.to, 'yyyy-MM-dd'));
  }
  if (filters.checkoutIds && filters.checkoutIds.length > 0) {
    params.set('checkout_ids', filters.checkoutIds.join(','));
  }
  if (filters.productNames && filters.productNames.length > 0) {
    params.set('product_names', filters.productNames.join(','));
  }
  if (filters.campaignIds && filters.campaignIds.length > 0) {
    params.set('campaign_ids', filters.campaignIds.join(','));
  }
  if (filters.q) {
    params.set('q', filters.q);
  }
  if (filters.page) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize) {
    params.set('page_size', String(filters.pageSize));
  }
  if (targetUserId) {
    params.set('target_user_id', targetUserId);
  }

  return params.toString();
}

export function useSales(filters: SalesFilters = {}) {
  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const targetUserId = isImpersonating && target ? target.userId : undefined;

  const queryKey = useMemo(
    () => [
      'sales',
      effectiveId,
      activeWorkspaceId,
      targetUserId ?? null,
      refetchSignal,
      filters.dateRange?.from?.getTime() ?? null,
      filters.dateRange?.to?.getTime() ?? null,
      filters.statuses?.join(',') ?? null,
      filters.checkoutIds?.join(',') ?? null,
      filters.productNames?.join(',') ?? null,
      filters.campaignIds?.join(',') ?? null,
      filters.q ?? null,
      filters.page ?? 1,
      filters.pageSize ?? 50,
    ],
    [
      effectiveId,
      activeWorkspaceId,
      targetUserId,
      refetchSignal,
      filters.dateRange?.from,
      filters.dateRange?.to,
      filters.statuses,
      filters.checkoutIds,
      filters.productNames,
      filters.campaignIds,
      filters.q,
      filters.page,
      filters.pageSize,
    ],
  );

  const enabled = !!effectiveId && !!activeWorkspaceId;

  const query = useQuery<SalesResponse, Error>({
    queryKey,
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const qs = buildQueryString(activeWorkspaceId!, filters, targetUserId);
      return api.get<SalesResponse>(`/sales?${qs}`);
    },
  });

  const fetchAdSpend = useCallback(
    async (fromDate?: string, toDate?: string): Promise<number> => {
      if (!effectiveId) return 0;
      try {
        const params = new URLSearchParams();
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
        if (targetUserId) params.set('target_user_id', targetUserId);
        const data = await api.get<{ total_spend: number }>(`/metrics/daily-spend?${params}`);
        return data?.total_spend || 0;
      } catch (err) {
        console.error('Error fetching ad spend:', err);
        return 0;
      }
    },
    [effectiveId, activeWorkspaceId, targetUserId],
  );

  return {
    sales: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    page: query.data?.page ?? filters.page ?? 1,
    pageSize: query.data?.page_size ?? filters.pageSize ?? 50,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    fetchAdSpend,
  };
}
