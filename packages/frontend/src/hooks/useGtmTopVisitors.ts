import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { isOperatorEmail } from '@/lib/featureAccess';
import { GtmTopVisitor } from '@/types/gtmEvents';

/** A ranking shifts slowly; a minute of staleness is invisible. */
const STALE_TIME_MS = 60_000;

interface VisitorsRange {
  from?: string;
  to?: string;
}

/**
 * People with the most visits in the selected window.
 *
 * `enabled` keeps this from firing for anyone outside the allowlist — the
 * backend answers 403 anyway, but there is no reason to make the request.
 */
export function useGtmTopVisitors(range: VisitorsRange) {
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspaceContext();
  const allowed = isOperatorEmail(user?.email);

  return useQuery<{ visitors: GtmTopVisitor[] }>({
    queryKey: ['gtm-top-visitors', activeWorkspaceId, range.from ?? '', range.to ?? ''],
    enabled: allowed && !!activeWorkspaceId,
    staleTime: STALE_TIME_MS,
    queryFn: () => {
      const params = new URLSearchParams({ workspace_id: activeWorkspaceId as string });
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      return api.get<{ visitors: GtmTopVisitor[] }>(`/gtm/visitors?${params}`);
    },
  });
}
