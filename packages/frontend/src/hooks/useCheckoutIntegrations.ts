import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useToast } from '@/hooks/use-toast';
import { CheckoutIntegration, CheckoutPlatform } from '@/types/checkout';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useQueryClient } from '@tanstack/react-query';

const WEBHOOK_DOMAIN = 'https://api.sentinelatracker.com.br';

export interface SaveIntegrationParams {
  id?: string;
  platform: CheckoutPlatform;
  name: string;
  token: string;
  useCommissionValue: boolean;
}

export function useCheckoutIntegrations() {
  const [integrations, setIntegrations] = useState<CheckoutIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const { user } = useAuth();
  const { isImpersonating, target } = useImpersonation();
  const { toast } = useToast();
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();

  const effectiveUserId = isImpersonating && target ? target.userId : user?.id;

  const generateWebhookUrl = (platform: CheckoutPlatform): string => {
    return `${WEBHOOK_DOMAIN}/webhook-${platform}`;
  };

  const fetchIntegrations = useCallback(async () => {
    if (!effectiveUserId) {
      setIntegrations([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
      if (isImpersonating && target) {
        params.set('target_user_id', target.userId);
      }

      const data = await api.get<CheckoutIntegration[]>(`/integrations/checkout?${params}`);

      const typedData = (data || []).map((item: any) => ({
        ...item,
        platform: item.platform as CheckoutPlatform,
      })) as CheckoutIntegration[];

      setIntegrations(typedData);
    } catch (err: any) {
      console.error('Error fetching integrations:', err);
      toast({
        title: 'Erro ao carregar integrações',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, isImpersonating, target, toast, activeWorkspaceId]);

  const saveIntegration = async (params: SaveIntegrationParams): Promise<boolean> => {
    if (!user?.id) return false;
    if (!params.token.trim()) {
      toast({
        title: 'Token obrigatório',
        description: 'Cole o token da plataforma de checkout para continuar.',
        variant: 'destructive',
      });
      return false;
    }
    if (!params.name.trim()) {
      toast({
        title: 'Nome obrigatório',
        description: 'Dê um nome para identificar esta integração.',
        variant: 'destructive',
      });
      return false;
    }

    setSaving(true);

    try {
      const webhookUrl = generateWebhookUrl(params.platform);

      await api.post('/integrations/checkout', {
        ...(params.id ? { id: params.id } : {}),
        platform: params.platform,
        name: params.name.trim(),
        webhook_url: webhookUrl,
        webhook_secret: params.token.trim(),
        workspace_id: activeWorkspaceId || undefined,
        use_commission_value: params.useCommissionValue,
      });

      queryClient.invalidateQueries({ queryKey: ['workspaces'] });

      toast({
        title: params.id ? 'Integração atualizada!' : 'Integração salva!',
        description: `${params.name} configurado com sucesso.`,
      });

      await fetchIntegrations();
      return true;
    } catch (err: any) {
      console.error('Error saving integration:', err);
      const message = err?.response?.data?.message || err.message;
      toast({
        title: 'Erro ao salvar integração',
        description: message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleIntegration = async (id: string, active: boolean): Promise<void> => {
    try {
      await api.patch(`/integrations/checkout/${id}/toggle`, { is_active: active });

      toast({
        title: active ? 'Integração ativada' : 'Integração desativada',
      });

      await fetchIntegrations();
    } catch (err: any) {
      console.error('Error toggling integration:', err);
      toast({
        title: 'Erro ao atualizar integração',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const deleteIntegration = async (id: string): Promise<void> => {
    try {
      await api.delete(`/integrations/checkout/${id}`);

      toast({
        title: 'Integração removida',
      });

      await fetchIntegrations();
    } catch (err: any) {
      console.error('Error deleting integration:', err);
      toast({
        title: 'Erro ao remover integração',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  // When workspace_id is sent to the API, the backend already filters by workspace
  const filteredIntegrations = integrations;

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  return {
    integrations: filteredIntegrations,
    loading,
    saving,
    saveIntegration,
    toggleIntegration,
    deleteIntegration,
    generateWebhookUrl,
    refetch: fetchIntegrations,
  };
}
