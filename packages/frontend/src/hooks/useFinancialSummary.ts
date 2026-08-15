import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { FinancialRange } from '@/lib/financialPeriod';

export interface FinancialSummaryData {
  grossRevenue: number;
  adSpend: number;
  /** Meta Ads tax: a percentage over ad spend, configured per workspace. */
  adSpendTax: number;
  adSpendTaxPercentage: number;
}

const EMPTY: FinancialSummaryData = {
  grossRevenue: 0,
  adSpend: 0,
  adSpendTax: 0,
  adSpendTaxPercentage: 0,
};

export function useFinancialSummary(range: FinancialRange) {
  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { activeWorkspaceId } = useWorkspaceContext();

  const [data, setData] = useState<FinancialSummaryData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const hasFetchedRef = useRef<string | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!effectiveId || !activeWorkspaceId) {
      setData(EMPTY);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('workspace_id', activeWorkspaceId);
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      const result = await api.get<any>(`/financial/summary?${params}`);
      setData({
        grossRevenue: result?.grossRevenue ?? 0,
        adSpend: result?.adSpend ?? 0,
        adSpendTax: result?.adSpendTax ?? 0,
        adSpendTaxPercentage: result?.adSpendTaxPercentage ?? 0,
      });
    } catch (err) {
      console.error('Error fetching financial summary:', err);
    } finally {
      setLoading(false);
    }
  }, [effectiveId, activeWorkspaceId, range.from, range.to]);

  const fetchKey = `${effectiveId}-${activeWorkspaceId}-${range.from ?? ''}-${range.to ?? ''}`;

  useEffect(() => {
    if (hasFetchedRef.current === fetchKey) return;
    hasFetchedRef.current = fetchKey;
    fetchSummary();
  }, [fetchSummary, fetchKey]);

  return { ...data, loading, refetch: fetchSummary };
}
