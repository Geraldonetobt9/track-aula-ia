import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useCompanyCosts } from '@/hooks/useCompanyCosts';
import { api } from '@/lib/api';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export interface MonthlyProfit {
  month: string; // "Jan", "Fev", etc.
  monthKey: string; // "yyyy-MM-dd"
  grossRevenue: number;
  adSpend: number;
  expenses: number;
  revenues: number;
  companyCosts: number;
  profit: number;
}

export function useProfitEvolution(numMonths = 6) {
  const { user, supabaseUser } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { activeWorkspaceId } = useWorkspaceContext();
  const { costs: companyCostsList } = useCompanyCosts();

  const [data, setData] = useState<MonthlyProfit[]>([]);
  const [loading, setLoading] = useState(true);
  const hasFetchedRef = useRef<string | null>(null);

  const fetchEvolution = useCallback(async () => {
    if (!effectiveId || !activeWorkspaceId || !supabaseUser) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const months: { key: string; label: string; start: Date; end: Date }[] = [];
      const now = new Date();
      for (let i = numMonths - 1; i >= 0; i--) {
        const d = startOfMonth(subMonths(now, i));
        const e = endOfMonth(d);
        months.push({
          key: format(d, 'yyyy-MM-dd'),
          label: format(d, 'MMM', { locale: ptBR }),
          start: d,
          end: e,
        });
      }

      const globalFrom = format(months[0].start, 'yyyy-MM-dd');
      const globalTo = format(months[months.length - 1].end, 'yyyy-MM-dd');

      const params = new URLSearchParams();
      params.set('from', globalFrom);
      params.set('to', globalTo);
      params.set('workspace_id', activeWorkspaceId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);

      // Fetch dashboard data for the entire range
      const dashboardData = await api.get<any>(`/metrics/dashboard?${params}`);

      // Fetch financial entries for workspace
      const entriesParams = new URLSearchParams({ workspace_id: activeWorkspaceId });
      const allEntries = await api.get<any[]>(`/financial?${entriesParams}`);
      const entries = (allEntries || []).map((e: any) => ({ ...e, amount: Number(e.amount) }));

      // Build monthly data from the aggregated response
      // The backend returns monthly breakdowns if available, otherwise we use totals
      const monthlyData = dashboardData?.monthlyBreakdown || [];

      const result: MonthlyProfit[] = months.map((m) => {
        const monthData = monthlyData.find((md: any) => md.monthKey === m.key) || {
          grossRevenue: 0,
          adSpend: 0,
        };

        const monthEntries = entries.filter((e: any) => e.reference_month === m.key);
        const expenses = monthEntries.filter((e: any) => e.type === 'expense').reduce((s: number, e: any) => s + e.amount, 0);
        const revenues = monthEntries.filter((e: any) => e.type === 'revenue').reduce((s: number, e: any) => s + e.amount, 0);

        const grossRevenue = monthData.grossRevenue || 0;
        const adSpend = monthData.adSpend || 0;

        const companyCostsTotal = companyCostsList.reduce((sum, cost) => {
          if (cost.type === 'percentage') return sum + grossRevenue * (cost.value / 100);
          return sum + cost.value;
        }, 0);

        const profit = grossRevenue - adSpend - expenses - companyCostsTotal + revenues;

        return {
          month: m.label.charAt(0).toUpperCase() + m.label.slice(1),
          monthKey: m.key,
          grossRevenue,
          adSpend,
          expenses,
          revenues,
          companyCosts: companyCostsTotal,
          profit,
        };
      });

      setData(result);
    } catch (err) {
      console.error('Error fetching profit evolution:', err);
    } finally {
      setLoading(false);
    }
  }, [effectiveId, activeWorkspaceId, supabaseUser, companyCostsList, numMonths]);

  const fetchKey = `${effectiveId}-${activeWorkspaceId}-${numMonths}`;

  useEffect(() => {
    if (hasFetchedRef.current === fetchKey) return;
    hasFetchedRef.current = fetchKey;
    fetchEvolution();
  }, [fetchEvolution, fetchKey]);

  return { data, loading };
}
