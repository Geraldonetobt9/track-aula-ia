import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type AttachInput = { paymentMethodId: string; setAsDefault?: boolean };
type AttachResponse = { success: true; is_default: boolean };

export function useAttachPaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation<AttachResponse, Error, AttachInput>({
    mutationFn: (input) => api.post<AttachResponse>('/stripe/payment-methods/attach', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stripe', 'payment-methods'] });
    },
  });
}
