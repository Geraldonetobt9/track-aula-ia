import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

export interface FacebookConnectionInfo {
  id: string;
  ad_account_id: string;
  account_name: string | null;
  account_status?: number | null;
  facebook_user_id?: string | null;
  facebook_user_name?: string | null;
  is_valid?: boolean;
  is_active?: boolean;
}

export interface RefreshProfileResult {
  added: number;
  updated: number;
  total: number;
}

interface UseFacebookConnectionOptions {
  activeOnly?: boolean;
  minimal?: boolean;
}

export function useFacebookConnection(options?: UseFacebookConnectionOptions) {
  const activeOnly = options?.activeOnly ?? false;
  const minimal = options?.minimal ?? false;
  const [connections, setConnectionsLocal] = useState<FacebookConnectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  const { isImpersonating, target } = useImpersonation();
  const { activeWorkspaceId } = useWorkspaceContext();

  const effectiveUserId = isImpersonating && target ? target.userId : user?.id;

  const fetchConnections = async () => {
    if (!effectiveUserId) {
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);
      if (activeOnly) params.set('active_only', 'true');
      if (minimal) params.set('minimal', 'true');
      const data = await api.get<FacebookConnectionInfo[]>(`/facebook/connections?${params}`);
      setConnectionsLocal(data || []);
    } catch (error) {
      console.error('Error fetching Facebook connections:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteProfile = async (facebookUserId: string) => {
    try {
      await api.delete(`/facebook/connections/profile/${facebookUserId}`);
      await fetchConnections();

      toast({
        title: 'Perfil removido',
        description: 'O perfil do Facebook e todas as contas de anúncios foram removidos.',
      });
    } catch (error: any) {
      console.error('Error deleting Facebook profile:', error);
      toast({
        title: 'Erro ao remover',
        description: error.message || 'Não foi possível remover o perfil.',
        variant: 'destructive',
      });
    }
  };

  /**
   * Re-queries Facebook for ad accounts the profile can reach now. New accounts
   * arrive deactivated, so nothing starts consuming plan limits on its own.
   */
  const refreshProfile = async (facebookUserId: string): Promise<boolean> => {
    try {
      const result = await api.post<RefreshProfileResult>(
        `/facebook/connections/profile/${facebookUserId}/refresh`,
        {},
      );
      await fetchConnections();

      if (result.added > 0) {
        toast({
          title: `${result.added} nova${result.added !== 1 ? 's' : ''} conta${result.added !== 1 ? 's' : ''} encontrada${result.added !== 1 ? 's' : ''}`,
          description: 'Ative as contas que você quer rastrear na lista abaixo.',
        });
      } else {
        toast({
          title: 'Nenhuma conta nova',
          description: `O Facebook retornou ${result.total} conta${result.total !== 1 ? 's' : ''} — todas já estão na lista.`,
        });
      }

      return true;
    } catch (error: unknown) {
      console.error('Error refreshing Facebook profile:', error);
      toast({
        title: 'Erro ao atualizar',
        description:
          error instanceof Error && error.message
            ? error.message
            : 'Não foi possível consultar as contas no Facebook.',
        variant: 'destructive',
      });
      return false;
    }
  };

  const toggleActive = async (connectionId: string, isActive: boolean): Promise<boolean> => {
    try {
      await api.patch<any>(`/facebook/connections/${connectionId}/active`, { is_active: isActive });
      await fetchConnections();
      return true;
    } catch (error: any) {
      console.error('Error toggling connection active:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Não foi possível alterar o status da conta.',
        variant: 'destructive',
      });
      return false;
    }
  };

  useEffect(() => {
    fetchConnections();
  }, [effectiveUserId, activeWorkspaceId, activeOnly, minimal]);

  return {
    connections,
    allConnections: connections,
    loading,
    deleteProfile,
    refreshProfile,
    toggleActive,
    refetch: fetchConnections,
    isConfigured: connections.length > 0,
    isValid: connections.some(c => c.is_valid),
  };
}
