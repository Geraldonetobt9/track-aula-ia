import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

type EntityType = 'campaign' | 'adset' | 'ad';

interface UseCampaignStatusUpdateOptions {
  onStatusUpdated?: (facebookId: string, newStatus: string) => void;
}

export function useCampaignStatusUpdate(options?: UseCampaignStatusUpdateOptions) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const updateStatus = async (
    facebookId: string,
    newStatus: 'ACTIVE' | 'PAUSED',
    type: EntityType = 'campaign'
  ): Promise<boolean> => {
    setUpdatingId(facebookId);

    try {
      const data = await api.patch<any>('/facebook/campaigns/status', {
        facebook_id: facebookId,
        status: newStatus,
        type,
      });

      if (data?.error) {
        console.error('Facebook API error:', data.error);
        toast.error(data.error);
        return false;
      }

      const typeLabels: Record<EntityType, string> = {
        campaign: 'Campanha',
        adset: 'Conjunto',
        ad: 'Anúncio',
      };
      const label = newStatus === 'ACTIVE' ? 'ativado(a)' : 'pausado(a)';
      toast.success(`${typeLabels[type]} ${label} com sucesso`);

      const normalizedStatus = newStatus === 'ACTIVE' ? 'active' : 'paused';
      options?.onStatusUpdated?.(facebookId, normalizedStatus);
      return true;
    } catch (error: any) {
      console.error('Update status exception:', error);
      toast.error(error.message || 'Erro ao atualizar status. Tente novamente.');
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  return { updateStatus, updatingId };
}
