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
 * approvedSaleIds: vendas aprovadas gravadas durante este webhook. O Purchase
 *   sai depois do processor terminar, uma vez por pedido — a Hubla grava uma
 *   linha por produto, e o Purchase precisa do valor do pedido inteiro.
 */
export interface WebhookContext {
  trackingRef: string | null;
  approvedSaleIds: string[];
}

export const webhookContext = new AsyncLocalStorage<WebhookContext>();

const TRACKING_REF = /stl_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractTrackingRef(raw: string | null | undefined): string | null {
  const match = raw?.match(TRACKING_REF);
  return match ? match[0].toLowerCase() : null;
}
