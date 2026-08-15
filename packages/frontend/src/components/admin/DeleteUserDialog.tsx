import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AdminUser } from '@/types/admin';
import { Loader2 } from 'lucide-react';

interface DeleteUserDialogProps {
  user: AdminUser | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isLoading: boolean;
}

export function DeleteUserDialog({ user, open, onClose, onConfirm, isLoading }: DeleteUserDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>⚠️ Excluir Usuário</AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <p>
              Tem certeza que deseja excluir o usuário <strong>"{user?.name}"</strong> ({user?.email})?
            </p>
            <p>Esta ação irá remover permanentemente:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Perfil e dados de acesso</li>
              <li>Todas as campanhas sincronizadas</li>
              <li>Todas as vendas registradas</li>
              <li>Todas as integrações configuradas</li>
            </ul>
            <p className="font-semibold text-muted-foreground/60">
              Esta ação não pode ser desfeita.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Excluir Permanentemente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
