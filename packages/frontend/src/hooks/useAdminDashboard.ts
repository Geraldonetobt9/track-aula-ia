import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AdminStats } from '@/types/admin';

export function useAdminDashboard() {
  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<AdminStats>('/admin/stats'),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    stats,
    loading: isLoading,
    error: error?.message || null,
    refetch,
  };
}
