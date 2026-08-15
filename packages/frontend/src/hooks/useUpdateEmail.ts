import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useUpdateEmail() {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      api.patch<{ email: string; stripeSynced: boolean }>('/me/email', input),
  });
}
