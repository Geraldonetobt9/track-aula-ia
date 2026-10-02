import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CircleAlert, CircleCheck, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useCapiEvent, type CapiUserDataField } from '@/hooks/useCapi';

interface Props {
  eventId: string | null;
  onClose: () => void;
}

/**
 * Um envio à CAPI: o que saiu para o Meta, os dados de origem de cada campo
 * (só para leitura aqui — ao Meta só vai o hash) e, no Purchase, o webhook
 * que chegou e as linhas do banco que o montaram.
 */
export function CapiPayloadDialog({ eventId, onClose }: Props) {
  const { event, loading, error } = useCapiEvent(eventId);
  const isPurchase = event?.event_name === 'Purchase';

  return (
    <Dialog open={!!eventId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{event ? `${event.event_name} enviado ao Facebook` : 'Envio ao Facebook'}</DialogTitle>
          <DialogDescription>
            {event
              ? `${format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })} · ${event.attempts} tentativa(s) · ID do evento ${event.event_id}`
              : 'Corpo da requisição à API de Conversões.'}
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
        {error && <p className="py-6 text-center text-sm text-red-500">{error}</p>}

        {event && (
          <Tabs defaultValue="dados" className="min-w-0">
            <TabsList className="flex h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="dados">Dados</TabsTrigger>
              <TabsTrigger value="enviado">Enviado ao Meta</TabsTrigger>
              {isPurchase && <TabsTrigger value="webhook">Webhook</TabsTrigger>}
              {isPurchase && <TabsTrigger value="banco">Banco de dados</TabsTrigger>}
            </TabsList>

            <TabsContent value="dados" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Cada campo com o dado original, o valor normalizado e o hash SHA-256 que foi para o Meta. Os originais
                aparecem só aqui: ao Meta vão apenas os hashes (IP, navegador, fbp e fbc vão em claro, como o Meta
                exige).
              </p>
              <UserDataTable rows={event.original} />
            </TabsContent>

            <TabsContent value="enviado" className="space-y-4">
              <JsonBlock
                title="Payload enviado"
                hint="Exatamente o corpo mandado à API de Conversões. O token de acesso não aparece aqui."
                value={event.request}
              />
              {event.response != null ? (
                <JsonBlock title="Resposta do Meta" value={event.response} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {event.status === 'pending' ? 'Ainda sem resposta do Meta.' : event.error ?? 'Sem resposta registrada.'}
                </p>
              )}
            </TabsContent>

            {isPurchase && (
              <TabsContent value="webhook">
                {event.webhook != null ? (
                  <JsonBlock
                    title="Corpo do webhook"
                    hint="Como a plataforma de checkout mandou. Tokens e segredos foram removidos."
                    value={event.webhook}
                  />
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    Esta venda foi gravada antes de o painel guardar o corpo do webhook. As próximas vendas já aparecem
                    aqui.
                  </p>
                )}
              </TabsContent>
            )}

            {isPurchase && (
              <TabsContent value="banco" className="space-y-4">
                {event.database?.sales.length ? (
                  <JsonBlock
                    title={event.database.sales.length > 1 ? `Vendas do pedido (${event.database.sales.length})` : 'Venda'}
                    hint="Linhas da tabela sales que formaram este Purchase."
                    value={event.database.sales.length > 1 ? event.database.sales : event.database.sales[0]}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">A venda deste envio não está mais no banco.</p>
                )}
                {event.database?.session ? (
                  <JsonBlock
                    title="Visita casada"
                    hint="A sessão de rastreio ligada à venda pelo indexador: de onde vêm IP, navegador, fbp e fbc."
                    value={event.database.session}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma visita casada com esta venda — o Purchase foi só com os dados do comprador.
                  </p>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UserDataTable({ rows }: { rows: CapiUserDataField[] }) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">Nenhum dado de usuário neste envio.</p>;
  }
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r) => (
        <div key={r.key} className="grid gap-1 px-3 py-2.5 text-xs sm:grid-cols-[140px_1fr]">
          <div className="flex items-start gap-1.5">
            {r.matches ? (
              <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0 text-green-500" aria-label="Confere com o enviado" />
            ) : (
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Não confere com o enviado" />
            )}
            <div>
              <p className="font-medium text-foreground">{r.label}</p>
              <code className="font-mono text-[11px] text-muted-foreground">{r.key}</code>
            </div>
          </div>
          <dl className="min-w-0 space-y-1">
            <Field label="Original" value={r.original} />
            {r.hashed && <Field label="Normalizado" value={r.normalized} />}
            <Field label={r.hashed ? 'Hash enviado' : 'Enviado'} value={r.sent} mono />
            {!r.matches && (
              <p className="text-amber-600 dark:text-amber-400">
                {r.sent
                  ? 'O dado de hoje não gera mais o que foi enviado: a origem mudou depois do envio.'
                  : 'Não foi enviado.'}
              </p>
            )}
          </dl>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-foreground ${mono ? 'font-mono text-[11px]' : ''}`}>{value ?? '—'}</dd>
    </div>
  );
}

function JsonBlock({ title, hint, value }: { title: string; hint?: string; value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copiado' });
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
        <Button variant="ghost" size="sm" onClick={copiar}>
          <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      <pre className="max-h-96 overflow-auto rounded-lg border border-foreground/5 bg-foreground/[0.03] p-3 font-mono text-xs leading-relaxed text-foreground">
        {text}
      </pre>
    </div>
  );
}
