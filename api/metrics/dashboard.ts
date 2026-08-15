import { protectedRoute } from '../_lib/http.js';
import { db } from '../_lib/supabase.js';

/**
 * GET /api/metrics/dashboard?from=&to=
 *
 * Uma chamada devolve tudo que a tela inicial precisa. A agregacao roda no
 * Postgres (RPC dashboard_metrics) porque somar dezenas de milhares de vendas
 * la e mais rapido do que trazer as linhas, e porque o PostgREST corta em 1000
 * linhas por padrao — somar no Node dava numero errado em silencio.
 */
export default protectedRoute(['GET'], async (req) => {
  const { from, to } = req.query as { from?: string; to?: string };

  const { data, error } = await db().rpc('dashboard_metrics', {
    p_from: from ?? null,
    p_to: to ?? null,
    p_checkout_ids: null,
    p_product_names: null,
  });

  if (error) throw new Error(error.message);

  const m = (data ?? {}) as Record<string, unknown>;
  const gross = Number(m.gross_revenue ?? 0);
  const spend = Number(m.ad_spend ?? 0);

  return {
    ...m,
    // Derivados ficam aqui, nao no banco: sao baratos e mudam de definicao
    // com mais frequencia do que o schema.
    profit: gross - spend,
    roas: spend > 0 ? gross / spend : 0,
  };
});
