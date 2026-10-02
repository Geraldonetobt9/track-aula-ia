import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Copy } from 'lucide-react';
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
 * Um envio à CAPI: os dados de origem de cada campo (só para leitura aqui —
 * ao Meta só vai o hash), marcando os que vieram do banco, e o que saiu para
 * o Meta com a resposta.
 */
export function CapiPayloadDialog({ eventId, onClose }: Props) {
  const { event, loading, error } = useCapiEvent(eventId);

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
        <div key={r.key} className="grid gap-1 px-3 py-2.5 text-xs sm:grid-cols-[170px_1fr]">
          <div>
            <div>
              <p className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                {r.label}
                {r.fromDatabase && (
                  <span className="rounded border border-border px-1.5 py-px text-[10px] font-normal text-muted-foreground">
                    Banco de dados
                  </span>
                )}
              </p>
              <code className="font-mono text-[11px] text-muted-foreground">{r.key}</code>
            </div>
          </div>
          <dl className="min-w-0 space-y-1">
            <Field label="Original" value={r.original} />
            {r.hashed && <Field label="Normalizado" value={r.normalized} />}
            <Field label={r.hashed ? 'Hash enviado' : 'Enviado'} value={r.sent} mono />
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
