import { protectedRoute } from '../_lib/http.js';
import { db } from '../_lib/supabase.js';

/**
 * GET /api/meta/status
 *
 * Estado da conexao + contas descobertas. O access_token nunca sai daqui:
 * a tela so precisa saber se existe, de quem e, e quando expira.
 */
export default protectedRoute(['GET'], async () => {
  const [cred, accounts] = await Promise.all([
    db()
      .from('meta_credentials')
      .select('facebook_user_id, facebook_user_name, token_expires_at, is_valid, last_validated_at, last_error')
      .eq('id', true)
      .maybeSingle(),
    db()
      .from('ad_accounts')
      .select('id, account_id, name, status, currency, is_active, discovered_at')
      .order('name', { ascending: true }),
  ]);

  const expiresAt = cred.data?.token_expires_at ? new Date(cred.data.token_expires_at) : null;

  return {
    connected: Boolean(cred.data?.is_valid),
    facebook_user_name: cred.data?.facebook_user_name ?? null,
    expires_at: cred.data?.token_expires_at ?? null,
    expired: expiresAt ? expiresAt.getTime() < Date.now() : false,
    last_validated_at: cred.data?.last_validated_at ?? null,
    last_error: cred.data?.last_error ?? null,
    accounts: accounts.data ?? [],
  };
});
