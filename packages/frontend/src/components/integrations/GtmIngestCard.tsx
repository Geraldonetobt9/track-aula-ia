import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Check, Copy, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { toast } from '@/hooks/use-toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const INGEST_URL = `${API_URL}/gtm/events`;

/** The token is a workspace secret that changes only on explicit rotation. */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Configuration surface for the sGTM tag: where to POST and which token to send.
 *
 * Rendered only for the operator allowlist, gated by the caller.
 */
export function GtmIngestCard() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ token: string | null }>({
    queryKey: ['gtm-token', activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    staleTime: STALE_TIME_MS,
    queryFn: () => api.get(`/gtm/token?workspace_id=${activeWorkspaceId}`),
  });

  const rotate = useMutation({
    mutationFn: () => api.post<{ token: string }>('/gtm/token', { workspace_id: activeWorkspaceId }),
    onSuccess: (result) => {
      queryClient.setQueryData(['gtm-token', activeWorkspaceId], { token: result.token });
      toast({
        title: 'Token gerado',
        description: 'Atualize a tag no GTM Server com o novo token.',
      });
    },
    onError: () => {
      toast({ title: 'Não foi possível gerar o token', variant: 'destructive' });
    },
  });

  const token = data?.token ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <Activity className="h-4 w-4 text-accent-readable" />
          </div>
          GTM Server
        </CardTitle>
        <p className="text-sm text-muted-foreground/70">
          Envie os eventos do seu container para acompanhá-los ao vivo na aba Eventos.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <CopyableField label="URL de ingestão" value={INGEST_URL} />

        {isLoading ? (
          <Skeleton className="h-16 w-full bg-foreground/5" />
        ) : token ? (
          <CopyableField label="Header X-Sentinela-Token" value={token} secret />
        ) : (
          <div className="rounded-lg border border-dashed border-foreground/10 p-4 text-center">
            <KeyRound className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Nenhum token gerado para esta área</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => rotate.mutate()}
            disabled={!activeWorkspaceId || rotate.isPending}
            className="gap-2"
          >
            <RefreshCw className={rotate.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {token ? 'Gerar novo token' : 'Gerar token'}
          </Button>
          {token && (
            <span className="text-xs text-muted-foreground/60">
              Gerar um novo invalida o atual — a tag para de enviar até ser atualizada.
            </span>
          )}
        </div>

        <div className="rounded-lg border border-foreground/5 bg-foreground/[0.02] p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Como configurar
          </p>
          <ol className="list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground/80">
            <li>No container server-side, crie uma tag do tipo HTTP Request.</li>
            <li>
              Método <span className="text-foreground">POST</span>, URL acima, header{' '}
              <span className="text-foreground">X-Sentinela-Token</span> com o token.
            </li>
            <li>
              No corpo, envie <span className="text-foreground">event_name</span>,{' '}
              <span className="text-foreground">event_id</span>,{' '}
              <span className="text-foreground">event_time</span>,{' '}
              <span className="text-foreground">value</span>,{' '}
              <span className="text-foreground">currency</span>,{' '}
              <span className="text-foreground">page_url</span>,{' '}
              <span className="text-foreground">fbp</span>,{' '}
              <span className="text-foreground">fbc</span> e{' '}
              <span className="text-foreground">fbclid</span>.
            </li>
            <li>
              Use os <span className="text-foreground">mesmos gatilhos da tag da Meta CAPI</span> —
              é o gatilho que define quais eventos chegam aqui.
            </li>
          </ol>
          <p className="mt-3 text-[11px] text-muted-foreground/60">
            Dados pessoais e os cookies em si são descartados na chegada. O{' '}
            <code className="text-muted-foreground/80">_fbp</code> só é guardado como hash, para
            contar visitantes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyableField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code
          className={
            secret
              ? 'flex-1 truncate rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2 font-mono text-xs text-foreground'
              : 'flex-1 truncate rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2 font-mono text-xs text-muted-foreground'
          }
        >
          {value}
        </code>
        <Button variant="outline" size="icon" onClick={copy} aria-label={`Copiar ${label}`}>
          {copied ? <Check className="h-4 w-4 text-accent-readable" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
