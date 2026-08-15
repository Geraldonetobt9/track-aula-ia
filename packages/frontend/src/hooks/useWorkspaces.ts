import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useToast } from '@/hooks/use-toast';

export interface Workspace {
  id: string;
  user_id: string;
  name: string;
  ad_spend_tax_percentage: number;
  created_at: string;
  updated_at: string;
}

export function useWorkspaces() {
  const { user } = useAuth();
  const { isImpersonating, target } = useImpersonation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const effectiveUserId = isImpersonating && target ? target.userId : user?.id;
  const impersonationParam = isImpersonating && target ? `?target_user_id=${target.userId}` : '';

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ['workspaces', effectiveUserId],
    queryFn: async () => {
      return api.get<Workspace[]>(`/workspaces${impersonationParam}`);
    },
    enabled: !!effectiveUserId,
    staleTime: 5 * 60 * 1000,
  });

  const createWorkspace = useCallback(async (name: string) => {
    try {
      const data = await api.post<Workspace>('/workspaces', { name });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast({ title: 'Área criada com sucesso' });
      return data || null;
    } catch (err: any) {
      toast({ title: 'Erro ao criar área', description: err.message, variant: 'destructive' });
      return null;
    }
  }, [queryClient, toast]);

  const updateWorkspace = useCallback(async (workspaceId: string, name: string) => {
    try {
      await api.patch(`/workspaces/${workspaceId}`, { name });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      return true;
    } catch {
      toast({ title: 'Erro ao atualizar área', variant: 'destructive' });
      return false;
    }
  }, [queryClient, toast]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await api.delete(`/workspaces/${workspaceId}`);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast({ title: 'Área excluída' });
      return true;
    } catch {
      toast({ title: 'Erro ao excluir área', variant: 'destructive' });
      return false;
    }
  }, [queryClient, toast]);

  return {
    workspaces,
    isLoading,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
  };
}
