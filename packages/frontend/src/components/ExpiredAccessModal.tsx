import { useAuth } from '@/contexts/AuthContext';
import { useAccessControl } from '@/hooks/useAccessControl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldAlert, ExternalLink, LogOut } from 'lucide-react';

const SUBSCRIPTION_URL = 'https://seusite.com/planos'; // TODO: substituir pela URL real

export function ExpiredAccessModal() {
  const { user, logout } = useAuth();
  const { isExpired } = useAccessControl(user);

  if (!isExpired) return null;

  return (
    <Dialog open={true}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-destructive/10 p-4">
              <ShieldAlert className="h-10 w-10 text-destructive" />
            </div>
          </div>
          <DialogTitle className="text-xl">Acesso Expirado</DialogTitle>
          <DialogDescription className="text-base">
            Sua assinatura expirou
            {user?.subscription_end
              ? ` em ${new Date(user.subscription_end).toLocaleDateString('pt-BR')}`
              : ''}
            . Renove seu plano para continuar utilizando a plataforma.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            onClick={() => window.open(SUBSCRIPTION_URL, '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Renovar Assinatura
          </Button>
          <Button variant="outline" className="w-full" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
