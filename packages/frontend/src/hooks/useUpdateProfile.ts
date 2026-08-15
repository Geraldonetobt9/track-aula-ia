import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      api.patch<{ name: string }>('/me/profile', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Nome atualizado');
    },
    onError: (err: any) => {
      toast.error('Não foi possível atualizar', {
        description: err?.body?.message ?? err?.message ?? 'Tente novamente.',
      });
    },
  });
}
