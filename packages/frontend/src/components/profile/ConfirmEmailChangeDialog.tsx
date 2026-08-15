import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useUpdateEmail } from '@/hooks/useUpdateEmail';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  currentEmail: string;
  newEmail: string;
  onCancel: () => void;
}

export function ConfirmEmailChangeDialog({ open, currentEmail, newEmail, onCancel }: Props) {
  const mutation = useUpdateEmail();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  async function handleConfirm() {
    setRunning(true);
    try {
      await mutation.mutateAsync({ email: newEmail });
      toast.success('E-mail alterado', {
        description: `Faça login novamente com ${newEmail}.`,
      });
      // Tear down the local session and redirect.
      await supabase.auth.signOut();
      qc.clear();
      navigate(`/login?email_changed=1`, { replace: true });
    } catch (err: any) {
      onCancel();
      toast.error('Não foi possível alterar o e-mail', {
        description: err?.body?.message ?? err?.message ?? 'Tente novamente.',
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar troca de e-mail</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>
                Vamos alterar seu e-mail de <strong>{currentEmail}</strong> para{' '}
                <strong>{newEmail}</strong>.
              </p>
              <p>
                Após confirmar, você vai ser <strong>deslogado</strong> e precisará fazer login
                novamente com o novo e-mail.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running} onClick={onCancel}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction disabled={running} onClick={handleConfirm}>
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar troca
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
