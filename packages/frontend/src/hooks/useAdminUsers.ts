import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminUser, CreateUserData, UpdateUserData, AdminUsersListResponse } from '@/types/admin';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

interface UseAdminUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  plan?: string | null;
  role?: string | null;
  facebookStatus?: string | null;
}

export function useAdminUsers(params: UseAdminUsersParams = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(params.page || 1);
  const [search, setSearch] = useState(params.search || '');
  const [planFilter, setPlanFilter] = useState<string | null>(params.plan || null);
  const [roleFilter, setRoleFilter] = useState<string | null>(params.role || null);
  const [facebookStatusFilter, setFacebookStatusFilter] = useState<string | null>(params.facebookStatus || null);

  const { data, isLoading, error, refetch } = useQuery<AdminUsersListResponse>({
    queryKey: ['admin-users', page, search, planFilter, roleFilter, facebookStatusFilter],
    queryFn: () => {
      const qp = new URLSearchParams();
      qp.set('page', String(page));
      qp.set('limit', '20');
      if (search) qp.set('search', search);
      if (planFilter) qp.set('plan', planFilter);
      if (roleFilter) qp.set('role', roleFilter);
      if (facebookStatusFilter) qp.set('facebook_status', facebookStatusFilter);
      return api.get<AdminUsersListResponse>(`/admin/users?${qp}`);
    },
    staleTime: 30 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (userData: CreateUserData) => api.post('/admin/users', userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast({ title: 'Sucesso', description: 'Usuário criado com sucesso!' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: UpdateUserData }) =>
      api.patch(`/admin/users/${userId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-detail'] });
      toast({ title: 'Sucesso', description: 'Usuário atualizado com sucesso!' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast({ title: 'Sucesso', description: 'Usuário excluído com sucesso!' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    },
  });

  const forceSyncMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/admin/users/${userId}/force-sync`),
    onSuccess: () => {
      toast({ title: 'Sucesso', description: 'Sincronização agendada!' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    },
  });

  return {
    users: data?.users || [],
    totalCount: data?.total_count || 0,
    loading: isLoading,
    error: error?.message || null,
    page,
    setPage,
    totalPages: data?.total_pages || 1,
    search,
    setSearch,
    planFilter,
    setPlanFilter,
    roleFilter,
    setRoleFilter,
    facebookStatusFilter,
    setFacebookStatusFilter,
    createUser: createMutation.mutateAsync,
    updateUser: (userId: string, userData: UpdateUserData) =>
      updateMutation.mutateAsync({ userId, data: userData }),
    deleteUser: deleteMutation.mutateAsync,
    forceSync: forceSyncMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    refetch,
  };
}
