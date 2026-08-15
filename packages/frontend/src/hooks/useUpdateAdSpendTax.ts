import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function useUpdateAdSpendTax() {
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saveTax = useCallback(
    async (workspaceId: string, percentage: number): Promise<boolean> => {
      setSaving(true);
      try {
        await api.patch(`/workspaces/${workspaceId}/ad-spend-tax`, { percentage });
        queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tente novamente';
        toast({
          title: 'Erro ao salvar imposto',
          description: message,
          variant: 'destructive',
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [queryClient, toast],
  );

  return { saveTax, saving };
}
