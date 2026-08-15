import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function useStripeReactivate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: () => api.post<{ success: true }>('/stripe/reactivate', {}),
    onSuccess: async () => {
      toast({
        title: 'Assinatura reativada',
        description: 'O cancelamento agendado foi descartado.',
      });
      await queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Tente novamente em instantes.';
      toast({
        title: 'Erro ao reativar assinatura',
        description: message,
        variant: 'destructive',
      });
    },
  });
}
