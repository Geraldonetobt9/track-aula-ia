import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PlanRules } from '@/types/admin';

export function useAdminPlans() {
  const queryClient = useQueryClient();

  const { data: planRules, isLoading } = useQuery<PlanRules[]>({
    queryKey: ['admin-plan-rules'],
    queryFn: () => api.get<PlanRules[]>('/plans/rules'),
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async ({ plan, updates }: { plan: string; updates: Partial<PlanRules> }) => {
      return api.patch(`/plans/rules/${plan}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-plan-rules'] });
    },
  });

  return {
    planRules,
    isLoading,
    updatePlanRules: (plan: string, updates: Partial<PlanRules>) =>
      mutation.mutateAsync({ plan, updates }),
    isUpdating: mutation.isPending,
  };
}
