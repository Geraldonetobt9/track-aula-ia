import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type CancelResponse = {
  canceled_at: string;
  ends_at: string;
  already_scheduled: boolean;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function useStripeCancel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation<CancelResponse, Error>({
    mutationFn: () => api.post<CancelResponse>('/stripe/cancel', {}),
    onSuccess: async (data) => {
      toast({
        title: data.already_scheduled
          ? 'Cancelamento já estava agendado'
          : `Cancelamento agendado para ${formatDate(data.ends_at)}`,
      });
      await queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
    },
    onError: (err) => {
      toast({
        title: 'Erro ao cancelar assinatura',
        description: err.message ?? 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    },
  });
}
