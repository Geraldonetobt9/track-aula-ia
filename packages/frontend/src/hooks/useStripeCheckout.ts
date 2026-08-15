import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type CheckoutResponse =
  | { url: string }
  | { redirectTo: string }
  | { changed: true; plan: string };

export function useStripeCheckout() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (planId: string) => {
      return api.post<CheckoutResponse>('/stripe/checkout', { planId });
    },
    onSuccess: async (data) => {
      if ('url' in data) {
        window.location.href = data.url;
        return;
      }
      if ('redirectTo' in data) {
        const portalData = await api.post<{ url: string }>('/stripe/portal', {});
        window.location.href = portalData.url;
        return;
      }
      if ('changed' in data) {
        toast({
          title: 'Plano atualizado',
          description: `Sua assinatura agora é ${data.plan}. Ajustes proporcionais foram aplicados no próximo pagamento.`,
        });
        await queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Tente novamente em instantes.';
      toast({
        title: 'Erro ao trocar de plano',
        description: message,
        variant: 'destructive',
      });
    },
  });
}
