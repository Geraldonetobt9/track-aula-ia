import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { toExclusiveEndDate, toStartOfDayUTC } from '../../shared/helpers/date-range';
import type { RangeQuery } from './tracking.service';

interface SaleRow {
  id: string;
  customer_email: string | null;
  customer_name: string | null;
  product_name: string | null;
  amount: number | string;
  status: string;
  sold_at: string;
  visitor_id: string | null;
  session_id: string | null;
  utm_content: string | null;
}

interface SessionRow {
  session_id: string;
  visitor_id: string;
  started_at: string;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  ad_id: string | null;
  landing_page: string | null;
  device_type: string | null;
  had_checkout_click: boolean;
  checkout_clicked_at: string | null;
  sale_id: string | null;
}

export interface CreativeRow {
  key: string;
  name: string;
  /** Vendas em que este criativo foi o último clique. */
  lastClickSales: number;
  lastClickRevenue: number;
  /** Vendas atribuídas a outro criativo, mas em que este apareceu antes na jornada. */
  assistedSales: number;
  assistedRevenue: number;
  /** Compras que o próprio Meta reporta (daily_ad_spend.conversions). */
  metaPurchases: number;
  spend: number;
  roiLastClick: number | null;
  roiTotal: number | null;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (rev: number, spend: number) => (spend > 0 ? round2(rev / spend) : null);

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Chave do criativo: o id do anúncio quando existe, senão o utm_content. */
export function creativeKey(s: { ad_id: string | null; utm_content: string | null }): string | null {
  const raw = s.ad_id?.trim() || s.utm_content?.trim() || null;
  if (!raw) return null;
  // utm_content costuma vir como "nome do anúncio|<ad_id>": casa pelo ad_id do Facebook.
  const m = raw.match(/\|\s*(\d{10,})\s*$/);
  return m ? m[1] : raw;
}

@Injectable()
export class JourneyService {
  constructor(private readonly supabase: SupabaseService) {}

  private async assertOwner(userId: string, workspaceId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Area nao encontrada');
  }

  private range(range: RangeQuery): { from: string; to: string; fromDate: string; toDate: string } {
    const toDate = range.to ?? todayInSaoPaulo();
    let fromDate = range.from;
    if (range.period === 'all') fromDate = '2015-01-01';
    if (!fromDate) {
      const d = new Date(`${toDate}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 6);
      fromDate = d.toISOString().slice(0, 10);
    }
    return { from: toStartOfDayUTC(fromDate), to: toExclusiveEndDate(toDate), fromDate, toDate };
  }

  /** Vendas aprovadas do período, com as sessões dos visitantes envolvidos. */
  private async loadSales(workspaceId: string, from: string, to: string) {
    const client = this.supabase.getClient();
    const { data: sales, error } = await client
      .from('sales')
      .select('id, customer_email, customer_name, product_name, amount, status, sold_at, visitor_id, session_id, utm_content')
      .eq('workspace_id', workspaceId)
      .gte('sold_at', from)
      .lt('sold_at', to)
      .order('sold_at', { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = (sales ?? []) as SaleRow[];
    const visitorIds = [...new Set(rows.map((s) => s.visitor_id).filter((v): v is string => !!v))];
    let sessions: SessionRow[] = [];
    // Em lotes, para não estourar o tamanho da URL do PostgREST.
    for (let i = 0; i < visitorIds.length; i += 100) {
      const { data, error: sErr } = await client
        .from('tracking_sessions')
        .select('session_id, visitor_id, started_at, utm_source, utm_campaign, utm_content, ad_id, landing_page, device_type, had_checkout_click, checkout_clicked_at, sale_id')
        .eq('workspace_id', workspaceId)
        .in('visitor_id', visitorIds.slice(i, i + 100))
        .order('started_at', { ascending: true })
        .limit(10000);
      if (sErr) throw new Error(sErr.message);
      sessions = sessions.concat((data ?? []) as SessionRow[]);
    }
    return { sales: rows, sessions };
  }

  /** Por criativo: último clique, contribuição, Meta, gasto e ROI. */
  async getOverview(userId: string, workspaceId: string, range: RangeQuery) {
    await this.assertOwner(userId, workspaceId);
    const { from, to, fromDate, toDate } = this.range(range);
    const client = this.supabase.getClient();
    const { sales, sessions } = await this.loadSales(workspaceId, from, to);

    const byVisitor = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const list = byVisitor.get(s.visitor_id) ?? [];
      list.push(s);
      byVisitor.set(s.visitor_id, list);
    }

    const rows = new Map<string, CreativeRow>();
    const get = (key: string): CreativeRow => {
      let r = rows.get(key);
      if (!r) {
        r = { key, name: key, lastClickSales: 0, lastClickRevenue: 0, assistedSales: 0, assistedRevenue: 0, metaPurchases: 0, spend: 0, roiLastClick: null, roiTotal: null };
        rows.set(key, r);
      }
      return r;
    };

    let unattributed = 0;
    let unattributedRevenue = 0;
    for (const sale of sales) {
      if (sale.status !== 'approved') continue;
      const amount = num(sale.amount);
      const soldAt = new Date(sale.sold_at).getTime();
      const own = sale.visitor_id ? byVisitor.get(sale.visitor_id) ?? [] : [];
      const matched = own.find((s) => s.session_id === sale.session_id) ?? null;
      const lastKey = (matched && creativeKey(matched)) || creativeKey({ ad_id: null, utm_content: sale.utm_content });

      if (lastKey) {
        const r = get(lastKey);
        r.lastClickSales += 1;
        r.lastClickRevenue += amount;
      } else {
        unattributed += 1;
        unattributedRevenue += amount;
      }

      // Contribuição: criativos de sessões anteriores, uma vez por venda.
      const seen = new Set<string>(lastKey ? [lastKey] : []);
      for (const s of own) {
        if (new Date(s.started_at).getTime() >= (matched ? new Date(matched.started_at).getTime() : soldAt)) continue;
        const k = creativeKey(s);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const r = get(k);
        r.assistedSales += 1;
        r.assistedRevenue += amount;
      }
    }

    // Gasto e compras do Meta por anúncio, no período.
    const { data: spendRows, error: spendErr } = await client
      .from('daily_ad_spend')
      .select('facebook_ad_id, spend, conversions')
      .eq('workspace_id', workspaceId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .limit(20000);
    if (spendErr) throw new Error(spendErr.message);
    for (const d of spendRows ?? []) {
      if (!d.facebook_ad_id) continue;
      const r = get(d.facebook_ad_id);
      r.spend += num(d.spend);
      r.metaPurchases += num(d.conversions);
    }

    // Nomes legíveis dos anúncios.
    const keys = [...rows.keys()];
    if (keys.length) {
      const { data: ads } = await client
        .from('ads')
        .select('facebook_ad_id, name')
        .eq('workspace_id', workspaceId)
        .in('facebook_ad_id', keys.slice(0, 500));
      for (const a of ads ?? []) if (a.facebook_ad_id && rows.has(a.facebook_ad_id)) rows.get(a.facebook_ad_id)!.name = a.name;
    }

    const creatives = [...rows.values()]
      .map((r) => ({
        ...r,
        lastClickRevenue: round2(r.lastClickRevenue),
        assistedRevenue: round2(r.assistedRevenue),
        spend: round2(r.spend),
        roiLastClick: ratio(r.lastClickRevenue, r.spend),
        roiTotal: ratio(r.lastClickRevenue + r.assistedRevenue, r.spend),
      }))
      .sort((a, b) => b.lastClickRevenue + b.assistedRevenue - (a.lastClickRevenue + a.assistedRevenue) || b.spend - a.spend);

    return { creatives, unattributed: { sales: unattributed, revenue: round2(unattributedRevenue) } };
  }

  /** Clientes (por e-mail) com a linha do tempo das visitas, cliques e compras. */
  async getCustomers(userId: string, workspaceId: string, range: RangeQuery, q?: string) {
    await this.assertOwner(userId, workspaceId);
    const { from, to } = this.range(range);
    const { sales, sessions } = await this.loadSales(workspaceId, from, to);
    const term = q?.trim().toLowerCase();

    const byCustomer = new Map<string, SaleRow[]>();
    for (const s of sales) {
      const key = (s.customer_email ?? s.visitor_id ?? s.id).toLowerCase();
      if (term && !key.includes(term) && !(s.customer_name ?? '').toLowerCase().includes(term)) continue;
      const list = byCustomer.get(key) ?? [];
      list.push(s);
      byCustomer.set(key, list);
    }

    const customers = [...byCustomer.entries()].map(([key, list]) => {
      const visitorIds = new Set(list.map((s) => s.visitor_id).filter((v): v is string => !!v));
      const mySessions = sessions.filter((s) => visitorIds.has(s.visitor_id));
      type Step = { at: string; kind: 'visit' | 'checkout' | 'purchase'; creative: string | null; label: string; role?: 'ajudou' | 'comprou' };
      const steps: Step[] = [];
      const buyKeys = new Set<string>();
      for (const sale of list) {
        const m = mySessions.find((s) => s.session_id === sale.session_id);
        const k = (m && creativeKey(m)) || creativeKey({ ad_id: null, utm_content: sale.utm_content });
        if (k && sale.status === 'approved') buyKeys.add(k);
        steps.push({ at: sale.sold_at, kind: 'purchase', creative: k, label: `${sale.status === 'approved' ? 'Comprou' : sale.status} ${sale.product_name ?? ''}`.trim(), role: 'comprou' });
      }
      for (const s of mySessions) {
        const k = creativeKey(s);
        steps.push({ at: s.started_at, kind: 'visit', creative: k, label: `Visita (${s.utm_source ?? 'direto'}) ${s.landing_page ?? ''}`.trim(), role: k && buyKeys.has(k) ? undefined : k ? 'ajudou' : undefined });
        if (s.checkout_clicked_at) steps.push({ at: s.checkout_clicked_at, kind: 'checkout', creative: k, label: 'Clicou no checkout' });
      }
      steps.sort((a, b) => a.at.localeCompare(b.at));
      return {
        key,
        name: list.find((s) => s.customer_name)?.customer_name ?? null,
        email: list.find((s) => s.customer_email)?.customer_email ?? null,
        purchases: list.length,
        revenue: round2(list.filter((s) => s.status === 'approved').reduce((t, s) => t + num(s.amount), 0)),
        lastPurchaseAt: list[list.length - 1].sold_at,
        timeline: steps,
      };
    });
    customers.sort((a, b) => b.lastPurchaseAt.localeCompare(a.lastPurchaseAt));
    return { customers: customers.slice(0, 200) };
  }
}
