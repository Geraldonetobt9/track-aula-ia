import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CircleCheck, CircleDashed, FileJson, RefreshCw, XCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { errorMessage } from '@/lib/utils';
import { useCapiEvents, useCapiSettings } from '@/hooks/useCapi';
import { CapiPayloadDialog } from '@/components/integrations/CapiPayloadDialog';

const EVENTS = ['PageView', 'InitiateCheckout', 'Purchase'] as const;

/**
 * Últimos envios à API de Conversões do Meta, com o payload de cada um. A
 * configuração (pixel, token) fica no MetaCapiCard, em Integrações; sem ela
 * este card não aparece.
 */
export function CapiEventsCard() {
  const { settings } = useCapiSettings();
  const configured = !!settings?.meta_pixel_id && !!settings?.has_capi_token;
  const { data, retry, retrying } = useCapiEvents(configured);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  if (!configured || !data) return null;

  const reenviar = async () => {
    try {
      const r = await retry();
      toast({ title: r.retried ? `${r.sent} de ${r.retried} reenviados` : 'Nada para reenviar' });
    } catch (e) {
      toast({ title: 'Falha ao reenviar', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const failed = data.events.filter((e) => e.status === 'failed').length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Últimos eventos</CardTitle>
          <CardDescription>O que foi enviado à API de Conversões do Meta. Cada envio fica guardado por 10 dias.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={reenviar} disabled={retrying || failed === 0}>
          <RefreshCw className={retrying ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
          Reenviar falhas
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
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

        {data.events.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground/70">Nenhum envio ainda.</p>
        ) : (
          <div className="max-h-[480px] overflow-auto rounded-lg border border-foreground/5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Quando</TableHead>
                  <TableHead>Pixel</TableHead>
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
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground" title={e.error ?? undefined}>
                      {e.pixel_id ?? '—'}
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
      </CardContent>

      <CapiPayloadDialog eventId={openEventId} onClose={() => setOpenEventId(null)} />
    </Card>
  );
}
