import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useRefetch } from '@/contexts/RefetchContext';

export interface BulkItem {
  facebookId: string;
  name: string;
  adAccountId: string;
}

export function useCampaignActions() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { triggerRefetch } = useRefetch();

  const bulkDuplicate = async (items: BulkItem[], type: 'campaign' | 'adset' | 'ad', times: number = 1) => {
    setLoading(true);
    const typeLabel = type === 'campaign' ? 'campanha(s)' : type === 'adset' ? 'conjunto(s)' : 'anuncio(s)';
    let successCount = 0;
    let errorCount = 0;

    try {
      for (let t = 0; t < times; t++) {
        const suffix = times > 1 ? ` - Copia ${t + 1}` : ' - Copia';
        const results = await Promise.allSettled(
          items.map((item) =>
            api.post<any>('/facebook/duplicate', {
              facebook_id: item.facebookId,
              ad_account_id: item.adAccountId,
              type,
              rename_suffix: suffix,
            }),
          ),
        );
        successCount += results.filter((r) => r.status === 'fulfilled').length;
        errorCount += results.filter((r) => r.status === 'rejected').length;
      }

      if (errorCount === 0) {
        toast({ title: 'Duplicado com sucesso', description: `${successCount} ${typeLabel} duplicado(s).` });
      } else {
        toast({ title: 'Duplicacao parcial', description: `${successCount} sucesso, ${errorCount} erro(s).`, variant: 'destructive' });
      }
      triggerRefetch();
    } catch (error: any) {
      toast({ title: 'Erro ao duplicar', description: error.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const bulkUpdateStatus = async (
    items: BulkItem[],
    type: 'campaign' | 'adset' | 'ad',
    status: 'ACTIVE' | 'PAUSED',
    onStatusUpdated?: (facebookId: string, newStatus: string) => void,
  ) => {
    setLoading(true);
    const statusLabel = status === 'ACTIVE' ? 'ativado(s)' : 'pausado(s)';

    try {
      const results = await Promise.allSettled(
        items.map((item) =>
          api.patch<any>('/facebook/campaigns/status', {
            facebook_id: item.facebookId,
            ad_account_id: item.adAccountId,
            type,
            status,
          }),
        ),
      );

      const successIds: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') successIds.push(items[i].facebookId);
      });
      const errors = results.length - successIds.length;

      if (errors === 0) {
        toast({ title: 'Status atualizado', description: `${successIds.length} ${statusLabel} com sucesso.` });
      } else {
        toast({ title: 'Atualizacao parcial', description: `${successIds.length} sucesso, ${errors} erro(s).`, variant: 'destructive' });
      }

      if (onStatusUpdated) {
        const normalizedStatus = status === 'ACTIVE' ? 'active' : 'paused';
        for (const fbId of successIds) {
          onStatusUpdated(fbId, normalizedStatus);
        }
      } else {
        triggerRefetch();
      }
    } catch (error: any) {
      toast({ title: 'Erro ao atualizar status', description: error.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const bulkUpdateBudget = async (
    items: BulkItem[],
    type: 'campaign' | 'adset',
    budgetType: 'daily' | 'lifetime',
    amount: number,
    onBudgetUpdated?: (facebookId: string, budgetType: 'daily' | 'lifetime', amountCents: number) => void,
  ) => {
    setLoading(true);

    try {
      const results = await Promise.allSettled(
        items.map((item) =>
          api.patch<any>('/facebook/budget', {
            facebook_id: item.facebookId,
            ad_account_id: item.adAccountId,
            type,
            budget_type: budgetType,
            amount,
          }),
        ),
      );

      const successIds: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') successIds.push(items[i].facebookId);
      });
      const errors = results.length - successIds.length;

      if (errors === 0) {
        toast({ title: 'Orcamento atualizado', description: `${successIds.length} atualizado(s) com sucesso.` });
      } else {
        toast({ title: 'Atualizacao parcial', description: `${successIds.length} sucesso, ${errors} erro(s).`, variant: 'destructive' });
      }

      if (onBudgetUpdated) {
        for (const fbId of successIds) {
          onBudgetUpdated(fbId, budgetType, amount);
        }
      } else {
        triggerRefetch();
      }
    } catch (error: any) {
      toast({ title: 'Erro ao atualizar orcamento', description: error.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return { bulkDuplicate, bulkUpdateStatus, bulkUpdateBudget, loading };
}
