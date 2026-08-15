import { publicRoute } from './_lib/http.js';
import { db } from './_lib/supabase.js';

/** GET /api/health — checagem leve, inclusive do banco. */
export default publicRoute(['GET'], async () => {
  const { error } = await db().from('app_settings').select('id').limit(1);
  return { status: error ? 'degraded' : 'ok', database: error ? 'erro' : 'ok' };
});
