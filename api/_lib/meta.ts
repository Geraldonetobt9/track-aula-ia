import { HttpError } from './http.js';

const API_VERSION = process.env.META_API_VERSION || 'v22.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Permissões sem as quais o dashboard não funciona. */
const REQUIRED_SCOPES = ['ads_read'];

export interface MetaUser {
  id: string;
  name: string;
}

export interface MetaAdAccount {
  account_id: string;
  name: string | null;
  status: number | null;
  currency: string | null;
  timezone_name: string | null;
  business_name: string | null;
}

export interface TokenInfo {
  user: MetaUser;
  scopes: string[];
  expiresAt: Date | null;
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // O token vai no header, não na query: query string entra em log de servidor
  // e em histórico de proxy.
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();

  if (!response.ok) {
    const message = body?.error?.message ?? 'Erro desconhecido na API do Meta';
    // 190 = token inválido/expirado; 200/10 = falta permissão.
    const code = body?.error?.code;
    if (code === 190) throw new HttpError(400, 'Token inválido ou expirado. Gere um novo no Meta.');
    if (code === 200 || code === 10) {
      throw new HttpError(400, `O token não tem a permissão necessária: ${message}`);
    }
    throw new HttpError(502, `Meta: ${message}`);
  }

  return body as T;
}

/**
 * Valida o token colado pelo cliente e devolve quem é o dono, o que ele pode
 * fazer e quando expira.
 *
 * Usa /debug_token com o próprio token como inspecionador. Isso funciona sem
 * app secret e é o que permite dispensar o APP_ID/APP_SECRET do modelo antigo.
 */
interface DebugTokenData {
  scopes?: string[];
  expires_at?: number;
  is_valid?: boolean;
}

export async function inspectToken(token: string): Promise<TokenInfo> {
  const [user, debug] = await Promise.all([
    graph<MetaUser>('me', token, { fields: 'id,name' }),
    // debug_token pode ser recusado dependendo do tipo de token. Não é fatal:
    // sem ele apenas não sabemos escopos e validade, e o /me já provou que o
    // token funciona.
    graph<{ data: DebugTokenData }>('debug_token', token, { input_token: token }).catch(
      () => ({ data: {} as DebugTokenData }),
    ),
  ]);

  const info = debug.data ?? {};
  const scopes = info.scopes ?? [];

  const missing = REQUIRED_SCOPES.filter((s) => scopes.length > 0 && !scopes.includes(s));
  if (missing.length > 0) {
    throw new HttpError(400, `O token precisa da permissão ${missing.join(', ')}.`);
  }

  // expires_at = 0 significa token sem expiração (System User token).
  const expiresAt = info.expires_at ? new Date(info.expires_at * 1000) : null;

  return { user, scopes, expiresAt };
}

/**
 * Descobre todas as contas de anúncio que o token enxerga.
 *
 * É isto que substitui o OAuth: o cliente cola o token, e as contas aparecem
 * sozinhas. Pagina até o fim — quem tem BM grande passa de 25 contas, o padrão
 * de página do Graph.
 */
export async function listAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const accounts: MetaAdAccount[] = [];
  const fields = 'account_id,name,account_status,currency,timezone_name,business';

  let path = 'me/adaccounts';
  let params: Record<string, string> = { fields, limit: '100' };

  // Limite de segurança: 20 páginas x 100 = 2000 contas. Sem isso, um cursor
  // que não avança viraria laço infinito dentro da função serverless.
  for (let page = 0; page < 20; page++) {
    const res = await graph<{
      data: Array<Record<string, unknown>>;
      paging?: { next?: string; cursors?: { after?: string } };
    }>(path, token, params);

    for (const raw of res.data ?? []) {
      accounts.push({
        account_id: String(raw.account_id ?? '').startsWith('act_')
          ? String(raw.account_id)
          : `act_${raw.account_id}`,
        name: (raw.name as string) ?? null,
        status: typeof raw.account_status === 'number' ? raw.account_status : null,
        currency: (raw.currency as string) ?? null,
        timezone_name: (raw.timezone_name as string) ?? null,
        business_name: ((raw.business as { name?: string })?.name) ?? null,
      });
    }

    const after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
    path = 'me/adaccounts';
    params = { fields, limit: '100', after };
  }

  return accounts;
}
