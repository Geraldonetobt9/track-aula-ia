import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { SaleMatcherService } from '../facebook/sale-matcher.service';
import {
  getExchangeRate,
  convertToBRL,
  getAccountCurrency,
} from '../../shared/helpers/currency';
import { toExclusiveEndDate, toStartOfDayUTC } from '../../shared/helpers/date-range';
import { META_API_VERSION } from '../../shared/constants/meta-api';

const FB_API_VERSION = META_API_VERSION;
const FB_GRAPH_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

/** How far back Facebook Insights still returns spend. Bounds any unbounded query. */
const FB_INSIGHTS_MAX_MONTHS = 36;

/** Value of the `period` filter that means "the whole history". */
const ALL_TIME_PERIOD = 'all';

interface ActiveConnection {
  id: string;
  access_token: string;
  ad_account_id: string;
}

interface DateRangeFilters {
  from?: string;
  to?: string;
  workspace_id?: string;
  connection_ids?: string[];
}

interface AdSetFilters extends DateRangeFilters {
  campaign_ids?: string[];
}

interface AdFilters extends DateRangeFilters {
  ad_set_ids?: string[];
  campaign_ids?: string[];
}

interface DashboardFilters extends DateRangeFilters {
  connection_ids?: string[];
  checkout_ids?: string[];
  product_names?: string[];
  /** `'all'` asks for the whole history; the start is resolved server-side. */
  period?: string;
}

interface DashboardMetricsRpcResponse {
  gross_revenue: number | string;
  sales_count: number;
  lifetime_revenue: number | string;
  chart_data: Array<{ date: string; revenue: number | string }>;
  regions: Array<{ state: string; sales: number; revenue: number | string }>;
  recent_sales: Array<{
    id: string;
    product_name: string | null;
    sold_at: string;
    amount: number | string;
  }>;
}

@Injectable()
export class LiveMetricsService {
  private readonly logger = new Logger(LiveMetricsService.name);
  // Per-request cache for currency + exchange rate (avoids duplicate FB API calls)
  private currencyCache = new Map<string, { currency: string; exchangeRate: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly saleMatcher: SaleMatcherService,
  ) {}

  private async getCurrencyAndRate(accountId: string, accessToken: string): Promise<{ currency: string; exchangeRate: number }> {
    const cached = this.currencyCache.get(accountId);
    if (cached) return cached;

    const currency = await getAccountCurrency(accountId, accessToken);
    const exchangeRate = await getExchangeRate(currency);
    const result = { currency, exchangeRate };
    this.currencyCache.set(accountId, result);
    return result;
  }

  // ============================================
  // Public API: Campaigns
  // ============================================
  async getCampaigns(userId: string, filters: DateRangeFilters) {
    const t0 = Date.now();
    this.logger.log(`[getCampaigns] START | range=${filters.from}..${filters.to}`);

    let connections = await this.getActiveConnections(userId, filters.workspace_id);
    if (filters.connection_ids?.length) {
      connections = connections.filter((c) => filters.connection_ids!.includes(c.id));
    }
    if (connections.length === 0) {
      this.logger.log(`[getCampaigns] No active connections — returning empty`);
      return [];
    }
    this.logger.log(`[getCampaigns] ${connections.length} connection(s): [${connections.map(c => c.ad_account_id).join(', ')}]`);

    const { since, until } = this.resolveRange(filters);

    // Step 1: Fetch only campaigns first — if none have data, skip ads entirely
    const t1 = Date.now();
    const fbCampaigns = await this.fetchAllConnectionsCampaigns(connections, since, until);
    this.logger.log(`[getCampaigns] Step 1 (campaigns only) done in ${Date.now() - t1}ms | ${fbCampaigns.length} campaign(s) with activity`);

    if (fbCampaigns.length === 0) {
      this.logger.log(`[getCampaigns] DONE in ${Date.now() - t0}ms | 0 campaigns — skipped ads + sales fetch`);
      return [];
    }

    // Step 2: We have campaigns — now fetch ad sets + ads (for LC attribution) + sales in parallel
    const t2 = Date.now();
    const [fbAdSets, fbAds, salesByAd] = await Promise.all([
      this.fetchAllConnectionsAdSets(connections, since, until),
      this.fetchAllConnectionsAds(connections, since, until),
      this.getSalesGroupedByAd(userId, filters),
    ]);
    this.logger.log(`[getCampaigns] Step 2 (adsets + ads + sales) done in ${Date.now() - t2}ms | adSets=${fbAdSets.length} ads=${fbAds.length} salesGroups=${salesByAd.size}`);

    // Build ad→campaign map for LC attribution
    const adToCampaignMap = new Map<string, string>();
    for (const ad of fbAds) {
      if (ad.facebookAdId && ad.facebookCampaignId) {
        adToCampaignMap.set(ad.facebookAdId, ad.facebookCampaignId);
      }
    }

    // Aggregate LC sales by campaign
    const lcByCampaign = new Map<string, { sales: number; revenue: number; refunds: number; refundAmount: number }>();
    for (const [adId, salesData] of salesByAd) {
      const campaignId = adToCampaignMap.get(adId);
      if (!campaignId) continue;
      const existing = lcByCampaign.get(campaignId) || { sales: 0, revenue: 0, refunds: 0, refundAmount: 0 };
      existing.sales += salesData.count;
      existing.revenue += salesData.revenue;
      existing.refunds += salesData.refunds;
      existing.refundAmount += salesData.refundAmount;
      lcByCampaign.set(campaignId, existing);
    }

    // Merge FB metrics + LC sales. Financial calcs based on Meta revenue.
    const result = fbCampaigns.map((c) => {
      const lc = lcByCampaign.get(c.facebook_campaign_id) || { sales: 0, revenue: 0, refunds: 0, refundAmount: 0 };
      const spend = c.spend || 0;
      const metaRevenue = c.meta_revenue || 0;
      return {
        id: c.facebook_campaign_id,
        facebook_campaign_id: c.facebook_campaign_id,
        ad_account_id: c.ad_account_id,
        name: c.name,
        status: c.status?.toLowerCase() === 'active' ? 'active' : 'paused',
        objective: c.objective,
        daily_budget: c.daily_budget,
        lifetime_budget: c.lifetime_budget,
        spend,
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        initiate_checkouts: c.initiate_checkouts,
        meta_revenue: metaRevenue,
        cpc: c.clicks > 0 ? spend / c.clicks : 0,
        cpm: c.impressions > 0 ? (spend / c.impressions) * 1000 : 0,
        ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
        sales: lc.sales,
        revenue: lc.revenue,
        refunds: lc.refunds,
        refund_amount: lc.refundAmount,
        net_sales: lc.sales - lc.refunds,
        net_revenue: lc.revenue - lc.refundAmount,
        roas: spend > 0 ? metaRevenue / spend : 0,
        cpa_real: c.conversions > 0 ? spend / c.conversions : 0,
        roi: spend > 0 ? ((metaRevenue - spend) / spend) * 100 : 0,
      };
    });

    this.logger.log(`[getCampaigns] DONE in ${Date.now() - t0}ms | total=${result.length} total_spend=R$${result.reduce((s, c) => s + c.spend, 0).toFixed(2)}`);

    this.persistFacebookData(userId, filters.workspace_id || null, {
      campaigns: fbCampaigns,
      adSets: fbAdSets,
      ads: fbAds,
      since,
      until,
    });

    return result;
  }

  // ============================================
  // Public API: Ad Sets
  // ============================================
  async getAdSets(userId: string, filters: AdSetFilters) {
    let connections = await this.getActiveConnections(userId, filters.workspace_id);
    if (filters.connection_ids?.length) {
      connections = connections.filter((c) => filters.connection_ids!.includes(c.id));
    }
    if (connections.length === 0) return [];

    const { since, until } = this.resolveRange(filters);

    // Fetch ad sets: use /{campaign_id}/adsets when campaign_ids provided, otherwise /{ad_account_id}/adsets
    const fbAdSets = filters.campaign_ids?.length
      ? await this.fetchAdSetsByCampaignIds(connections, filters.campaign_ids, since, until)
      : await this.fetchAllConnectionsAdSets(connections, since, until);

    if (fbAdSets.length === 0) return [];

    // Fetch ads + sales for LC attribution
    const [fbAds, salesByAd] = await Promise.all([
      this.fetchAllConnectionsAds(connections, since, until),
      this.getSalesGroupedByAd(userId, filters),
    ]);
    // Build ad→adset map
    const adToAdSetMap = new Map<string, string>();
    for (const ad of fbAds) {
      if (ad.facebookAdId && ad.facebookAdSetId) {
        adToAdSetMap.set(ad.facebookAdId, ad.facebookAdSetId);
      }
    }

    // Aggregate LC sales by ad set
    const lcByAdSet = new Map<string, { sales: number; revenue: number; refunds: number; refundAmount: number }>();
    for (const [adId, salesData] of salesByAd) {
      const adSetId = adToAdSetMap.get(adId);
      if (!adSetId) continue;
      const existing = lcByAdSet.get(adSetId) || { sales: 0, revenue: 0, refunds: 0, refundAmount: 0 };
      existing.sales += salesData.count;
      existing.revenue += salesData.revenue;
      existing.refunds += salesData.refunds;
      existing.refundAmount += salesData.refundAmount;
      lcByAdSet.set(adSetId, existing);
    }

    const mapped = fbAdSets.map((as) => {
      const lc = lcByAdSet.get(as.facebookAdSetId) || { sales: 0, revenue: 0, refunds: 0, refundAmount: 0 };
      const spend = as.spend || 0;
      const metaRevenue = as.meta_revenue || 0;
      return {
        id: as.facebookAdSetId,
        facebook_adset_id: as.facebookAdSetId,
        ad_account_id: as.ad_account_id,
        campaign_id: as.facebookCampaignId,
        name: as.name,
        status: as.status?.toLowerCase() === 'active' ? 'active' : 'paused',
        daily_budget: as.daily_budget,
        lifetime_budget: as.lifetime_budget,
        spend,
        impressions: as.impressions,
        clicks: as.clicks,
        conversions: as.conversions,
        initiate_checkouts: as.initiate_checkouts,
        meta_revenue: metaRevenue,
        cpc: as.clicks > 0 ? spend / as.clicks : 0,
        cpm: as.impressions > 0 ? (spend / as.impressions) * 1000 : 0,
        ctr: as.impressions > 0 ? (as.clicks / as.impressions) * 100 : 0,
        sales: lc.sales,
        revenue: lc.revenue,
        refunds: lc.refunds,
        refund_amount: lc.refundAmount,
        net_sales: lc.sales - lc.refunds,
        net_revenue: lc.revenue - lc.refundAmount,
        roas: spend > 0 ? metaRevenue / spend : 0,
        cpa_real: as.conversions > 0 ? spend / as.conversions : 0,
        roi: spend > 0 ? ((metaRevenue - spend) / spend) * 100 : 0,
      };
    });

    this.persistFacebookData(userId, filters.workspace_id || null, {
      adSets: fbAdSets,
      ads: fbAds,
      since,
      until,
    });

    return mapped;
  }

  // ============================================
  // Public API: Ads
  // ============================================
  async getAds(userId: string, filters: AdFilters) {
    let connections = await this.getActiveConnections(userId, filters.workspace_id);
    if (filters.connection_ids?.length) {
      connections = connections.filter((c) => filters.connection_ids!.includes(c.id));
    }
    if (connections.length === 0) return [];

    const { since, until } = this.resolveRange(filters);

    // Fetch campaigns + ads in parallel
    // Fetch ads: use hierarchical endpoints when filters provided
    let fbAds: any[];
    if (filters.ad_set_ids?.length) {
      fbAds = await this.fetchAdsByParentIds(connections, filters.ad_set_ids, 'adset', since, until);
    } else if (filters.campaign_ids?.length) {
      fbAds = await this.fetchAdsByParentIds(connections, filters.campaign_ids, 'campaign', since, until);
    } else {
      fbAds = await this.fetchAllConnectionsAds(connections, since, until);
    }
    if (fbAds.length === 0) return [];

    const salesByAd = await this.getSalesGroupedByAd(userId, filters);

    const mapped = fbAds.map((ad) => {
      const lc = salesByAd.get(ad.facebookAdId) || { count: 0, revenue: 0, refunds: 0, refundAmount: 0 };
      const spend = ad.spend || 0;
      const metaRevenue = ad.meta_revenue || 0;
      return {
        id: ad.facebookAdId,
        facebook_ad_id: ad.facebookAdId,
        ad_account_id: ad.ad_account_id,
        ad_set_id: ad.facebookAdSetId,
        name: ad.name,
        status: ad.status?.toLowerCase() === 'active' ? 'active' : 'paused',
        spend,
        impressions: ad.impressions,
        clicks: ad.clicks,
        conversions: ad.conversions,
        initiate_checkouts: ad.initiate_checkouts,
        meta_revenue: metaRevenue,
        cpc: ad.clicks > 0 ? spend / ad.clicks : 0,
        cpm: ad.impressions > 0 ? (spend / ad.impressions) * 1000 : 0,
        ctr: ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0,
        sales: lc.count,
        revenue: lc.revenue,
        refunds: lc.refunds,
        refund_amount: lc.refundAmount,
        net_sales: lc.count - lc.refunds,
        net_revenue: lc.revenue - lc.refundAmount,
        roas: spend > 0 ? metaRevenue / spend : 0,
        cpa_real: ad.conversions > 0 ? spend / ad.conversions : 0,
        roi: spend > 0 ? ((metaRevenue - spend) / spend) * 100 : 0,
      };
    });

    this.persistFacebookData(userId, filters.workspace_id || null, {
      ads: fbAds,
      since,
      until,
    });

    return mapped;
  }

  // ============================================
  // Public API: Dashboard (consolidated pre-computed response)
  // ============================================
  async getDashboardData(
    userId: string,
    filters: DashboardFilters,
  ): Promise<{
    metrics: {
      grossRevenue: number;
      netRevenue: number;
      adSpend: number;
      adSpendTax: number;
      adSpendTaxPercentage: number;
      roas: number;
      cpa: number;
      salesCount: number;
    };
    chartData: Array<{ date: string; revenue: number; spend: number }>;
    regions: Array<{ state: string; sales: number; revenue: number; percentage: number }>;
    lifetimeRevenue: number;
    recentSales: Array<{ id: string; product_name: string | null; sold_at: string; amount: number }>;
  }> {
    const t0 = Date.now();

    // "Todo período" is resolved to a concrete start here, before anything
    // reads the filters, so revenue and ad spend cover the same window.
    //
    // Leaving `from` unset would give revenue the whole table while ad spend
    // fell back to resolveRange's 30-day default — complete revenue over one
    // month of spend, which reads as a spectacular ROAS and is simply wrong.
    // That bug shipped once already on /financial.
    const effectiveFilters: DashboardFilters =
      filters.period === ALL_TIME_PERIOD && !filters.from
        ? { ...filters, from: await this.resolveAllTimeStart(userId, filters.workspace_id) }
        : filters;

    this.logger.log(
      `[getDashboard] START | range=${effectiveFilters.from}..${effectiveFilters.to}` +
        (filters.period === ALL_TIME_PERIOD ? ' | all-time' : ''),
    );

    const client = this.supabase.getClient();

    const [rpcResult, adSpendResult, taxPercentage] = await Promise.all([
      client.rpc('dashboard_metrics', {
        p_user_id: userId,
        p_workspace_id: effectiveFilters.workspace_id ?? null,
        p_from: effectiveFilters.from ? toStartOfDayUTC(effectiveFilters.from) : null,
        p_to: effectiveFilters.to ? toExclusiveEndDate(effectiveFilters.to) : null,
        p_checkout_ids: effectiveFilters.checkout_ids?.length ? effectiveFilters.checkout_ids : null,
        p_product_names: effectiveFilters.product_names?.length ? effectiveFilters.product_names : null,
      }),
      this.aggregateAdSpend(userId, effectiveFilters),
      this.getAdSpendTaxPercentage(userId, effectiveFilters.workspace_id),
    ]);

    if (rpcResult.error) {
      throw new Error(`[dashboard_metrics] ${rpcResult.error.message}`);
    }

    const rpc = rpcResult.data as DashboardMetricsRpcResponse;

    const round2 = (n: number): number => Math.round(n * 100) / 100;

    const grossRevenue = round2(Number(rpc.gross_revenue));
    const salesCount = Number(rpc.sales_count);
    const lifetimeRevenue = round2(Number(rpc.lifetime_revenue));
    const adSpend = round2(adSpendResult.total);
    const adSpendTax = round2(adSpend * (taxPercentage / 100));
    const netRevenue = round2(grossRevenue - adSpend - adSpendTax);
    const roas = adSpend > 0 ? grossRevenue / adSpend : 0;
    const cpa = salesCount > 0 ? adSpend / salesCount : 0;

    // chartData: merge per-day revenue (from RPC) with per-day ad spend (from Facebook).
    const revenueByDate = new Map<string, number>(
      rpc.chart_data.map((d) => [d.date, Number(d.revenue)]),
    );
    const spendByDate = adSpendResult.byDate;
    const allDates = Array.from(new Set([...revenueByDate.keys(), ...spendByDate.keys()])).sort();
    const chartData = allDates.map((date) => ({
      date,
      revenue: round2(revenueByDate.get(date) ?? 0),
      spend: round2(spendByDate.get(date) ?? 0),
    }));

    // regions: percentage is computed here (cheap) so the RPC stays focused on aggregation.
    const totalRegionSales = rpc.regions.reduce((s, r) => s + r.sales, 0);
    const regions = rpc.regions.map((r) => ({
      state: r.state,
      sales: r.sales,
      revenue: Number(r.revenue),
      percentage: totalRegionSales > 0 ? (r.sales / totalRegionSales) * 100 : 0,
    }));

    const recentSales = rpc.recent_sales.map((s) => ({
      id: s.id,
      product_name: s.product_name,
      sold_at: s.sold_at,
      amount: Number(s.amount),
    }));

    this.logger.log(`[getDashboard] DONE in ${Date.now() - t0}ms`);

    return {
      metrics: {
        grossRevenue,
        netRevenue,
        adSpend,
        adSpendTax,
        adSpendTaxPercentage: taxPercentage,
        roas,
        cpa,
        salesCount,
      },
      chartData,
      regions,
      lifetimeRevenue,
      recentSales,
    };
  }


  // ============================================
  // Public API: Aggregate ad spend for a period
  // ============================================
  /**
   * Aggregate ad spend for a given user/workspace/period. Returns total and daily breakdown.
   * When there are no active connections, returns { total: 0, byDate: new Map() } without calling Facebook.
   */
  // Reads the workspace-level percentage of tax that incides on ad spend.
  // Returns 0 when no workspace is provided or the row is missing — keeps the
  // dashboard rendering even if the column hasn't been backfilled.
  async getAdSpendTaxPercentage(
    userId: string,
    workspaceId?: string,
  ): Promise<number> {
    if (!workspaceId) return 0;
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('ad_spend_tax_percentage')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`[getAdSpendTaxPercentage] ${error.message}`);
      return 0;
    }
    return Number(data?.ad_spend_tax_percentage ?? 0);
  }

  async aggregateAdSpend(
    userId: string,
    filters: DashboardFilters,
  ): Promise<{ total: number; byDate: Map<string, number> }> {
    let connections = await this.getActiveConnections(userId, filters.workspace_id);
    if (filters.connection_ids?.length) {
      connections = connections.filter((c) => filters.connection_ids!.includes(c.id));
    }
    if (connections.length === 0) {
      return { total: 0, byDate: new Map() };
    }
    const { since, until } = this.resolveRange(filters);
    const dailySpend = await this.fetchAllConnectionsDailyInsights(connections, since, until);
    const byDate = new Map<string, number>();
    let total = 0;
    for (const d of dailySpend as any[]) {
      const v = Number(d.spend ?? 0);
      total += v;
      byDate.set(d.date, (byDate.get(d.date) ?? 0) + v);
    }
    return { total, byDate };
  }

  // ============================================
  // Public API: Daily spend (for funnel charts)
  // ============================================
  async getDailyAdSpend(userId: string, filters: DateRangeFilters) {
    let connections = await this.getActiveConnections(userId, filters.workspace_id);
    if (filters.connection_ids?.length) {
      connections = connections.filter((c) => filters.connection_ids!.includes(c.id));
    }
    if (connections.length === 0) {
      return [];
    }

    const { since, until } = this.resolveRange(filters);
    const result = await this.fetchAllConnectionsDailyInsights(connections, since, until);

    return result;
  }

  // ============================================
  // Private: Persist Facebook data to DB (fire-and-forget)
  // ============================================
  private persistFacebookData(
    userId: string,
    workspaceId: string | null,
    data: {
      campaigns?: Array<{ facebook_campaign_id: string; ad_account_id: string; name: string; status: string; objective?: string; daily_budget?: number | null; lifetime_budget?: number | null; spend: number; impressions: number; clicks: number; conversions: number; meta_revenue: number }>;
      adSets?: Array<{ facebookAdSetId: string; facebookCampaignId: string; ad_account_id: string; name: string; status: string; daily_budget?: number | null; lifetime_budget?: number | null; spend: number; impressions: number; clicks: number; conversions: number; meta_revenue: number }>;
      ads?: Array<{ facebookAdId: string; facebookAdSetId: string; facebookCampaignId: string; ad_account_id: string; name: string; status: string; spend: number; impressions: number; clicks: number; conversions: number; meta_revenue: number }>;
      since: string;
      until: string;
    },
  ): void {
    this.doPersistFacebookData(userId, workspaceId, data).catch((err) => {
      this.logger.error(`[persist] Unhandled error in persistFacebookData: ${err?.message}`);
    });
  }

  private async doPersistFacebookData(
    userId: string,
    workspaceId: string | null,
    data: {
      campaigns?: Array<{ facebook_campaign_id: string; ad_account_id: string; name: string; status: string; objective?: string; daily_budget?: number | null; lifetime_budget?: number | null; spend: number; impressions: number; clicks: number; conversions: number; meta_revenue: number }>;
      adSets?: Array<{ facebookAdSetId: string; facebookCampaignId: string; ad_account_id: string; name: string; status: string; daily_budget?: number | null; lifetime_budget?: number | null; spend: number; impressions: number; clicks: number; conversions: number; meta_revenue: number }>;
      ads?: Array<{ facebookAdId: string; facebookAdSetId: string; facebookCampaignId: string; ad_account_id: string; name: string; status: string; spend: number; impressions: number; clicks: number; conversions: number; meta_revenue: number }>;
      since: string;
      until: string;
    },
  ): Promise<void> {
    try {
      const client = this.supabase.getClient();
      const now = new Date().toISOString();

      // Build a map: facebook_campaign_id → internal UUID (from DB)
      const campaignIdMap = new Map<string, string>();

      if (data.campaigns?.length) {
        const fbCampaignIds = data.campaigns.map((c) => c.facebook_campaign_id);
        const { data: existing } = await client
          .from('campaigns')
          .select('id, facebook_campaign_id')
          .eq('user_id', userId)
          .in('facebook_campaign_id', fbCampaignIds);

        for (const row of existing || []) {
          campaignIdMap.set(row.facebook_campaign_id, row.id);
        }

        const rows = data.campaigns.map((c) => {
          const id = campaignIdMap.get(c.facebook_campaign_id) || randomUUID();
          campaignIdMap.set(c.facebook_campaign_id, id);
          return {
            id,
            user_id: userId,
            workspace_id: workspaceId,
            facebook_campaign_id: c.facebook_campaign_id,
            name: c.name,
            status: c.status?.toLowerCase() === 'active' ? 'active' : 'paused',
            objective: c.objective ?? null,
            daily_budget: c.daily_budget ?? null,
            lifetime_budget: c.lifetime_budget ?? null,
            spend: c.spend,
            impressions: c.impressions,
            clicks: c.clicks,
            conversions: c.conversions,
            synced_at: now,
          };
        });

        const { error } = await client.from('campaigns').upsert(rows, { onConflict: 'id' });
        if (error) this.logger.error(`[persist] campaigns upsert error: ${error.message}`);
      }

      // Build a map: facebook_adset_id → internal UUID
      const adSetIdMap = new Map<string, string>();

      if (data.adSets?.length) {
        // If campaignIdMap is empty (e.g., called from getAdSets without campaigns), fetch from DB
        const missingCampaignFbIds = data.adSets
          .map((as) => as.facebookCampaignId)
          .filter((fbId) => !campaignIdMap.has(fbId));

        if (missingCampaignFbIds.length) {
          const { data: existingCampaigns } = await client
            .from('campaigns')
            .select('id, facebook_campaign_id')
            .eq('user_id', userId)
            .in('facebook_campaign_id', missingCampaignFbIds);

          for (const row of existingCampaigns || []) {
            campaignIdMap.set(row.facebook_campaign_id, row.id);
          }
        }

        const fbAdSetIds = data.adSets.map((as) => as.facebookAdSetId);
        const { data: existingAdSets } = await client
          .from('ad_sets')
          .select('id, facebook_adset_id')
          .eq('user_id', userId)
          .in('facebook_adset_id', fbAdSetIds);

        for (const row of existingAdSets || []) {
          adSetIdMap.set(row.facebook_adset_id, row.id);
        }

        const rows = data.adSets
          .filter((as) => campaignIdMap.has(as.facebookCampaignId))
          .map((as) => {
            const id = adSetIdMap.get(as.facebookAdSetId) || randomUUID();
            adSetIdMap.set(as.facebookAdSetId, id);
            return {
              id,
              user_id: userId,
              workspace_id: workspaceId,
              facebook_adset_id: as.facebookAdSetId,
              campaign_id: campaignIdMap.get(as.facebookCampaignId)!,
              name: as.name,
              status: as.status?.toLowerCase() === 'active' ? 'active' : 'paused',
              daily_budget: as.daily_budget ?? null,
              lifetime_budget: as.lifetime_budget ?? null,
              spend: as.spend,
              impressions: as.impressions,
              clicks: as.clicks,
              conversions: as.conversions,
              synced_at: now,
            };
          });

        if (rows.length) {
          const { error } = await client.from('ad_sets').upsert(rows, { onConflict: 'id' });
          if (error) this.logger.error(`[persist] ad_sets upsert error: ${error.message}`);
        }
      }

      if (data.ads?.length) {
        // Fetch missing adSet UUIDs if not already in map
        const missingAdSetFbIds = data.ads
          .map((ad) => ad.facebookAdSetId)
          .filter((fbId) => !adSetIdMap.has(fbId));

        if (missingAdSetFbIds.length) {
          const { data: existingAdSets } = await client
            .from('ad_sets')
            .select('id, facebook_adset_id')
            .eq('user_id', userId)
            .in('facebook_adset_id', missingAdSetFbIds);

          for (const row of existingAdSets || []) {
            adSetIdMap.set(row.facebook_adset_id, row.id);
          }
        }

        const fbAdIds = data.ads.map((ad) => ad.facebookAdId);
        const { data: existingAds } = await client
          .from('ads')
          .select('id, facebook_ad_id')
          .eq('user_id', userId)
          .in('facebook_ad_id', fbAdIds);

        const adIdMap = new Map<string, string>();
        for (const row of existingAds || []) {
          adIdMap.set(row.facebook_ad_id, row.id);
        }

        const rows = data.ads
          .filter((ad) => adSetIdMap.has(ad.facebookAdSetId))
          .map((ad) => ({
            id: adIdMap.get(ad.facebookAdId) || randomUUID(),
            user_id: userId,
            workspace_id: workspaceId,
            facebook_ad_id: ad.facebookAdId,
            ad_set_id: adSetIdMap.get(ad.facebookAdSetId)!,
            name: ad.name,
            status: ad.status?.toLowerCase() === 'active' ? 'active' : 'paused',
            spend: ad.spend,
            impressions: ad.impressions,
            clicks: ad.clicks,
            conversions: ad.conversions,
            synced_at: now,
          }));

        if (rows.length) {
          const { error } = await client.from('ads').upsert(rows, { onConflict: 'id' });
          if (error) this.logger.error(`[persist] ads upsert error: ${error.message}`);
        }
      }

      // Rematch unmatched sales against freshly persisted ads
      if (data.ads?.length) {
        try {
          const result = await this.saleMatcher.rematchSales(userId);
          if (result.rematched > 0) {
            this.logger.log(`[persistFacebookData] Rematched ${result.rematched} sales`);
          }
        } catch (err: any) {
          this.logger.warn(`[persistFacebookData] rematch error: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`[persist] Exception: ${err?.message}`);
    }
  }

  // ============================================
  // Private: Get active Facebook connections
  // ============================================
  private async getActiveConnections(userId: string, workspaceId?: string): Promise<ActiveConnection[]> {
    const client = this.supabase.getClient();
    let query = client
      .from('facebook_connections')
      .select('id, access_token, ad_account_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('is_valid', true);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    const connections = (data || []).map((c) => ({
      id: c.id,
      access_token: this.encryption.decryptIfNeeded(c.access_token),
      ad_account_id: c.ad_account_id.startsWith('act_') ? c.ad_account_id : `act_${c.ad_account_id}`,
    }));

    return connections;
  }

  // ============================================
  // Private: Fetch campaigns from all connections
  // ============================================
  private async fetchAllConnectionsCampaigns(
    connections: ActiveConnection[],
    since: string,
    until: string,
  ) {
    const results = await Promise.all(
      connections.map((conn) => this.fetchCampaignsFromFacebook(conn, since, until)),
    );
    return results.flat();
  }

  private async fetchCampaignsFromFacebook(
    conn: ActiveConnection,
    since: string,
    until: string,
  ) {
    const t = Date.now();
    const { exchangeRate } = await this.getCurrencyAndRate(conn.ad_account_id, conn.access_token);
    const currencyMs = Date.now() - t;

    // Filter server-side: only ACTIVE/PAUSED (skip deleted/archived)
    const filtering = encodeURIComponent(JSON.stringify([
      { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
    ]));
    const fields = `id,name,status,objective,daily_budget,lifetime_budget,insights.time_range(${JSON.stringify({ since, until })}){spend,impressions,clicks,cpm,cpc,ctr,actions,action_values}`;
    const url = `${FB_GRAPH_URL}/${conn.ad_account_id}/campaigns?fields=${fields}&filtering=${filtering}&limit=500&access_token=${conn.access_token}`;

    const tFb = Date.now();
    const rawCampaigns = await this.fetchAllPages(url, 'campaigns', conn.ad_account_id);
    const fbMs = Date.now() - tFb;

    // Filter OUTCOME_SALES client-side (FB doesn't support filtering by objective)
    const salesObjective = rawCampaigns.filter((c: any) => c.objective === 'OUTCOME_SALES');
    const withActivity = salesObjective.filter((c: any) => c.insights?.data?.[0]);
    const withSpend = withActivity.filter((c: any) => parseFloat(c.insights?.data?.[0]?.spend || '0') > 0);

    this.logger.log(`[FB:campaigns] ${conn.ad_account_id} | currency=${currencyMs}ms fb_api=${fbMs}ms total=${Date.now() - t}ms | raw=${rawCampaigns.length} sales_obj=${salesObjective.length} with_insights=${withActivity.length} with_spend=${withSpend.length}`);

    return withActivity.map((c: any) => {
      const insight = c.insights.data[0];
      return {
        facebook_campaign_id: c.id,
        ad_account_id: conn.ad_account_id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget: c.daily_budget ? convertToBRL(c.daily_budget / 100, exchangeRate) : null,
        lifetime_budget: c.lifetime_budget ? convertToBRL(c.lifetime_budget / 100, exchangeRate) : null,
        spend: convertToBRL(parseFloat(insight.spend || '0'), exchangeRate),
        impressions: parseInt(insight.impressions || '0'),
        clicks: parseInt(insight.clicks || '0'),
        conversions: this.extractConversions(insight.actions),
        initiate_checkouts: this.extractInitiateCheckouts(insight.actions),
        meta_revenue: convertToBRL(this.extractPurchaseValue(insight.action_values), exchangeRate),
      };
    });
  }

  // ============================================
  // Private: Fetch ad sets by campaign IDs (hierarchical: /{campaign_id}/adsets)
  // ============================================
  private async fetchAdSetsByCampaignIds(
    connections: ActiveConnection[],
    campaignIds: string[],
    since: string,
    until: string,
  ) {
    // Use the first connection's token (all connections belong to the same user)
    // For multi-account: each campaign belongs to one account, but we don't know which.
    // Use all tokens in parallel and deduplicate.
    const results = await Promise.all(
      connections.map(async (conn) => {
        const { exchangeRate } = await this.getCurrencyAndRate(conn.ad_account_id, conn.access_token);
        const perCampaign = await Promise.all(
          campaignIds.map(async (campaignId) => {
            try {
              const fields = `id,name,status,campaign_id,daily_budget,lifetime_budget,insights.time_range(${JSON.stringify({ since, until })}){spend,impressions,clicks,cpm,cpc,ctr,actions,action_values}`;
              const url = `${FB_GRAPH_URL}/${campaignId}/adsets?fields=${fields}&limit=500&access_token=${conn.access_token}`;
              const rawAdSets = await this.fetchAllPages(url, `adsets:${campaignId}`, conn.ad_account_id);
              const withActivity = rawAdSets.filter((as: any) => as.insights?.data?.[0]);
              return withActivity.map((as: any) => {
                const insight = as.insights.data[0];
                return {
                  facebookAdSetId: as.id,
                  facebookCampaignId: as.campaign_id,
                  ad_account_id: conn.ad_account_id,
                  name: as.name,
                  status: as.status,
                  daily_budget: as.daily_budget ? convertToBRL(as.daily_budget / 100, exchangeRate) : null,
                  lifetime_budget: as.lifetime_budget ? convertToBRL(as.lifetime_budget / 100, exchangeRate) : null,
                  spend: convertToBRL(parseFloat(insight.spend || '0'), exchangeRate),
                  impressions: parseInt(insight.impressions || '0'),
                  clicks: parseInt(insight.clicks || '0'),
                  conversions: this.extractConversions(insight.actions),
                  initiate_checkouts: this.extractInitiateCheckouts(insight.actions),
                  meta_revenue: convertToBRL(this.extractPurchaseValue(insight.action_values), exchangeRate),
                };
              });
            } catch {
              // Campaign might not belong to this ad account — skip
              return [];
            }
          }),
        );
        return perCampaign.flat();
      }),
    );

    // Deduplicate by ad set ID (in case multiple connections returned the same ad set)
    const seen = new Set<string>();
    return results.flat().filter((as) => {
      if (seen.has(as.facebookAdSetId)) return false;
      seen.add(as.facebookAdSetId);
      return true;
    });
  }

  // ============================================
  // Private: Fetch ads by parent IDs (/{campaign_id}/ads or /{ad_set_id}/ads)
  // ============================================
  private async fetchAdsByParentIds(
    connections: ActiveConnection[],
    parentIds: string[],
    parentType: 'campaign' | 'adset',
    since: string,
    until: string,
  ) {
    const results = await Promise.all(
      connections.map(async (conn) => {
        const { exchangeRate } = await this.getCurrencyAndRate(conn.ad_account_id, conn.access_token);
        const perParent = await Promise.all(
          parentIds.map(async (parentId) => {
            try {
              const fields = `id,name,status,adset_id,campaign_id,insights.time_range(${JSON.stringify({ since, until })}){spend,impressions,clicks,cpm,cpc,ctr,actions,action_values}`;
              const url = `${FB_GRAPH_URL}/${parentId}/ads?fields=${fields}&limit=500&access_token=${conn.access_token}`;
              const rawAds = await this.fetchAllPages(url, `ads:${parentId}`, conn.ad_account_id);
              const withActivity = rawAds.filter((a: any) => a.insights?.data?.[0]);
              return withActivity.map((a: any) => {
                const insight = a.insights.data[0];
                return {
                  facebookAdId: a.id,
                  facebookAdSetId: a.adset_id,
                  facebookCampaignId: a.campaign_id,
                  ad_account_id: conn.ad_account_id,
                  name: a.name,
                  status: a.status,
                  spend: convertToBRL(parseFloat(insight.spend || '0'), exchangeRate),
                  impressions: parseInt(insight.impressions || '0'),
                  clicks: parseInt(insight.clicks || '0'),
                  conversions: this.extractConversions(insight.actions),
                  initiate_checkouts: this.extractInitiateCheckouts(insight.actions),
                  meta_revenue: convertToBRL(this.extractPurchaseValue(insight.action_values), exchangeRate),
                };
              });
            } catch {
              // Parent might not belong to this ad account — skip
              return [];
            }
          }),
        );
        return perParent.flat();
      }),
    );

    // Deduplicate by ad ID
    const seen = new Set<string>();
    return results.flat().filter((ad) => {
      if (seen.has(ad.facebookAdId)) return false;
      seen.add(ad.facebookAdId);
      return true;
    });
  }

  // ============================================
  // Private: Fetch ad sets from all connections
  // ============================================
  private async fetchAllConnectionsAdSets(
    connections: ActiveConnection[],
    since: string,
    until: string,
  ) {
    const results = await Promise.all(
      connections.map((conn) => this.fetchAdSetsFromFacebook(conn, since, until)),
    );
    return results.flat();
  }

  private async fetchAdSetsFromFacebook(
    conn: ActiveConnection,
    since: string,
    until: string,
  ) {
    const { exchangeRate } = await this.getCurrencyAndRate(conn.ad_account_id, conn.access_token);

    const filtering = encodeURIComponent(JSON.stringify([
      { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
    ]));
    const fields = `id,name,status,campaign_id,daily_budget,lifetime_budget,insights.time_range(${JSON.stringify({ since, until })}){spend,impressions,clicks,cpm,cpc,ctr,actions,action_values}`;
    const url = `${FB_GRAPH_URL}/${conn.ad_account_id}/adsets?fields=${fields}&filtering=${filtering}&limit=500&access_token=${conn.access_token}`;

    const rawAdSets = await this.fetchAllPages(url, 'adsets', conn.ad_account_id);
    const withActivity = rawAdSets.filter((as: any) => as.insights?.data?.[0]);
    return withActivity.map((as: any) => {
      const insight = as.insights.data[0];
      return {
        facebookAdSetId: as.id,
        facebookCampaignId: as.campaign_id,
        ad_account_id: conn.ad_account_id,
        name: as.name,
        status: as.status,
        daily_budget: as.daily_budget ? convertToBRL(as.daily_budget / 100, exchangeRate) : null,
        lifetime_budget: as.lifetime_budget ? convertToBRL(as.lifetime_budget / 100, exchangeRate) : null,
        spend: convertToBRL(parseFloat(insight.spend || '0'), exchangeRate),
        impressions: parseInt(insight.impressions || '0'),
        clicks: parseInt(insight.clicks || '0'),
        conversions: this.extractConversions(insight.actions),
        initiate_checkouts: this.extractInitiateCheckouts(insight.actions),
        meta_revenue: convertToBRL(this.extractPurchaseValue(insight.action_values), exchangeRate),
      };
    });
  }

  // ============================================
  // Private: Fetch ads from all connections
  // ============================================
  private async fetchAllConnectionsAds(
    connections: ActiveConnection[],
    since: string,
    until: string,
  ) {
    const results = await Promise.all(
      connections.map((conn) => this.fetchAdsFromFacebook(conn, since, until)),
    );
    return results.flat();
  }

  private async fetchAdsFromFacebook(
    conn: ActiveConnection,
    since: string,
    until: string,
  ) {
    const t = Date.now();
    const { exchangeRate } = await this.getCurrencyAndRate(conn.ad_account_id, conn.access_token);

    // Filter server-side: only ACTIVE/PAUSED ads
    const filtering = encodeURIComponent(JSON.stringify([
      { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
    ]));
    const fields = `id,name,status,adset_id,campaign_id,insights.time_range(${JSON.stringify({ since, until })}){spend,impressions,clicks,cpm,cpc,ctr,actions,action_values}`;
    const url = `${FB_GRAPH_URL}/${conn.ad_account_id}/ads?fields=${fields}&filtering=${filtering}&limit=500&access_token=${conn.access_token}`;

    const tFb = Date.now();
    const rawAds = await this.fetchAllPages(url, 'ads', conn.ad_account_id);
    const fbMs = Date.now() - tFb;

    const withActivity = rawAds.filter((a: any) => a.insights?.data?.[0]);

    this.logger.log(`[FB:ads] ${conn.ad_account_id} | fb_api=${fbMs}ms total=${Date.now() - t}ms | raw=${rawAds.length} with_insights=${withActivity.length}`);

    return withActivity.map((a: any) => {
      const insight = a.insights.data[0];
      return {
        facebookAdId: a.id,
        facebookAdSetId: a.adset_id,
        facebookCampaignId: a.campaign_id,
        ad_account_id: conn.ad_account_id,
        name: a.name,
        status: a.status,
        spend: convertToBRL(parseFloat(insight.spend || '0'), exchangeRate),
        impressions: parseInt(insight.impressions || '0'),
        clicks: parseInt(insight.clicks || '0'),
        conversions: this.extractConversions(insight.actions),
        initiate_checkouts: this.extractInitiateCheckouts(insight.actions),
        meta_revenue: convertToBRL(this.extractPurchaseValue(insight.action_values), exchangeRate),
      };
    });
  }

  // ============================================
  // Private: Fetch daily insights (for dashboard charts)
  // ============================================
  private async fetchAllConnectionsDailyInsights(
    connections: ActiveConnection[],
    since: string,
    until: string,
  ) {
    // A broken or revoked Facebook connection (common when a user unlinks the
    // Sentinela app from their Meta account) must not kill the caller's whole
    // response — e.g. the dashboard's sales/revenue cards are independent of
    // ad spend and should keep rendering. allSettled absorbs per-connection
    // failures; we log and skip the broken ones.
    const results = await Promise.allSettled(
      connections.map((conn) => this.fetchDailyInsightsFromFacebook(conn, since, until)),
    );
    const insights: any[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        insights.push(...r.value);
      } else {
        const conn = connections[i];
        const reason = (r.reason as Error)?.message ?? String(r.reason);
        this.logger.warn(
          `[FB:daily] ${conn.ad_account_id} (conn=${conn.id}) fetch failed — excluded from aggregation: ${reason}`,
        );
      }
    }
    return insights;
  }

  private async fetchDailyInsightsFromFacebook(
    conn: ActiveConnection,
    since: string,
    until: string,
  ) {
    const t = Date.now();
    const { exchangeRate } = await this.getCurrencyAndRate(conn.ad_account_id, conn.access_token);

    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    const fields = 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,cpc,cpm,ctr';
    const url = `${FB_GRAPH_URL}/${conn.ad_account_id}/insights?level=campaign&time_increment=1&fields=${fields}&time_range=${timeRange}&limit=500&access_token=${conn.access_token}`;

    const tFb = Date.now();
    const rawInsights = await this.fetchAllPages(url, 'daily-insights', conn.ad_account_id);

    this.logger.log(`[FB:daily] ${conn.ad_account_id} | fb_api=${Date.now() - tFb}ms total=${Date.now() - t}ms | ${rawInsights.length} row(s)`);
    return rawInsights.map((row: any) => {
      const spend = convertToBRL(parseFloat(row.spend || '0'), exchangeRate);
      const impressions = parseInt(row.impressions || '0');
      const clicks = parseInt(row.clicks || '0');
      const funnel = this.extractFunnelMetrics(row.actions);

      return {
        campaign_id: row.campaign_id,
        facebook_campaign_id: row.campaign_id,
        date: row.date_start,
        spend,
        impressions,
        clicks,
        conversions: this.extractConversions(row.actions),
        cpc: clicks > 0 ? spend / clicks : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        link_clicks: funnel.linkClicks,
        landing_page_views: funnel.landingPageViews,
        initiate_checkouts: funnel.initiateCheckouts,
        purchase_value: convertToBRL(this.extractPurchaseValue(row.action_values), exchangeRate),
        facebook_connection_id: conn.id,
      };
    });
  }

  // ============================================
  // Private: Get sales grouped by facebook_ad_id
  // ============================================
  private async getSalesGroupedByAd(
    userId: string,
    filters: DateRangeFilters,
  ): Promise<Map<string, { count: number; revenue: number; refunds: number; refundAmount: number }>> {
    const client = this.supabase.getClient();

    const { data, error } = await client.rpc('sales_grouped_by_ad', {
      p_user_id: userId,
      p_workspace_id: filters.workspace_id ?? null,
      p_from: filters.from ? toStartOfDayUTC(filters.from) : null,
      p_to: filters.to ? toExclusiveEndDate(filters.to) : null,
    });

    if (error) {
      throw new Error(`[sales_grouped_by_ad] ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      ad_id: string;
      approved_count: number;
      approved_revenue: number | string;
      refunded_count: number;
      refunded_revenue: number | string;
    }>;

    const map = new Map<string, { count: number; revenue: number; refunds: number; refundAmount: number }>();
    for (const row of rows) {
      map.set(row.ad_id, {
        count: row.approved_count,
        revenue: Number(row.approved_revenue),
        refunds: row.refunded_count,
        refundAmount: Number(row.refunded_revenue),
      });
    }
    return map;
  }

  // ============================================
  // Private: Helpers
  // ============================================

  /**
   * Start date for an unbounded ("todo período") query.
   *
   * The first sale, floored at the Facebook Insights retention limit. Asking
   * Graph for spend older than that returns nothing, so a start earlier than
   * the floor would pair complete revenue with truncated spend — which is
   * exactly how ROAS ends up inflated.
   *
   * Shared with FinancialService: both screens have to answer "todo período"
   * the same way, or the same workspace shows two different profits.
   */
  async resolveAllTimeStart(userId: string, workspaceId?: string): Promise<string> {
    const retentionFloor = new Date();
    retentionFloor.setUTCMonth(retentionFloor.getUTCMonth() - FB_INSIGHTS_MAX_MONTHS);

    let query = this.supabase
      .getClient()
      .from('sales')
      .select('sold_at')
      .eq('user_id', userId)
      .order('sold_at', { ascending: true })
      .limit(1);

    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    const { data: firstSale } = await query.maybeSingle();

    if (!firstSale?.sold_at) return retentionFloor.toISOString().slice(0, 10);

    const firstSaleDate = new Date(firstSale.sold_at);
    const start = firstSaleDate > retentionFloor ? firstSaleDate : retentionFloor;

    return start.toISOString().slice(0, 10);
  }

  private resolveRange(filters: DateRangeFilters): { since: string; until: string } {
    const now = new Date();
    const since = filters.from || this.toYmd(new Date(now.getTime() - 30 * 86400000));
    const until = filters.to || this.toYmd(now);
    return { since, until };
  }

  private toYmd(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private extractConversions(actions: any[] | undefined): number {
    if (!actions || !Array.isArray(actions)) return 0;
    const purchaseTypes = [
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
      'purchase',
    ];
    let maxVal = 0;
    for (const action of actions) {
      if (purchaseTypes.includes(action.action_type)) {
        const v = parseInt(action.value || '0');
        if (v > maxVal) maxVal = v;
      }
    }
    return maxVal;
  }

  private extractPurchaseValue(actionValues: any[] | undefined): number {
    if (!actionValues || !Array.isArray(actionValues)) return 0;
    const purchaseTypes = [
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
      'purchase',
    ];
    let maxVal = 0;
    for (const av of actionValues) {
      if (purchaseTypes.includes(av.action_type)) {
        const v = parseFloat(av.value || '0');
        if (v > maxVal) maxVal = v;
      }
    }
    return maxVal;
  }

  private extractFunnelMetrics(actions: any[] | undefined): {
    linkClicks: number;
    landingPageViews: number;
    initiateCheckouts: number;
  } {
    const extract = (type: string): number => {
      if (!actions || !Array.isArray(actions)) return 0;
      const action = actions.find((a: any) => a.action_type === type);
      return action ? parseInt(action.value || '0') : 0;
    };
    return {
      linkClicks: extract('link_click'),
      landingPageViews: extract('landing_page_view'),
      initiateCheckouts: this.extractInitiateCheckouts(actions),
    };
  }

  // Dedupe Meta's multiple Initiate Checkout action types (Pixel web, on-Meta web,
  // on-Meta app, omni-channel, legacy). Ads Manager's "Finalizacoes de compra iniciadas"
  // is the max across these variants, same approach used for purchases.
  private extractInitiateCheckouts(actions: any[] | undefined): number {
    if (!actions || !Array.isArray(actions)) return 0;
    const initiateCheckoutTypes = [
      'offsite_conversion.fb_pixel_initiate_checkout',
      'onsite_web_initiate_checkout',
      'onsite_web_app_initiate_checkout',
      'omni_initiated_checkout',
      'initiate_checkout',
    ];
    let maxVal = 0;
    for (const action of actions) {
      if (initiateCheckoutTypes.includes(action.action_type)) {
        const v = parseInt(action.value || '0');
        if (v > maxVal) maxVal = v;
      }
    }
    return maxVal;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchAllPages(initialUrl: string, label: string, accountId: string, maxRetries = 3): Promise<any[]> {
    let allData: any[] = [];
    let url: string | null = initialUrl;

    while (url) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response: Response = await fetch(url);
        const json: any = await response.json();

        if (json.error) {
          const msg = (json.error.message || '').toLowerCase();
          const isRateLimit =
            json.error.code === 32 ||
            json.error.code === 4 ||
            msg.includes('request limit') ||
            msg.includes('rate limit') ||
            msg.includes('too many calls');

          if (isRateLimit && attempt < maxRetries) {
            const waitMs = Math.min(30000, 2 ** attempt * 5000);
            await this.sleep(waitMs);
            continue;
          }

          this.logger.error(`[FB:${label}] ${accountId} API ERROR: ${json.error.message} (code=${json.error.code})`);
          throw new Error(`Facebook API Error: ${json.error.message}`);
        }

        if (json.data) allData = allData.concat(json.data);
        url = json.paging?.next || null;
        break;
      }
    }

    return allData;
  }
}
