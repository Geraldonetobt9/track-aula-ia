import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { usePlanUsage } from '@/hooks/usePlanUsage';

export type Invoice = {
  id: string;
  number: string | null;
  status:
    | 'draft'
    | 'open'
    | 'paid'
    | 'uncollectible'
    | 'void'
    | 'unknown';
  amount_due_cents: number;
  amount_paid_cents: number;
  total_cents: number;
  currency: string;
  created: string;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

export type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
};

type PaymentMethodsResponse = {
  default_payment_method_id: string | null;
  payment_methods: PaymentMethod[];
};

export function useInvoices() {
  const { usage } = usePlanUsage();
  return useQuery<Invoice[]>({
    queryKey: ['stripe', 'invoices'],
    queryFn: () => api.get<Invoice[]>('/stripe/invoices'),
    staleTime: 60_000,
    enabled: !!usage?.subscription.has_stripe_customer,
  });
}

export function usePaymentMethods() {
  const { usage } = usePlanUsage();
  return useQuery<PaymentMethodsResponse>({
    queryKey: ['stripe', 'payment-methods'],
    queryFn: () => api.get<PaymentMethodsResponse>('/stripe/payment-methods'),
    staleTime: 60_000,
    enabled: !!usage?.subscription.has_stripe_customer,
  });
}

export function useSetDefaultPaymentMethod() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (paymentMethodId: string) =>
      api.post(`/stripe/payment-methods/${paymentMethodId}/default`, {}),
    onSuccess: async () => {
      toast({ title: 'Cartão padrão atualizado' });
      await queryClient.invalidateQueries({ queryKey: ['stripe', 'payment-methods'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Tente novamente em instantes.';
      toast({ title: 'Erro ao definir cartão padrão', description: message, variant: 'destructive' });
    },
  });
}

export function useDetachPaymentMethod() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (paymentMethodId: string) =>
      api.delete(`/stripe/payment-methods/${paymentMethodId}`),
    onSuccess: async () => {
      toast({ title: 'Cartão removido' });
      await queryClient.invalidateQueries({ queryKey: ['stripe', 'payment-methods'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Tente novamente em instantes.';
      toast({ title: 'Erro ao remover cartão', description: message, variant: 'destructive' });
    },
  });
}
