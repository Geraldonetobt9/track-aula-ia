import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useStripeSetupIntent() {
  return useMutation({
    mutationFn: () => api.post<{ clientSecret: string }>('/stripe/setup-intent', {}),
  });
}
