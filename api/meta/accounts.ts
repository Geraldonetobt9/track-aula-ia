import { protectedRoute, badRequest } from '../_lib/http.js';
import { db } from '../_lib/supabase.js';

/**
 * PATCH /api/meta/accounts  { id, is_active }
 *
 * Escolhe quais contas o dashboard sincroniza. Nem toda conta que o token
 * enxerga interessa, e sincronizar todas gastaria quota da API a toa.
 */
export default protectedRoute(['PATCH'], async (req) => {
  const { id, is_active: isActive } = req.body ?? {};

  if (typeof id !== 'string' || !id) throw badRequest('id da conta é obrigatório');
  if (typeof isActive !== 'boolean') throw badRequest('is_active deve ser true ou false');

  const { data, error } = await db()
    .from('ad_accounts')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id, account_id, is_active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw badRequest('Conta de anúncio não encontrada');

  return data;
});
