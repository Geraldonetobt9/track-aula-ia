import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';

export function useSalesProducts() {
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const enabled = !!effectiveId && !!activeWorkspaceId;

  const query = useQuery<string[], Error>({
    queryKey: ['sales-products', effectiveId, activeWorkspaceId, refetchSignal],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('workspace_id', activeWorkspaceId!);
      return api.get<string[]>(`/sales/products?${params}`);
    },
  });

  return {
    products: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}
