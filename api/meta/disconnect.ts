import { protectedRoute } from '../_lib/http.js';
import { db } from '../_lib/supabase.js';

/**
 * DELETE /api/meta/disconnect
 *
 * Apaga a credencial. As contas, campanhas e metricas ficam: o historico ja
 * coletado continua valendo, e reconectar com um token novo reaproveita tudo
 * pelo account_id.
 */
export default protectedRoute(['DELETE'], async () => {
  const { error } = await db().from('meta_credentials').delete().eq('id', true);
  if (error) throw new Error(error.message);
  return { disconnected: true };
});
