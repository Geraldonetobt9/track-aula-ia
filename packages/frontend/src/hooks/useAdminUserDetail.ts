import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AdminUserDetail } from '@/types/admin';

export function useAdminUserDetail(userId: string) {
  const { data: user, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${userId}`),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  return {
    user,
    loading: isLoading,
    error: error?.message || null,
    refetch,
  };
}
