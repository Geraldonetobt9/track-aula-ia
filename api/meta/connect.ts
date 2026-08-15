import { protectedRoute, badRequest } from '../_lib/http.js';
import { db } from '../_lib/supabase.js';
import { encrypt } from '../_lib/crypto.js';
import { inspectToken, listAdAccounts } from '../_lib/meta.js';

/**
 * POST /api/meta/connect  { token }
 *
 * Conectar = colar o token. Este endpoint faz o resto:
 *   1. valida o token no Meta e descobre de quem ele é
 *   2. guarda cifrado
 *   3. descobre as contas de anúncio e grava
 *
 * Substitui todo o fluxo de OAuth do sistema antigo (authorize, callback,
 * troca de code, troca por token longo, state assinado contra CSRF).
 */
export default protectedRoute(['POST'], async (req) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

  if (!token) throw badRequest('Cole o token de acesso do Meta.');
  if (token.length < 50) throw badRequest('Esse token parece incompleto. Copie o valor inteiro.');

  // Falha aqui = token ruim, e nada foi gravado.
  const info = await inspectToken(token);
  const accounts = await listAdAccounts(token);

  const { error: credError } = await db()
    .from('meta_credentials')
    .upsert(
      {
        id: true,
        access_token: encrypt(token),
        facebook_user_id: info.user.id,
        facebook_user_name: info.user.name,
        token_expires_at: info.expiresAt?.toISOString() ?? null,
        scopes: info.scopes,
        is_valid: true,
        last_validated_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: 'id' },
    );

  if (credError) throw new Error(`Falha ao salvar credencial: ${credError.message}`);

  if (accounts.length > 0) {
    // is_active fica fora do payload de propósito: em conta que já existe, a
    // escolha do cliente sobre sincronizar ou não é preservada; em conta nova,
    // vale o default false do banco.
    const { error: accError } = await db()
      .from('ad_accounts')
      .upsert(
        accounts.map((a) => ({
          account_id: a.account_id,
          name: a.name,
          status: a.status,
          currency: a.currency,
          timezone_name: a.timezone_name,
          business_name: a.business_name,
          discovered_at: new Date().toISOString(),
        })),
        { onConflict: 'account_id' },
      );

    if (accError) throw new Error(`Falha ao salvar contas: ${accError.message}`);
  }

  return {
    facebook_user_name: info.user.name,
    expires_at: info.expiresAt?.toISOString() ?? null,
    accounts_found: accounts.length,
  };
});
