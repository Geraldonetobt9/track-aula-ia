import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function CheckoutReturnHandler() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const status = params.get('status');
    if (!status) return;

    const next = new URLSearchParams(params);
    next.delete('status');
    next.delete('session_id');
    setParams(next, { replace: true });

    if (status === 'cancel') {
      toast({
        title: 'Checkout cancelado',
        description: 'Nenhuma cobrança foi realizada.',
      });
      return;
    }

    if (status === 'success') {
      toast({
        title: 'Pagamento confirmado',
        description: 'Atualizando sua assinatura...',
      });
      setRetrying(true);

      const attemptInvalidate = async (attempt = 0) => {
        await queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
        if (attempt < 2) {
          const delay = (attempt + 1) * 2000;
          setTimeout(() => attemptInvalidate(attempt + 1), delay);
        } else {
          setRetrying(false);
        }
      };

      attemptInvalidate(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!retrying) return null;

  return (
    <div className="rounded bg-blue-950/40 border border-blue-800 p-3 text-sm text-blue-200">
      Atualizando assinatura... pode levar alguns segundos.
    </div>
  );
}
