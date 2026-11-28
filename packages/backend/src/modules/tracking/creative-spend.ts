/**
 * Junta vendas da jornada com o gasto da Meta sem duplicar o mesmo anúncio.
 *
 * A chave da venda pode ser o id do anúncio (utm_content "nome|id") ou só o
 * nome, no rastreio antigo. O gasto em daily_ad_spend entra pelo
 * facebook_ad_id. Quando o nome aponta para um único anúncio, as duas linhas
 * viram uma.
 */

export interface CreativeAccum {
  key: string;
  name: string;
  campaignName: string | null;
  lastClickSales: number;
  lastClickRevenue: number;
  assistedSales: number;
  assistedRevenue: number;
  metaPurchases: number;
  impressions: number;
  spend: number;
}

export interface AdIdentity {
  facebookAdId: string;
  name: string | null;
  campaignName: string | null;
}

export interface SpendSlice {
  facebookAdId: string;
  spend: number;
  conversions: number;
  impressions: number;
  /** Nome vindo da própria Meta, quando o anúncio ainda não está na tabela ads. */
  adName?: string | null;
  campaignName?: string | null;
}

export interface AdIndex {
  byId: Map<string, AdIdentity>;
  /** Nome normalizado → id, só quando um único anúncio usa esse nome. */
  byName: Map<string, string>;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export function normName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Id do anúncio no fim de "nome|id"; senão o texto inteiro. */
export function creativeKey(s: { ad_id: string | null; utm_content: string | null }): string | null {
  const raw = s.ad_id?.trim() || s.utm_content?.trim() || null;
  if (!raw) return null;
  const m = raw.match(/\|\s*(\d{10,})\s*$/);
  return m ? m[1] : raw;
}

/** Nome legível de "nome|1234567890". Sem id no fim, devolve o texto. */
export function utmLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(.*)\|\s*(\d{6,})\s*$/);
  if (!m) return trimmed;
  const name = m[1].trim();
  return name || m[2];
}

export function indexAds(ads: AdIdentity[]): AdIndex {
  const byId = new Map<string, AdIdentity>();
  const nameIds = new Map<string, Set<string>>();
  for (const ad of ads) {
    const id = ad.facebookAdId?.trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, {
      facebookAdId: id,
      name: ad.name?.trim() || prev?.name || null,
      campaignName: ad.campaignName?.trim() || prev?.campaignName || null,
    });
    const n = normName(ad.name);
    if (!n) continue;
    const set = nameIds.get(n) ?? new Set<string>();
    set.add(id);
    nameIds.set(n, set);
  }
  const byName = new Map<string, string>();
  for (const [name, ids] of nameIds) {
    if (ids.size === 1) byName.set(name, [...ids][0]);
  }
  return { byId, byName };
}

export function canonicalKey(raw: string, index: AdIndex): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (index.byId.has(trimmed)) return trimmed;
  const byName = index.byName.get(normName(trimmed));
  if (byName) return byName;
  const m = trimmed.match(/\|\s*(\d{10,})\s*$/);
  if (m) return m[1];
  return trimmed;
}

function emptyRow(key: string, name: string, campaignName: string | null): CreativeAccum {
  return {
    key,
    name,
    campaignName,
    lastClickSales: 0,
    lastClickRevenue: 0,
    assistedSales: 0,
    assistedRevenue: 0,
    metaPurchases: 0,
    impressions: 0,
    spend: 0,
  };
}

function applyIdentity(row: CreativeAccum, index: AdIndex) {
  const ad = index.byId.get(row.key);
  if (!ad) return;
  if (ad.name) row.name = ad.name;
  if (ad.campaignName) row.campaignName = ad.campaignName;
}

/**
 * Soma as linhas parciais (já agregadas por chave crua) e o gasto diário.
 * Uma linha por anúncio.
 */
export function finalizeCreatives(
  partials: Iterable<CreativeAccum>,
  spend: SpendSlice[],
  ads: AdIdentity[],
): CreativeAccum[] {
  const fromSpend: AdIdentity[] = spend
    .filter((s) => s.facebookAdId)
    .map((s) => ({
      facebookAdId: s.facebookAdId,
      name: s.adName ?? null,
      campaignName: s.campaignName ?? null,
    }));
  const index = indexAds([...ads, ...fromSpend]);
  const merged = new Map<string, CreativeAccum>();

  const fold = (rawKey: string, apply: (row: CreativeAccum) => void, fallbackName?: string | null) => {
    const key = canonicalKey(rawKey, index);
    if (!key) return;
    let row = merged.get(key);
    if (!row) {
      const ad = index.byId.get(key);
      const name = ad?.name || fallbackName?.trim() || (key === rawKey.trim() ? rawKey.trim() : rawKey.trim());
      row = emptyRow(key, name, ad?.campaignName ?? null);
      merged.set(key, row);
    }
    apply(row);
    applyIdentity(row, index);
  };

  for (const p of partials) {
    fold(
      p.key,
      (row) => {
        row.lastClickSales += p.lastClickSales;
        row.lastClickRevenue += p.lastClickRevenue;
        row.assistedSales += p.assistedSales;
        row.assistedRevenue += p.assistedRevenue;
        row.metaPurchases += p.metaPurchases;
        row.impressions += p.impressions;
        row.spend += p.spend;
        if (!row.campaignName && p.campaignName) row.campaignName = p.campaignName;
      },
      p.name,
    );
  }

  for (const s of spend) {
    if (!s.facebookAdId) continue;
    fold(
      s.facebookAdId,
      (row) => {
        row.spend += num(s.spend);
        row.metaPurchases += num(s.conversions);
        row.impressions += num(s.impressions);
      },
      s.adName,
    );
  }

  return [...merged.values()];
}
