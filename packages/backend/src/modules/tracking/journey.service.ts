import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { toExclusiveEndDate, toStartOfDayUTC } from '../../shared/helpers/date-range';
import { AdSpendSyncService, type AdSpendName } from '../facebook/ad-spend-sync.service';
import type { RangeQuery } from './tracking.service';
import {
  type AdIdentity,
  type CreativeAccum,
  type SpendSlice,
  finalizeCreatives,
  indexAds,
  canonicalKey,
} from './creative-spend';
import { buildPurchaseJourneys, type OrderLine, type SessionLite } from './journey-orders';

export { creativeKey } from './creative-spend';

interface SaleRow {
  id: string;
  external_id: string | null;
  order_external_id: string | null;
  is_order_bump: boolean | null;
  customer_email: string | null;
  customer_name: string | null;
  product_name: string | null;
  amount: number | string;
  status: string;
  sold_at: string;
  visitor_id: string | null;
  session_id: string | null;
  utm_content: string | null;
  match_method: string | null;
  metadata: Record<string, unknown> | null;
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

const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (rev: number, spend: number) => (spend > 0 ? round2(rev / spend) : null);

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function parentTransaction(meta: Record<string, unknown> | null): string | null {
  const value = meta?.parent_purchase_transaction;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function lineIsBump(sale: SaleRow): boolean {
  const parent = parentTransaction(sale.metadata);
  const fromMeta =
    sale.metadata?.is_order_bump === true && !!parent && parent !== sale.external_id;
  return sale.is_order_bump === true || fromMeta;
}

@Injectable()
export class JourneyService {
  private readonly logger = new Logger(JourneyService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() @Inject(AdSpendSyncService) private readonly adSpend?: AdSpendSyncService,
  ) {}

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
      .select(
        'id, external_id, order_external_id, is_order_bump, customer_email, customer_name, product_name, amount, status, sold_at, visitor_id, session_id, utm_content, match_method, metadata',
      )
      .eq('workspace_id', workspaceId)
      .gte('sold_at', from)
      .lt('sold_at', to)
      .order('sold_at', { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = ((sales ?? []) as SaleRow[]).filter((s) => s.status === 'approved');
    const visitorIds = [...new Set(rows.map((s) => s.visitor_id).filter((v): v is string => !!v))];
    let sessions: SessionRow[] = [];
    for (let i = 0; i < visitorIds.length; i += 100) {
      const { data, error: sErr } = await client
        .from('tracking_sessions')
        .select(
          'session_id, visitor_id, started_at, utm_source, utm_campaign, utm_content, ad_id, landing_page, device_type, had_checkout_click, checkout_clicked_at, sale_id',
        )
        .eq('workspace_id', workspaceId)
        .in('visitor_id', visitorIds.slice(i, i + 100))
        .order('started_at', { ascending: true })
        .limit(10000);
      if (sErr) throw new Error(sErr.message);
      sessions = sessions.concat((data ?? []) as SessionRow[]);
    }
    return { sales: rows, sessions };
  }

  private toLine(sale: SaleRow): OrderLine {
    return {
      id: sale.id,
      externalId: sale.external_id,
      orderExternalId: sale.order_external_id,
      isOrderBump: lineIsBump(sale),
      parentTransaction: parentTransaction(sale.metadata),
      amount: num(sale.amount),
      soldAt: sale.sold_at,
      productName: sale.product_name,
      customerName: sale.customer_name,
      customerEmail: sale.customer_email,
      visitorId: sale.visitor_id,
      sessionId: sale.session_id,
      utmContent: sale.utm_content,
      matchMethod: sale.match_method,
    };
  }

  private toSession(s: SessionRow): SessionLite {
    return {
      sessionId: s.session_id,
      visitorId: s.visitor_id,
      startedAt: s.started_at,
      utmSource: s.utm_source,
      utmCampaign: s.utm_campaign,
      utmContent: s.utm_content,
      adId: s.ad_id,
      landingPage: s.landing_page,
      deviceType: s.device_type,
      hadCheckoutClick: s.had_checkout_click,
    };
  }

  private sessionsByVisitor(sessions: SessionRow[]): Map<string, SessionLite[]> {
    const byVisitor = new Map<string, SessionLite[]>();
    for (const s of sessions) {
      const list = byVisitor.get(s.visitor_id) ?? [];
      list.push(this.toSession(s));
      byVisitor.set(s.visitor_id, list);
    }
    return byVisitor;
  }

  private async loadAdCatalog(workspaceId: string): Promise<AdIdentity[]> {
    const client = this.supabase.getClient();
    const nested = await client
      .from('ads')
      .select('facebook_ad_id, name, ad_sets(campaigns(name))')
      .eq('workspace_id', workspaceId)
      .limit(2000);
    const rows = nested.error
      ? (
          await client
            .from('ads')
            .select('facebook_ad_id, name')
            .eq('workspace_id', workspaceId)
            .limit(2000)
        ).data
      : nested.data;
    return ((rows ?? []) as any[]).map((row) => ({
      facebookAdId: row.facebook_ad_id,
      name: row.name ?? null,
      campaignName: campaignNameOf(row),
    }));
  }

  /**
   * Traz o gasto do período para daily_ad_spend quando ele está velho.
   * Falha da Meta não derruba a tela: mostra o que já está gravado.
   */
  private async refreshSpend(
    userId: string,
    workspaceId: string,
    fromDate: string,
    toDate: string,
  ): Promise<AdSpendName[]> {
    if (!this.adSpend) return [];
    try {
      return await this.adSpend.refreshForWorkspace(userId, workspaceId, fromDate, toDate);
    } catch (err: any) {
      this.logger.warn(`Gasto da jornada não atualizado: ${err?.message ?? err}`);
      return [];
    }
  }

  /** Por criativo: último clique, contribuição, Meta, gasto e ROI. */
  async getOverview(userId: string, workspaceId: string, range: RangeQuery) {
    await this.assertOwner(userId, workspaceId);
    const { from, to, fromDate, toDate } = this.range(range);
    const metaNames = await this.refreshSpend(userId, workspaceId, fromDate, toDate);
    const client = this.supabase.getClient();
    const [{ sales, sessions }, catalog, spendResult] = await Promise.all([
      this.loadSales(workspaceId, from, to),
      this.loadAdCatalog(workspaceId),
      client
        .from('daily_ad_spend')
        .select('facebook_ad_id, spend, conversions, impressions')
        .eq('workspace_id', workspaceId)
        .gte('date', fromDate)
        .lte('date', toDate)
        .not('facebook_ad_id', 'is', null)
        .limit(20000),
    ]);
    if (spendResult.error) throw new Error(spendResult.error.message);

    const journeys = buildPurchaseJourneys(
      sales.map((s) => this.toLine(s)),
      this.sessionsByVisitor(sessions),
    );
    const identity = indexAds([...catalog, ...metaNames]);
    const canon = (key: string | null) => (key ? canonicalKey(key, identity) : null);
    const partials = new Map<string, CreativeAccum>();
    const touch = (key: string): CreativeAccum => {
      let row = partials.get(key);
      if (!row) {
        row = {
          key,
          name: key,
          campaignName: null,
          lastClickSales: 0,
          lastClickRevenue: 0,
          assistedSales: 0,
          assistedRevenue: 0,
          metaPurchases: 0,
          impressions: 0,
          spend: 0,
        };
        partials.set(key, row);
      }
      return row;
    };

    let unattributed = 0;
    let unattributedRevenue = 0;
    for (const journey of journeys) {
      // Pedido só de order bump não vira outra venda: o valor creditado é a frente.
      const counts = journey.amount > 0 || journey.bumps.length === 0;
      if (!counts) continue;
      const lastKey = canon(journey.lastClickCreative);
      if (!lastKey) {
        unattributed += 1;
        unattributedRevenue += journey.amount;
        continue;
      }
      const last = touch(lastKey);
      last.lastClickSales += 1;
      last.lastClickRevenue += journey.amount;
      for (const key of journey.assistKeys) {
        const assistKey = canon(key);
        // O mesmo anúncio não "ajuda" a venda que ele mesmo fechou.
        if (!assistKey || assistKey === lastKey) continue;
        const row = touch(assistKey);
        row.assistedSales += 1;
        row.assistedRevenue += journey.amount;
      }
    }

    const spend: SpendSlice[] = (spendResult.data ?? []).map((d: any) => ({
      facebookAdId: d.facebook_ad_id,
      spend: num(d.spend),
      conversions: num(d.conversions),
      impressions: num(d.impressions),
    }));

    const creatives = finalizeCreatives(partials.values(), spend, [...catalog, ...metaNames])
      .map((r) => ({
        ...r,
        lastClickRevenue: round2(r.lastClickRevenue),
        assistedRevenue: round2(r.assistedRevenue),
        spend: round2(r.spend),
        roiLastClick: ratio(r.lastClickRevenue, r.spend),
        roiTotal: ratio(r.lastClickRevenue + r.assistedRevenue, r.spend),
      }))
      .sort(
        (a, b) =>
          b.lastClickRevenue + b.assistedRevenue - (a.lastClickRevenue + a.assistedRevenue) ||
          b.spend - a.spend,
      );

    return {
      creatives,
      unattributed: { sales: unattributed, revenue: round2(unattributedRevenue) },
    };
  }

  /** Uma jornada por compra, com a cadeia de criativos e o order bump na mesma venda. */
  async getCustomers(userId: string, workspaceId: string, range: RangeQuery, q?: string) {
    await this.assertOwner(userId, workspaceId);
    const { from, to } = this.range(range);
    const { sales, sessions } = await this.loadSales(workspaceId, from, to);
    const catalog = await this.loadAdCatalog(workspaceId);
    const index = indexAds(catalog);
    const term = q?.trim().toLowerCase();

    let journeys = buildPurchaseJourneys(
      sales.map((s) => this.toLine(s)),
      this.sessionsByVisitor(sessions),
    );

    if (term) {
      journeys = journeys.filter(
        (j) =>
          (j.customerEmail ?? '').toLowerCase().includes(term) ||
          (j.customerName ?? '').toLowerCase().includes(term),
      );
    }

    const customers = journeys.slice(0, 200).map((j) => {
      const creatives: string[] = [];
      const remember = (raw: string | null) => {
        if (!raw) return null;
        const key = canonicalKey(raw, index);
        if (key && !creatives.includes(key)) creatives.push(key);
        return key;
      };
      const touches = j.touches.map((t) => {
        const key = remember(t.creativeKey);
        const ad = key ? index.byId.get(key) : undefined;
        return {
          ...t,
          creativeKey: key,
          creativeName: ad?.name || t.creativeName,
          campaignName: ad?.campaignName || t.campaignName,
        };
      });
      const lastClickCreative = remember(j.lastClickCreative);
      return {
        orderKey: j.orderKey,
        customerName: j.customerName,
        customerEmail: j.customerEmail,
        soldAt: j.soldAt,
        productName: j.productName,
        items: j.items,
        amount: round2(j.amount),
        bumps: j.bumps.map((b) => ({ productName: b.productName, amount: round2(b.amount) })),
        matchMethod: j.matchMethod,
        lastClickCreative,
        hoursToPurchase: j.hoursToPurchase,
        creatives,
        touches,
      };
    });

    return { customers };
  }
}

function campaignNameOf(row: any): string | null {
  const adset = Array.isArray(row?.ad_sets) ? row.ad_sets[0] : row?.ad_sets;
  const camp = adset && (Array.isArray(adset.campaigns) ? adset.campaigns[0] : adset.campaigns);
  return camp?.name ?? null;
}
