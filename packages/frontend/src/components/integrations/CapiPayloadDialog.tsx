import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useCapiEvent } from '@/hooks/useCapi';

interface Props {
  eventId: string | null;
  onClose: () => void;
}

/** O que foi mandado ao Meta num envio, e o que ele respondeu. */
export function CapiPayloadDialog({ eventId, onClose }: Props) {
  const { event, loading, error } = useCapiEvent(eventId);

  return (
    <Dialog open={!!eventId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
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
          <div className="space-y-4">
            <JsonBlock
              title="Payload enviado"
              hint="Dados pessoais já vão em SHA-256, como o Meta exige. O token de acesso não aparece aqui."
              value={event.request}
            />
            {event.response != null ? (
              <JsonBlock title="Resposta do Meta" value={event.response} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {event.status === 'pending' ? 'Ainda sem resposta do Meta.' : event.error ?? 'Sem resposta registrada.'}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
    <div className="space-y-1.5">
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
