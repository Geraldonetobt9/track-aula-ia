import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CircleCheck, CircleDashed, Send } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { errorMessage } from '@/lib/utils';
import { useCapiSettings } from '@/hooks/useCapi';

/**
 * API de Conversões do Meta: o que antes eram as tags do Facebook nos
 * containers do sGTM. PageView e InitiateCheckout saem do snippet; Purchase,
 * do webhook da venda. Os envios ficam na página Eventos (CapiEventsCard).
 */
export function MetaCapiCard() {
  const { settings, save, saving } = useCapiSettings();
  const configured = !!settings?.meta_pixel_id && !!settings?.has_capi_token;

  const [pixel, setPixel] = useState('');
  const [token, setToken] = useState('');
  const [testCode, setTestCode] = useState('');

  useEffect(() => {
    setPixel(settings?.meta_pixel_id ?? '');
    setTestCode(settings?.meta_test_event_code ?? '');
  }, [settings?.meta_pixel_id, settings?.meta_test_event_code]);

  if (!settings) return null;

  const salvar = async () => {
    try {
      await save({
        meta_pixel_id: pixel.trim(),
        meta_test_event_code: testCode.trim(),
        // Campo vazio mantém o token salvo; só troca quando algo é digitado.
        ...(token.trim() ? { meta_capi_token: token.trim() } : {}),
      });
      setToken('');
      toast({ title: 'API de Conversões salva' });
    } catch (e) {
      toast({ title: 'Não foi possível salvar', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const removerToken = async () => {
    try {
      await save({ meta_capi_token: '' });
    } catch (e) {
      toast({ title: 'Não foi possível remover', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const changed =
    pixel.trim() !== (settings.meta_pixel_id ?? '') ||
    testCode.trim() !== (settings.meta_test_event_code ?? '') ||
    !!token.trim();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-accent-readable" strokeWidth={1.5} />
            <CardTitle>API de Conversões do Meta</CardTitle>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs">
            {configured ? (
              <>
                <CircleCheck className="h-3.5 w-3.5 text-green-500" aria-hidden />
                <span className="text-foreground">Enviando</span>
              </>
            ) : (
              <>
                <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">Desligada</span>
              </>
            )}
          </span>
        </div>
        <CardDescription>
          PageView e InitiateCheckout saem da página; Purchase sai quando o webhook da venda chega, com os dados do
          comprador e da visita que o trouxe.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="capi-pixel" className="text-xs">ID do pixel</Label>
            <Input id="capi-pixel" inputMode="numeric" placeholder="123456789012345" value={pixel} onChange={(e) => setPixel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="capi-token" className="text-xs">Token de acesso</Label>
            <Input
              id="capi-token"
              type="password"
              autoComplete="off"
              placeholder={settings.has_capi_token ? '•••••••• salvo — digite para trocar' : 'EAAB...'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="capi-test" className="text-xs">Código de teste (opcional)</Label>
            <Input id="capi-test" placeholder="TEST12345" value={testCode} onChange={(e) => setTestCode(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={salvar} disabled={saving || !changed}>Salvar</Button>
            {settings.has_capi_token && (
              <Button variant="ghost" onClick={removerToken} disabled={saving}>Remover token</Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground/70">
          O token sai do Gerenciador de Eventos → pixel → Configurações → API de Conversões → Gerar token de acesso.
          Com o código de teste preenchido, os eventos aparecem em "Eventos de teste" e não contam nas campanhas —
          apague o código depois de conferir.
        </p>

        <div className="space-y-0.5 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-3">
          <p className="text-sm text-foreground">Pixel do Meta na página</p>
          <p className="text-xs text-muted-foreground">
            Com o ID do pixel salvo, o snippet carrega o pixel sozinho e dispara PageView e InitiateCheckout no navegador
            com o mesmo ID de evento da API de Conversões — o Meta deduplica pelo ID e conta uma vez. Não cole o código
            do pixel na página: se ele já estiver lá, tire, senão o PageView da página conta duas vezes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
