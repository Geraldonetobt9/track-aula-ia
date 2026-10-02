import { AsyncLocalStorage } from 'async_hooks';

/**
 * O que um webhook de venda carrega de uma ponta à outra do processamento,
 * sem passar parâmetro pelos 16 processors.
 *
 * trackingRef: o indexador stl_<sessão> que o snippet escreveu no link do
 *   checkout. Cada plataforma o devolve num caminho diferente
 *   (data.purchase.origin.sck, TrackingParameters.sck, saleMetas[xcod],
 *   data.tracker.code1...). Em vez de um mapa por plataforma, o corpo cru é
 *   varrido pelo formato do indexador: vale para qualquer plataforma, qualquer
 *   parâmetro e qualquer caminho, inclusive as que ainda vão ganhar processor.
 *
 * body: o corpo do webhook como chegou. Vai para o metadata da venda
 *   (webhook_body), sem tokens, para a tela de detalhe do Purchase.
 *
 * approvedSaleIds: vendas aprovadas gravadas durante este webhook. O Purchase
 *   sai depois do processor terminar, uma vez por pedido — a Hubla grava uma
 *   linha por produto, e o Purchase precisa do valor do pedido inteiro.
 */
export interface WebhookContext {
  trackingRef: string | null;
  body?: unknown;
  approvedSaleIds: string[];
}

export const webhookContext = new AsyncLocalStorage<WebhookContext>();

const TRACKING_REF = /stl_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractTrackingRef(raw: string | null | undefined): string | null {
  const match = raw?.match(TRACKING_REF);
  return match ? match[0].toLowerCase() : null;
}

const SECRET_KEY = /token|hottok|secret|signature|password|senha|api[_-]?key|authorization/i;

/**
 * O corpo do webhook sem o que autentica: algumas plataformas mandam o token
 * no próprio corpo. Cópia, nunca altera o original.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[removido]' : redactSecrets(v, depth + 1);
  }
  return out;
}
