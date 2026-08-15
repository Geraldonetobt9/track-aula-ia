import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export function useUpdatePassword() {
  return useMutation({
    mutationFn: (input: { password: string }) =>
      api.patch<{ ok: true }>('/me/password', input),
    onSuccess: () => {
      toast.success('Senha alterada');
    },
    onError: (err: any) => {
      toast.error('Não foi possível alterar a senha', {
        description: err?.body?.message ?? err?.message ?? 'Tente novamente.',
      });
    },
  });
}
