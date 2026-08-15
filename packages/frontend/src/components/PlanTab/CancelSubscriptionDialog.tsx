import { useStripeCancel } from '@/hooks/useStripeCancel';
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

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  endsAtIso: string;
  planName: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function CancelSubscriptionDialog({ open, onOpenChange, endsAtIso, planName }: Props) {
  const cancel = useStripeCancel();

  async function handleConfirm() {
    try {
      await cancel.mutateAsync();
      onOpenChange(false);
    } catch {
      // toast já foi disparado pelo hook
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar sua assinatura?</AlertDialogTitle>
          <AlertDialogDescription>
            Sua assinatura <span className="capitalize">{planName}</span> continua ativa até {formatDate(endsAtIso)}.
            Depois dessa data, sua conta volta para o plano Grátis automaticamente.
            Você pode reativar a qualquer momento antes do encerramento.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancel.isPending}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={cancel.isPending}
            onClick={handleConfirm}
            className="!bg-destructive !text-destructive-foreground hover:!bg-destructive/90"
          >
            {cancel.isPending ? 'Cancelando...' : 'Sim, cancelar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
