import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
    staleTime: 30_000,
  });

  const connect = useMutation({
    mutationFn: (value: string) =>
      api.post<{ facebook_user_name: string; accounts_found: number }>('/meta/connect', {
        token: value,
      }),
    onSuccess: () => {
      setToken('');
      queryClient.invalidateQueries({ queryKey: ['meta-status'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (account: AdAccount) =>
      api.patch('/meta/accounts', { id: account.id, is_active: !account.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meta-status'] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.del('/meta/disconnect'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meta-status'] }),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Integrações</h1>
        <p className="mt-1 text-sm text-muted">
          Conecte sua conta do Meta colando um token de acesso. As contas de anúncio aparecem sozinhas.
        </p>
      </header>

      <section className="card space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">Meta Ads</h2>
            {isLoading ? (
              <p className="mt-1 text-sm text-muted">Carregando…</p>
            ) : data?.connected ? (
              <p className="mt-1 text-sm text-muted">
                Conectado como <span className="text-slate-200">{data.facebook_user_name}</span>
                {data.expires_at && (
                  <>
                    {' · '}
                    <span className={data.expired ? 'text-red-400' : ''}>
                      {data.expired ? 'token expirado' : `expira em ${formatDate(data.expires_at)}`}
                    </span>
                  </>
                )}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">Nenhum token conectado.</p>
            )}
          </div>

          {data?.connected && (
            <button
              className="btn-ghost"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              Desconectar
            </button>
          )}
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) connect.mutate(token.trim());
          }}
        >
          <div>
            <label className="label" htmlFor="token">
              {data?.connected ? 'Substituir token' : 'Token de acesso'}
            </label>
            <textarea
              id="token"
              className="input min-h-[88px] font-mono text-xs"
              placeholder="EAAG..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1.5 text-xs text-muted">
              Gere em developers.facebook.com → Ferramentas → Graph API Explorer, com a permissão{' '}
              <code className="text-slate-300">ads_read</code>. O token é guardado cifrado e nunca
              volta para o navegador.
            </p>
          </div>

          {connect.isError && (
            <p className="text-sm text-red-400">{(connect.error as Error).message}</p>
          )}
          {connect.isSuccess && (
            <p className="text-sm text-emerald-400">
              Conectado. {connect.data.accounts_found} conta(s) de anúncio encontrada(s).
            </p>
          )}

          <button className="btn-primary" disabled={!token.trim() || connect.isPending}>
            {connect.isPending ? 'Validando no Meta…' : 'Conectar'}
          </button>
        </form>
      </section>

      {data?.connected && (
        <section className="card">
          <h2 className="font-medium">Contas de anúncio</h2>
          <p className="mt-1 text-sm text-muted">
            Marque as contas que o dashboard deve sincronizar.
          </p>

          {data.accounts.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              Nenhuma conta encontrada para este token. Confira se ele tem acesso ao Business Manager.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {data.accounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{account.name ?? account.account_id}</p>
                    <p className="text-xs text-muted">
                      {account.account_id}
                      {account.currency && ` · ${account.currency}`}
                      {account.status != null && ` · ${ACCOUNT_STATUS[account.status] ?? 'Status ' + account.status}`}
                    </p>
                  </div>
                  <button
                    className={account.is_active ? 'btn-primary' : 'btn-ghost'}
                    onClick={() => toggle.mutate(account)}
                    disabled={toggle.isPending}
                  >
                    {account.is_active ? 'Sincronizando' : 'Ativar'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
