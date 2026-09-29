import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CircleCheck, CircleDashed, FileJson, RefreshCw, Send, XCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { errorMessage } from '@/lib/utils';
import { useCapiEvents, useCapiSettings } from '@/hooks/useCapi';
import { CapiPayloadDialog } from './CapiPayloadDialog';

const EVENTS = ['PageView', 'InitiateCheckout', 'Purchase'] as const;

/**
 * API de Conversões do Meta: o que antes eram as tags do Facebook nos
 * containers do sGTM. PageView e InitiateCheckout saem do snippet; Purchase,
 * do webhook da venda.
 */
export function MetaCapiCard() {
  const { settings, save, saving } = useCapiSettings();
  const configured = !!settings?.meta_pixel_id && !!settings?.has_capi_token;
  const { data, retry, retrying } = useCapiEvents(configured);

  const [pixel, setPixel] = useState('');
  const [token, setToken] = useState('');
  const [testCode, setTestCode] = useState('');
  const [openEventId, setOpenEventId] = useState<string | null>(null);

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

  const alternarEspelho = async (on: boolean) => {
    try {
      await save({ meta_mirror_browser: on });
    } catch (e) {
      toast({ title: 'Não foi possível salvar', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const reenviar = async () => {
    try {
      const r = await retry();
      toast({ title: r.retried ? `${r.sent} de ${r.retried} reenviados` : 'Nada para reenviar' });
    } catch (e) {
      toast({ title: 'Falha ao reenviar', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const changed =
    pixel.trim() !== (settings.meta_pixel_id ?? '') ||
    testCode.trim() !== (settings.meta_test_event_code ?? '') ||
    !!token.trim();
  const failed = data?.events.filter((e) => e.status === 'failed').length ?? 0;

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

        <div className="flex items-start justify-between gap-4 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="capi-mirror" className="text-sm">Disparar também o pixel do navegador</Label>
            <p className="text-xs text-muted-foreground">
              O snippet chama <code className="font-mono">fbq</code> com o mesmo ID de evento, e o Meta junta os dois.
              Ligue só se o pixel estiver na página, e tire do código base do pixel a linha{' '}
              <code className="font-mono">fbq('track', 'PageView')</code> — senão o PageView do navegador conta duas vezes.
            </p>
          </div>
          <Switch
            id="capi-mirror"
            checked={settings.meta_mirror_browser}
            onCheckedChange={alternarEspelho}
            disabled={saving}
          />
        </div>

        {configured && data && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {EVENTS.map((name) => {
                const s = data.summary[name] ?? { sent: 0, failed: 0 };
                return (
                  <div key={name} className="rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-2">
                    <p className="text-xs text-muted-foreground">{name} · 24h</p>
                    <p className="text-sm font-medium tabular-nums text-foreground">
                      {s.sent.toLocaleString('pt-BR')}
                      {s.failed > 0 && <span className="ml-2 text-xs font-normal text-red-500">{s.failed} com erro</span>}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Últimos envios</p>
              <Button variant="outline" size="sm" onClick={reenviar} disabled={retrying || failed === 0}>
                <RefreshCw className={retrying ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
                Reenviar falhas
              </Button>
            </div>

            {data.events.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground/70">Nenhum envio ainda.</p>
            ) : (
              <div className="max-h-80 overflow-auto rounded-lg border border-foreground/5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Evento</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Quando</TableHead>
                      <TableHead>Detalhe</TableHead>
                      <TableHead className="w-0"><span className="sr-only">Payload</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.event_name}</TableCell>
                        <TableCell>
                          {e.status === 'sent' ? (
                            <Badge variant="outline" className="gap-1 border-green-500/30 text-foreground">
                              <CircleCheck className="h-3 w-3 text-green-500" aria-hidden /> Enviado
                            </Badge>
                          ) : e.status === 'failed' ? (
                            <Badge variant="outline" className="gap-1 border-red-500/30 text-foreground">
                              <XCircle className="h-3 w-3 text-red-500" aria-hidden /> Erro
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-muted-foreground">
                              <CircleDashed className="h-3 w-3" aria-hidden /> Pendente
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={e.error ?? e.fbtrace_id ?? ''}>
                          {e.error ?? (e.event_name === 'Purchase' ? e.event_id.replace(/^purchase:/, 'pedido ') : e.fbtrace_id ?? '')}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpenEventId(e.id)}>
                            <FileJson className="mr-1 h-3.5 w-3.5" /> Payload
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <CapiPayloadDialog eventId={openEventId} onClose={() => setOpenEventId(null)} />
    </Card>
  );
}
