/**
 * Em que parâmetro da URL cada checkout aceita o indexador — e o devolve no
 * webhook. Tirado dos containers do sGTM (pasta Containers/), um por
 * plataforma; Hubla e Monetizze, que não têm container, pelos payloads de
 * docs/webhook-payloads.
 *
 * `sales`: o painel já tem processor para o webhook dessa plataforma. Sem
 * ele, PageView e InitiateCheckout funcionam, mas a venda não é gravada e o
 * Purchase não sai. Hoje todas têm: as nove que só existiam nos containers
 * usam o processor genérico do backend (webhooks/processors/generic).
 */
export type TrackingParam = 'sck' | 'src' | 'xcod' | 'trk' | 'utm_term';

export interface TrackingPlatform {
  id: string;
  name: string;
  param: TrackingParam;
  sales: boolean;
}

export const TRACKING_PLATFORMS: TrackingPlatform[] = [
  { id: 'hotmart', name: 'Hotmart', param: 'sck', sales: true },
  { id: 'kiwify', name: 'Kiwify', param: 'sck', sales: true },
  { id: 'cakto', name: 'Cakto', param: 'sck', sales: true },
  { id: 'ggcheckout', name: 'GGCheckout', param: 'sck', sales: true },
  { id: 'ticto', name: 'Ticto', param: 'sck', sales: true },
  { id: 'mundpay', name: 'Mundpay', param: 'sck', sales: true },
  { id: 'perfectpay', name: 'PerfectPay', param: 'sck', sales: true },
  { id: 'lastlink', name: 'Lastlink', param: 'sck', sales: true },
  { id: 'cartpanda', name: 'CartPanda', param: 'sck', sales: true },
  { id: 'guru', name: 'Guru', param: 'sck', sales: true },
  { id: 'kirvano', name: 'Kirvano', param: 'src', sales: true },
  { id: 'payt', name: 'Payt', param: 'src', sales: true },
  { id: 'monetizze', name: 'Monetizze', param: 'src', sales: true },
  { id: 'greenn', name: 'Greenn', param: 'xcod', sales: true },
  { id: 'eduzz', name: 'Eduzz', param: 'trk', sales: true },
  { id: 'hubla', name: 'Hubla', param: 'utm_term', sales: true },
  { id: 'wiven', name: 'Wiven', param: 'sck', sales: true },
  { id: 'frendz', name: 'Frendz', param: 'src', sales: true },
  { id: 'herospark', name: 'Herospark', param: 'src', sales: true },
  { id: 'kavoo', name: 'Kavoo', param: 'src', sales: true },
  { id: 'pagtrust', name: 'PagTrust', param: 'xcod', sales: true },
  { id: 'assiny', name: 'Assiny', param: 'xcod', sales: true },
  { id: 'yampi', name: 'Yampi', param: 'utm_term', sales: true },
  { id: 'wiapy', name: 'Wiapy', param: 'utm_term', sales: true },
  { id: 'doppus', name: 'Doppus', param: 'utm_term', sales: true },
];

export function findTrackingPlatform(id: string | null | undefined): TrackingPlatform | null {
  return TRACKING_PLATFORMS.find((p) => p.id === id) ?? null;
}
