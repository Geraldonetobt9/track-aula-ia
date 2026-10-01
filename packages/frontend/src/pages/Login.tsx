import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { Logo } from '@/components/Logo';

/**
 * Só entrar. Não há mais "Criar conta": as contas nascem em
 * Configurações > Usuários, e só quem administra vê aquela aba.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const emailChanged = searchParams.get('email_changed') === '1';

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await login(email, password);
      if (result.success) {
        toast({
          title: 'Login realizado!',
          description: 'Bem-vindo de volta.',
        });
        if (emailChanged) {
          setSearchParams({}, { replace: true });
        }
        navigate('/dashboard');
      } else {
        toast({
          title: 'Erro ao entrar',
          description: 'E-mail ou senha incorretos.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao fazer login.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background py-12">
      {/* Subtle ambient glow */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 -left-24 h-72 w-72 rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-1/4 -right-24 h-72 w-72 rounded-full bg-primary/6 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm px-4 animate-sentinel-in">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Logo size="lg" className="justify-center" />
          <p className="mt-2 text-sm text-muted-foreground">Acesse seu painel de controle</p>
        </div>

        <div className="liquid-glass rounded-lg p-6">
          {emailChanged && (
            <div
              className="mb-4 rounded-md border border-accent-readable/30 bg-primary/10 px-4 py-3 text-sm"
              role="status"
            >
              <p className="font-medium text-accent-readable">Seu e-mail foi alterado.</p>
              <p className="text-muted-foreground mt-1">
                Use o <strong>novo endereço</strong> para entrar.
              </p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                E-mail
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="relative space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                Senha
              </Label>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[30px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Esqueci minha senha
              </Link>
            </div>
            <Button type="submit" className="w-full h-11 text-sm font-medium" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
