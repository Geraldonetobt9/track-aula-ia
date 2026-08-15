import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { TaxIdType } from '@/lib/tax-id';

export function useUpdateTaxId() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: TaxIdType; value: string }) =>
      api.patch<{ type: TaxIdType; value: string; stripeSynced: boolean }>('/me/tax-id', input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Documento atualizado', {
        description: data.stripeSynced
          ? undefined
          : 'Sincronização com Stripe pendente — tentaremos novamente em breve.',
      });
    },
    onError: (err: any) => {
      toast.error('Não foi possível atualizar', {
        description: err?.body?.message ?? err?.message ?? 'Tente novamente.',
      });
    },
  });
}
