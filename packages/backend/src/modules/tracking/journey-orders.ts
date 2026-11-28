import { creativeKey, utmLabel } from './creative-spend';

export type TouchRole = 'last_click' | 'assist' | 'repeat' | 'none';

export interface OrderLine {
  id: string;
  externalId: string | null;
  orderExternalId: string | null;
  isOrderBump: boolean;
  parentTransaction: string | null;
  amount: number;
  soldAt: string;
  productName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  visitorId: string | null;
  sessionId: string | null;
  utmContent: string | null;
  matchMethod: string | null;
}

export interface SessionLite {
  sessionId: string;
  visitorId: string;
  startedAt: string;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  adId: string | null;
  landingPage: string | null;
  deviceType: string | null;
  hadCheckoutClick: boolean;
}

export interface TouchDraft {
  sessionId: string;
  startedAt: string;
  creativeKey: string | null;
  creativeName: string | null;
  campaignName: string | null;
  source: string;
  landingPage: string | null;
  deviceType: string | null;
  hadCheckoutClick: boolean;
  role: TouchRole;
}

export interface PurchaseJourney {
  orderKey: string;
  customerName: string | null;
  customerEmail: string | null;
  soldAt: string;
  productName: string | null;
  items: number;
  /** Valor creditado: a venda da frente, sem os order bumps. */
  amount: number;
  bumps: Array<{ productName: string | null; amount: number }>;
  matchMethod: string | null;
  lastClickCreative: string | null;
  hoursToPurchase: number | null;
  creatives: string[];
  touches: TouchDraft[];
  /** Criativos que apareceram antes do último clique, uma vez. */
  assistKeys: string[];
}

const FIVE_MIN = 5 * 60 * 1000;

export function purchaseGroupKey(line: OrderLine): string {
  const parent = line.parentTransaction?.trim() || null;
  if (line.isOrderBump && parent && parent !== line.externalId) return `tx:${parent}`;
  if (
    line.orderExternalId &&
    line.externalId &&
    line.orderExternalId !== line.externalId
  ) {
    return `ord:${line.orderExternalId}`;
  }
  return `tx:${line.externalId || line.id}`;
}

export function sourceLabel(utmSource: string | null, creative: string | null): string {
  const s = (utmSource || '').trim().toLowerCase();
  if (
    s === 'fb' ||
    s === 'ig' ||
    s === 'meta' ||
    s.includes('facebook') ||
    s.includes('instagram')
  ) {
    return 'Facebook Ads';
  }
  if (creative && /^\d{8,}$/.test(creative)) return 'Facebook Ads';
  const raw = (utmSource || '').trim();
  if (raw) return raw;
  return creative ? 'Facebook Ads' : 'direto';
}

export function hoursBetween(fromIso: string | null, toIso: string): number | null {
  if (!fromIso) return null;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 36e5;
}

function sessionCreative(s: SessionLite): string | null {
  return creativeKey({ ad_id: s.adId, utm_content: s.utmContent });
}

/**
 * Agrupa as linhas aprovadas de um pedido (frente + order bumps) e monta a
 * cadeia de visitas até a compra. O valor creditado é só a frente.
 */
export function buildPurchaseJourneys(
  lines: OrderLine[],
  sessionsByVisitor: Map<string, SessionLite[]>,
): PurchaseJourney[] {
  const groups = new Map<string, OrderLine[]>();
  for (const line of lines) {
    const key = purchaseGroupKey(line);
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  const journeys: PurchaseJourney[] = [];
  for (const [orderKey, group] of groups) {
    const fronts = group.filter((l) => !l.isOrderBump);
    const bumpLines = group.filter((l) => l.isOrderBump);
    const primaryPool = fronts.length ? fronts : group;
    const primary =
      primaryPool.find((l) => l.sessionId) ??
      [...primaryPool].sort((a, b) => a.soldAt.localeCompare(b.soldAt))[0];
    const amount = fronts.reduce((t, l) => t + l.amount, 0);
    const soldAt = primary.soldAt;
    const visitorIds = [...new Set(group.map((l) => l.visitorId).filter((v): v is string => !!v))];

    const sessions: SessionLite[] = [];
    const seenSession = new Set<string>();
    for (const vid of visitorIds) {
      for (const s of sessionsByVisitor.get(vid) ?? []) {
        if (seenSession.has(s.sessionId)) continue;
        seenSession.add(s.sessionId);
        sessions.push(s);
      }
    }

    const soldMs = new Date(soldAt).getTime();
    const relevant = sessions
      .filter((s) => new Date(s.startedAt).getTime() <= soldMs + FIVE_MIN)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    const matched = relevant.find((s) => s.sessionId === primary.sessionId) ?? null;
    const lastKey =
      (matched && sessionCreative(matched)) ||
      creativeKey({ ad_id: null, utm_content: primary.utmContent });

    let lastClickSessionId = matched && sessionCreative(matched) ? matched.sessionId : null;
    if (!lastClickSessionId && lastKey) {
      const withKey = relevant.filter((s) => sessionCreative(s) === lastKey);
      lastClickSessionId = withKey.length ? withKey[withKey.length - 1].sessionId : null;
    }

    const touches: TouchDraft[] = relevant.map((s) => {
      const key = sessionCreative(s);
      let role: TouchRole = 'none';
      if (key && s.sessionId === lastClickSessionId) role = 'last_click';
      else if (key && key === lastKey) role = 'repeat';
      else if (key) role = 'assist';
      return {
        sessionId: s.sessionId,
        startedAt: s.startedAt,
        creativeKey: key,
        creativeName: utmLabel(s.utmContent),
        campaignName: utmLabel(s.utmCampaign),
        source: sourceLabel(s.utmSource, key),
        landingPage: s.landingPage,
        deviceType: s.deviceType,
        hadCheckoutClick: s.hadCheckoutClick,
        role,
      };
    });

    const creatives: string[] = [];
    for (const t of touches) {
      if (t.creativeKey && !creatives.includes(t.creativeKey)) creatives.push(t.creativeKey);
    }
    if (lastKey && !creatives.includes(lastKey)) creatives.push(lastKey);

    const assistKeys: string[] = [];
    for (const t of touches) {
      if (t.role === 'assist' && t.creativeKey && !assistKeys.includes(t.creativeKey)) {
        assistKeys.push(t.creativeKey);
      }
    }

    journeys.push({
      orderKey,
      customerName: group.find((l) => l.customerName)?.customerName ?? null,
      customerEmail: group.find((l) => l.customerEmail)?.customerEmail ?? null,
      soldAt,
      productName: (fronts.find((l) => l.productName) ?? primary).productName,
      items: group.length,
      amount,
      bumps: bumpLines.map((l) => ({ productName: l.productName, amount: l.amount })),
      matchMethod: primary.matchMethod ?? group.find((l) => l.matchMethod)?.matchMethod ?? null,
      lastClickCreative: lastKey,
      hoursToPurchase: hoursBetween(relevant[0]?.startedAt ?? null, soldAt),
      creatives,
      touches,
      assistKeys,
    });
  }

  journeys.sort((a, b) => b.soldAt.localeCompare(a.soldAt));
  return journeys;
}
