import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleExecution {
  id: string;
  entity_facebook_id: string | null;
  entity_name: string | null;
  action_taken: string | null;
  metrics_snapshot: Record<string, number> | null;
  status: 'success' | 'skipped' | 'error';
  error_message: string | null;
  executed_at: string;
}

interface RuleHistoryPage {
  items: RuleExecution[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;
const STALE_TIME = 60_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRuleHistory(ruleId: string | null) {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: queryError,
  } = useInfiniteQuery<RuleHistoryPage>({
    queryKey: ['rule-history', ruleId],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageParam) params.set('cursor', pageParam as string);
      return api.get<RuleHistoryPage>(`/automation-rules/${ruleId}/history?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    enabled: !!ruleId,
    staleTime: STALE_TIME,
  });

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const error = queryError ? (queryError as Error).message : null;

  return {
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  };
}
