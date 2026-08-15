import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface UpdateBudgetParams {
  type: 'campaign' | 'adset';
  facebook_id: string;
  budget_type: 'daily' | 'lifetime';
  amount: number; // in cents
}

interface BudgetUpdateResult {
  facebook_id: string;
  budget_type: 'daily' | 'lifetime';
  amount: number; // in cents
}

interface UseBudgetUpdateOptions {
  onSuccess?: (result: BudgetUpdateResult) => void;
}

export function useBudgetUpdate(options?: UseBudgetUpdateOptions) {
  const [updating, setUpdating] = useState(false);

  const updateBudget = async (params: UpdateBudgetParams): Promise<boolean> => {
    setUpdating(true);

    try {
      const data = await api.patch<any>('/facebook/budget', params);

      if (data?.error) {
        console.error('Facebook API error:', data.error);
        toast.error(data.error);
        return false;
      }

      const amountInBRL = params.amount / 100;
      const budgetTypeLabel = params.budget_type === 'daily' ? 'diário' : 'vitalício';
      const typeLabel = params.type === 'campaign' ? 'da campanha' : 'do conjunto';
      const amountFormatted = amountInBRL.toLocaleString('pt-BR', {
        minimumFractionDigits: 2
      });

      toast.success(`Orçamento ${budgetTypeLabel} ${typeLabel} atualizado para R$ ${amountFormatted}`);

      options?.onSuccess?.({
        facebook_id: params.facebook_id,
        budget_type: params.budget_type,
        amount: params.amount,
      });
      return true;

    } catch (error: any) {
      console.error('Update budget exception:', error);
      toast.error(error.message || 'Erro ao atualizar orçamento. Tente novamente.');
      return false;
    } finally {
      setUpdating(false);
    }
  };

  return { updateBudget, updating };
}
