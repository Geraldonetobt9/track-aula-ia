import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CheckoutCredentialsResponse } from '@/types/admin';

export function useCheckoutCredentials(userId: string, integrationId: string) {
  return useQuery<CheckoutCredentialsResponse>({
    queryKey: ['admin-checkout-credentials', userId, integrationId],
    queryFn: () =>
      api.get<CheckoutCredentialsResponse>(
        `/admin/users/${userId}/checkout-integrations/${integrationId}/credentials`,
      ),
    enabled: false,
    staleTime: 0,
    gcTime: 30_000,
  });
}
