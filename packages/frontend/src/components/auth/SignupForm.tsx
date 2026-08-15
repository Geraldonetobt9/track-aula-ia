import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import {
  formatTaxId,
  isValidTaxId,
  stripDigits,
  TaxIdType,
} from '@/lib/tax-id';

interface SignupFormProps {
  onSignupSuccess: (email: string) => void;
}

export function SignupForm({ onSignupSuccess }: SignupFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [taxIdType, setTaxIdType] = useState<TaxIdType>('cpf');
  const [taxIdValue, setTaxIdValue] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Informe seu nome completo';
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) next.email = 'E-mail invalido';
    if (password.length < 8) next.password = 'Senha precisa ter no minimo 8 caracteres';
    if (password !== passwordConfirm) next.passwordConfirm = 'Senhas nao coincidem';
    if (!isValidTaxId(taxIdType, taxIdValue)) {
      next.taxId = taxIdType === 'cpf' ? 'CPF invalido' : 'CNPJ invalido';
    }
    if (!termsAccepted) next.terms = 'Voce precisa aceitar os termos de uso';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await api.post('/auth/signup', {
        email,
        password,
        name: name.trim(),
        taxIdType,
        taxIdValue: stripDigits(taxIdValue),
        termsAccepted,
      });
      toast({
        title: 'Conta criada!',
        description: 'Entre com sua senha para comecar a usar o Sentinela.',
      });
      onSignupSuccess(email);
    } catch (err: any) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Erro ao criar conta';
      toast({
        title: 'Erro no cadastro',
        description: Array.isArray(message) ? message.join('\n') : String(message),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const taxIdPlaceholder = taxIdType === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signup-name" className="text-xs uppercase tracking-wider text-muted-foreground">
          Nome completo
        </Label>
        <Input
          id="signup-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome"
          required
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-email" className="text-xs uppercase tracking-wider text-muted-foreground">
          E-mail
        </Label>
        <Input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com"
          required
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Tipo de documento
        </Label>
        <RadioGroup
          value={taxIdType}
          onValueChange={(value) => {
            setTaxIdType(value as TaxIdType);
            setTaxIdValue('');
            setErrors((e) => ({ ...e, taxId: '' }));
          }}
          className="flex gap-6"
        >
          <label className="flex items-center gap-2 cursor-pointer">
            <RadioGroupItem value="cpf" id="tax-cpf" />
            <span className="text-sm">CPF</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <RadioGroupItem value="cnpj" id="tax-cnpj" />
            <span className="text-sm">CNPJ</span>
          </label>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-tax-id" className="text-xs uppercase tracking-wider text-muted-foreground">
          {taxIdType === 'cpf' ? 'CPF' : 'CNPJ'}
        </Label>
        <Input
          id="signup-tax-id"
          type="text"
          inputMode="numeric"
          value={taxIdValue}
          onChange={(e) => setTaxIdValue(formatTaxId(taxIdType, e.target.value))}
          placeholder={taxIdPlaceholder}
          required
        />
        {errors.taxId && <p className="text-xs text-destructive">{errors.taxId}</p>}
      </div>

      <div className="relative space-y-2">
        <Label htmlFor="signup-password" className="text-xs uppercase tracking-wider text-muted-foreground">
          Senha
        </Label>
        <Input
          id="signup-password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimo 8 caracteres"
          required
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-[30px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password-confirm" className="text-xs uppercase tracking-wider text-muted-foreground">
          Confirmar senha
        </Label>
        <Input
          id="signup-password-confirm"
          type={showPassword ? 'text' : 'password'}
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          required
        />
        {errors.passwordConfirm && <p className="text-xs text-destructive">{errors.passwordConfirm}</p>}
      </div>

      <div className="flex items-start gap-2 pt-2">
        <Checkbox
          id="terms"
          checked={termsAccepted}
          onCheckedChange={(value) => setTermsAccepted(value === true)}
        />
        <Label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
          Li e aceito os{' '}
          <a href="/terms" target="_blank" className="text-primary hover:underline">
            termos de uso
          </a>{' '}
          e a{' '}
          <a href="/privacy" target="_blank" className="text-primary hover:underline">
            politica de privacidade
          </a>
          .
        </Label>
      </div>
      {errors.terms && <p className="text-xs text-destructive">{errors.terms}</p>}

      <Button type="submit" className="w-full h-11 text-sm font-medium" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Criar conta
      </Button>
    </form>
  );
}
