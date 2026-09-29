import { parseXcod } from '../hotmart-tracking.util';
import { CheckoutSpec, MoneyPath } from './checkout-specs';

/**
 * Leitura pura de um webhook pela especificação da plataforma: sem banco,
 * sem Nest. O GenericCheckoutProcessor decide o que gravar a partir daqui.
 */

export type Decision = 'approved' | 'refunded' | 'ignored';

export interface ParsedCheckout {
  decision: Decision;
  /** Por que foi aprovado/ignorado — vai para o log e para a resposta. */
  reason: string;
  event: string | null;
  status: string | null;
  externalId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerDoc: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  grossAmount: number | null;
  commissionAmount: number | null;
  currency: string;
  productName: string | null;
  productId: string | null;
  paymentMethod: string | null;
  soldAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  indexer: string | null;
}

const APPROVED_STATUS = /^(paid|approved|aprovad[oa]|pag[oa]|completed?|confirmed|confirmad[oa]|success|succeeded|authorized|autorizad[oa]|finalizad[oa]|concluid[oa])$/i;
const REFUND_STATUS = /(refund|reembols|estorn|chargeback|charged_?back|devolvid|disput)/i;

/** Valor num caminho com pontos; números indexam listas. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function first(obj: unknown, paths: string[] | undefined): unknown {
  for (const p of paths ?? []) {
    const v = getPath(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function str(obj: unknown, paths: string[] | undefined, max = 500): string | null {
  const v = first(obj, paths);
  if (v === undefined) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Número de um valor monetário: 97, "97.00", "97,00", "1.234,56".
 * Em centavos, divide por 100 — como o regex (\d+)(\d{2})$ dos containers.
 */
export function parseMoney(value: unknown, cents: boolean): number | null {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    let s = value.replace(/[^\d.,-]/g, '');
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) {
      // O separador que vem por último é o decimal.
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    n = Number(s);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  return Math.round((cents ? n / 100 : n) * 100) / 100;
}

function money(obj: unknown, spec: MoneyPath | undefined): number | null {
  if (!spec) return null;
  const v = first(obj, spec.paths);
  return v === undefined ? null : parseMoney(v, spec.cents);
}

function decide(spec: CheckoutSpec, event: string | null, status: string | null): { decision: Decision; reason: string } {
  const ev = event?.toLowerCase() ?? null;
  const is = (list: string[]) => !!ev && list.some((e) => e.toLowerCase() === ev);

  if (is(spec.approvedEvents)) return { decision: 'approved', reason: `evento ${event}` };
  if (is(spec.refundEvents)) return { decision: 'refunded', reason: `evento ${event}` };

  if (status) {
    if (APPROVED_STATUS.test(status)) return { decision: 'approved', reason: `status ${status}` };
    if (REFUND_STATUS.test(status)) return { decision: 'refunded', reason: `status ${status}` };
    return { decision: 'ignored', reason: `status "${status}" nao e venda aprovada` };
  }

  // Evento que não está em lista nenhuma, numa plataforma que filtra por evento.
  if (ev && spec.approvedEvents.length > 0) {
    if (REFUND_STATUS.test(ev)) return { decision: 'refunded', reason: `evento ${event}` };
    return { decision: 'ignored', reason: `evento "${event}" nao processado` };
  }

  if (spec.approveWithoutStatus) {
    return { decision: 'approved', reason: 'sem status no payload (como no container, todo webhook e venda)' };
  }
  return { decision: 'ignored', reason: 'sem evento nem status reconhecivel' };
}

export function parseCheckout(spec: CheckoutSpec, body: unknown): ParsedCheckout {
  const event = str(body, spec.eventPaths, 100);
  const status = str(body, spec.statusPaths, 100);
  const { decision, reason } = decide(spec, event, status);

  const first_ = str(body, spec.firstName, 200);
  const last_ = str(body, spec.lastName, 200);
  const name = str(body, spec.name, 200) ?? ([first_, last_].filter(Boolean).join(' ') || null);

  let utmSource = str(body, spec.utm.source);
  let utmMedium = str(body, spec.utm.medium);
  let utmCampaign = str(body, spec.utm.campaign);
  let utmContent = str(body, spec.utm.content);
  let utmTerm = str(body, spec.utm.term);
  const indexer = str(body, spec.indexer, 200);

  // xcod no formato da Hotmart (source|medium|...|content|term), quando não é
  // o indexador do rastreio.
  if (spec.xcodPath) {
    const xcod = str(body, [spec.xcodPath], 1000);
    if (xcod && !xcod.startsWith('stl_')) {
      const p = parseXcod(xcod);
      utmSource ??= p.utm_source;
      utmMedium ??= p.utm_medium;
      utmCampaign ??= p.utm_campaign;
      utmContent ??= p.utm_content;
      utmTerm ??= p.utm_term;
    }
  }

  // O indexador em utm_term (Yampi, Wiapy, Doppus) não é UTM de verdade.
  if (utmTerm?.startsWith('stl_')) utmTerm = null;

  return {
    decision,
    reason,
    event,
    status,
    externalId: str(body, spec.externalId, 200),
    customerName: name,
    customerEmail: str(body, spec.email, 320)?.toLowerCase() ?? null,
    customerPhone: str(body, spec.phone, 40),
    customerDoc: str(body, spec.doc, 40),
    city: str(body, spec.city, 100),
    state: str(body, spec.state, 100),
    zip: str(body, spec.zip, 20),
    country: str(body, spec.country, 10),
    grossAmount: money(body, spec.amount),
    commissionAmount: money(body, spec.commission),
    currency: (str(body, spec.currency, 3) ?? 'BRL').toUpperCase(),
    productName: str(body, spec.productName, 300),
    productId: str(body, spec.productId, 100),
    paymentMethod: str(body, spec.paymentMethod, 60),
    soldAt: str(body, spec.soldAt, 60),
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    indexer,
  };
}
