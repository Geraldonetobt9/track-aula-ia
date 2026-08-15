import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTimedOut(true);
    }, 12000);

    return () => window.clearTimeout(timeoutId);
  }, [isLoading]);

  if (isLoading && !timedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.2),transparent_40%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)))] px-6">
        <div className="w-full max-w-sm rounded-xl border border-border/70 bg-card/85 p-6 text-center backdrop-blur-sm shadow-lg">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-sm font-medium text-foreground">Carregando sua conta</p>
          <p className="mt-1 text-xs text-muted-foreground">Aguarde um instante...</p>
        </div>
      </div>
    );
  }

  if (isLoading && timedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">A autenticação demorou mais do que o esperado</p>
          <p className="mt-1 text-xs text-muted-foreground">Tente recarregar ou voltar para o login.</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.assign('/login')}>
              Ir para login
            </Button>
            <Button onClick={() => window.location.reload()}>
              Recarregar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
