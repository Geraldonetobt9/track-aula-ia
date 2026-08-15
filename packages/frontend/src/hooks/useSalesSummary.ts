import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import type { SalesFilters } from './useSales';

export interface SalesSummaryMetrics {
  approved_count: number;
  gross_revenue: number;
  avg_ticket: number;
  refunds_count: number;
  refund_rate: number;
}

export interface ProductBreakdownEntry {
  product_name: string;
  count: number;
  revenue: number;
}

export interface AdBreakdownEntry {
  name: string;
  count: number;
  revenue: number;
}

export interface RefundStateEntry {
  state: string;
  count: number;
}

export interface RefundedSampleEntry {
  customer_name: string | null;
  customer_state: string | null;
  amount: number;
}

export interface SalesSummary {
  metrics: SalesSummaryMetrics;
  by_product: ProductBreakdownEntry[];
  by_ad: AdBreakdownEntry[];
  refunds_by_state: RefundStateEntry[];
  refunded_sample: RefundedSampleEntry[];
}

const EMPTY_SUMMARY: SalesSummary = {
  metrics: {
    approved_count: 0,
    gross_revenue: 0,
    avg_ticket: 0,
    refunds_count: 0,
    refund_rate: 0,
  },
  by_product: [],
  by_ad: [],
  refunds_by_state: [],
  refunded_sample: [],
};

const DEFAULT_STATUSES = ['approved', 'refunded'];

export function useSalesSummary(filters: Omit<SalesFilters, 'page' | 'pageSize'> = {}) {
  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const targetUserId = isImpersonating && target ? target.userId : undefined;
  const enabled = !!effectiveId && !!activeWorkspaceId;

  const queryKey = [
    'sales-summary',
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
  ];

  const query = useQuery<SalesSummary, Error>({
    queryKey,
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('workspace_id', activeWorkspaceId!);
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
      if (targetUserId) {
        params.set('target_user_id', targetUserId);
      }

      return api.get<SalesSummary>(`/sales/summary?${params}`);
    },
  });

  return {
    summary: query.data ?? EMPTY_SUMMARY,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
