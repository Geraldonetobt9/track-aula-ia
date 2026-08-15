import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente com service_role. Ignora RLS por completo, então SÓ pode ser usado
 * aqui dentro de /api — nunca importado por nada em /src.
 *
 * Singleton de propósito: cada instância abre seu próprio pool, e criar uma por
 * request derruba o banco sob carga.
 */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}
