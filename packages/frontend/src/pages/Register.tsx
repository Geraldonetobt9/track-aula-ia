import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import sentinelaLogo from '@/assets/sentinela-logo.png';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: 'Erro',
        description: 'As senhas não coincidem.',
        variant: 'destructive',
      });
      return;
    }

    if (!acceptTerms) {
      toast({
        title: 'Erro',
        description: 'Você precisa aceitar os termos de uso.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const success = await register(name, email, password);
      if (success) {
        toast({
          title: 'Conta criada!',
          description: 'Verifique seu e-mail para confirmar o cadastro.',
        });
        navigate('/onboarding');
      } else {
        toast({
          title: 'Erro ao criar conta',
          description: 'Este e-mail já pode estar em uso ou ocorreu um erro.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao criar a conta.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 -left-32 h-64 w-64 rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-1/4 -right-32 h-64 w-64 rounded-full bg-foreground/3 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm px-4 animate-sentinel-in">
        <div className="mb-10 text-center">
          <img src={sentinelaLogo} alt="Sentinela" className="mx-auto h-16" />
          <p className="mt-2 text-sm text-muted-foreground">
            Comece seu teste grátis de 7 dias
          </p>
        </div>

        <div className="liquid-glass rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">
                Nome completo
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
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
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                Senha
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-xs uppercase tracking-wider text-muted-foreground">
                Confirmar senha
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="flex items-start space-x-2">
              <Checkbox
                id="terms"
                checked={acceptTerms}
                onCheckedChange={(checked) => setAcceptTerms(checked as boolean)}
              />
              <Label htmlFor="terms" className="text-xs leading-tight text-muted-foreground">
                Li e aceito os{' '}
                <Link to="/terms" className="text-foreground hover:text-accent-readable transition-colors">
                  Termos de Uso
                </Link>{' '}
                e a{' '}
                <Link to="/privacy" className="text-foreground hover:text-accent-readable transition-colors">
                  Política de Privacidade
                </Link>
              </Label>
            </div>
            <Button type="submit" className="w-full h-11 text-sm font-medium" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar conta
            </Button>
          </form>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          Já tem uma conta?{' '}
          <Link to="/login" className="text-foreground hover:text-accent-readable transition-colors">
            Entrar
          </Link>
        </div>
      </div>
    </div>
  );
}
