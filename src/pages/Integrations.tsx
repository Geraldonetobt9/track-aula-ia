import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface AdAccount {
  id: string;
  account_id: string;
  name: string | null;
  status: number | null;
  currency: string | null;
  is_active: boolean;
}

interface MetaStatus {
  connected: boolean;
  facebook_user_name: string | null;
  expires_at: string | null;
  expired: boolean;
  last_error: string | null;
  accounts: AdAccount[];
}

const ACCOUNT_STATUS: Record<number, string> = {
  1: 'Ativa',
  2: 'Desativada',
  3: 'Antecipada',
  7: 'Em revisão',
  9: 'Período de graça',
  101: 'Fechada',
};

export function Integrations() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['meta-status'],
    queryFn: () => api.get<MetaStatus>('/meta/status'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['meta-status'] });

  const connect = useMutation({
    mutationFn: (value: string) =>
      api.post<{ facebook_user_name: string; accounts_found: number }>('/meta/connect', {
        token: value,
      }),
    onSuccess: () => {
      setToken('');
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: (account: AdAccount) =>
      api.patch('/meta/accounts', { id: account.id, is_active: !account.is_active }),
    onSuccess: invalidate,
  });

  const disconnect = useMutation({
    mutationFn: () => api.del('/meta/disconnect'),
    onSuccess: invalidate,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte sua conta do Meta colando um token de acesso. As contas de anúncio aparecem
          sozinhas.
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Meta Ads</CardTitle>
            <CardDescription className="mt-1">
              {isLoading ? (
                'Carregando…'
              ) : data?.connected ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    Conectado como{' '}
                    <span className="text-foreground">{data.facebook_user_name}</span>
                  </span>
                  {data.expires_at && (
                    <Badge variant={data.expired ? 'destructive' : 'secondary'}>
                      {data.expired ? 'token expirado' : `expira ${formatDate(data.expires_at)}`}
                    </Badge>
                  )}
                </span>
              ) : (
                'Nenhum token conectado.'
              )}
            </CardDescription>
          </div>

          {data?.connected && (
            <Button variant="outline" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              Desconectar
            </Button>
          )}
        </CardHeader>

        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim()) connect.mutate(token.trim());
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="token">{data?.connected ? 'Substituir token' : 'Token de acesso'}</Label>
              <Textarea
                id="token"
                className="min-h-[88px] font-mono text-xs"
                placeholder="EAAG..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Gere em developers.facebook.com → Ferramentas → Graph API Explorer, com a permissão{' '}
                <code className="text-foreground">ads_read</code>. O token é guardado cifrado e nunca
                volta para o navegador.
              </p>
            </div>

            {connect.isError && (
              <Alert variant="destructive">
                <AlertDescription>{(connect.error as Error).message}</AlertDescription>
              </Alert>
            )}
            {connect.isSuccess && (
              <Alert>
                <AlertDescription>
                  Conectado. {connect.data.accounts_found} conta(s) de anúncio encontrada(s).
                </AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={!token.trim() || connect.isPending}>
              {connect.isPending ? 'Validando no Meta…' : 'Conectar'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {data?.connected && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Contas de anúncio</CardTitle>
            <CardDescription>Escolha quais contas o dashboard deve sincronizar.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : data.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma conta encontrada para este token. Confira se ele tem acesso ao Business
                Manager.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.accounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{account.name ?? account.account_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {account.account_id}
                        {account.currency && ` · ${account.currency}`}
                        {account.status != null &&
                          ` · ${ACCOUNT_STATUS[account.status] ?? `Status ${account.status}`}`}
                      </p>
                    </div>
                    <Switch
                      checked={account.is_active}
                      onCheckedChange={() => toggle.mutate(account)}
                      disabled={toggle.isPending}
                      aria-label={`Sincronizar ${account.name ?? account.account_id}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
