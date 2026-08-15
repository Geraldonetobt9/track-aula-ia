import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useSaveVturbToken } from '@/hooks/useVturb';

interface VturbTokenFormProps {
  /** Rendered inline once a key exists, as a replace-key affordance. */
  compact?: boolean;
  onSaved?: () => void;
}

/**
 * Where the operator pastes their VTurb API key.
 *
 * The key is written straight to the backend, stored encrypted, and never read
 * back — so this input starts empty even when a key is already configured.
 * There is nothing to prefill it with, by design.
 */
export function VturbTokenForm({ compact, onSaved }: VturbTokenFormProps) {
  const [token, setToken] = useState('');
  const save = useSaveVturbToken();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;

    try {
      const result = await save.mutateAsync(token.trim());
      setToken('');
      toast({
        title: 'Chave salva',
        description: `${result.players} vídeo(s) encontrados na conta VTurb.`,
      });
      onSaved?.();
    } catch (error) {
      toast({
        title: 'A chave não funcionou',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const form = (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="Cole aqui a chave da API da VTurb"
        autoComplete="off"
        className="flex-1"
      />
      <Button type="submit" disabled={!token.trim() || save.isPending} className="gap-2 sm:w-auto">
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {compact ? 'Trocar chave' : 'Conectar'}
      </Button>
    </form>
  );

  if (compact) return form;

  return (
    <Card className="border-dashed border-foreground/10">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-7 w-7 text-accent-readable" />
        </div>
        <h2 className="mb-1 text-lg font-semibold text-foreground">Conecte sua conta VTurb</h2>
        <p className="mb-6 max-w-md text-sm text-muted-foreground/70">
          Pegue a chave da API no painel da VTurb e cole abaixo. Ela fica guardada criptografada e
          nunca sai do servidor — todas as consultas passam pelo backend.
        </p>
        <div className="w-full max-w-md">{form}</div>
      </CardContent>
    </Card>
  );
}
