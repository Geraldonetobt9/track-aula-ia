import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { toExclusiveEndDate, toStartOfDayUTC } from '../../shared/helpers/date-range';
import { PlanLimitsService, SaleDecision } from '../plan-limits/plan-limits.service';
import { StripeOverageService } from '../stripe/stripe-overage.service';
import { VisitorMatchingService } from '../tracking/visitor-matching.service';
import { webhookContext } from '../../shared/helpers/webhook-context';

export interface SalesFilters {
  from?: string;
  to?: string;
  statuses?: string[];
  workspace_id?: string;
  checkout_ids?: string[];
  product_names?: string[];
  campaign_ids?: string[];
  q?: string;
  page?: number;
  page_size?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly planLimits: PlanLimitsService,
    private readonly stripeOverage: StripeOverageService,
    private readonly visitorMatching: VisitorMatchingService,
  ) {}

  async upsertFromWebhook(sale: Record<string, any>): Promise<Record<string, any>> {
    // O snippet de rastreio escreve sck=stl_<sessao> no link do checkout.
    // Alguns processors usam o sck como último recurso para achar o ad_id,
    // e sem esta limpeza o id da sessão ia parar em sales.ad_id. O marcador
    // vai para o metadata, que é onde o casamento com a visita o procura —
    // em alguns processors, o ad_id era o único lugar onde ele chegava.
    if (typeof sale.ad_id === 'string' && sale.ad_id.startsWith('stl_')) {
      sale = { ...sale, ad_id: null, metadata: { ...(sale.metadata ?? {}), tracking_ref: sale.ad_id } };
    }

    // O indexador achado no corpo cru do webhook (webhook-context). Cobre as
    // plataformas cujo processor não guarda o parâmetro em lugar nenhum.
    const ctx = webhookContext.getStore();
    if (ctx?.trackingRef && !sale.metadata?.tracking_ref) {
      sale = { ...sale, metadata: { ...(sale.metadata ?? {}), tracking_ref: ctx.trackingRef } };
    }

    // 1. Status != approved — persist without limit check.
    if (sale.status !== 'approved') {
      const pending = await this.persist(sale);
      await this.visitorMatching.matchSale(pending.id);
      return pending;
    }

    // 2. Idempotency — webhook retry doesn't reprocess.
    const existing = await this.findByExternalId(sale.external_id, sale.user_id);
    if (existing) return existing;

    // 3. PlanLimitsService decision.
    const decision: SaleDecision = await this.planLimits.checkSaleAcceptance(sale.user_id);

    // 5. Persist normal sale.
    const saved = await this.persist(sale);

    // Liga a venda à visita rastreada, se houver. Aguardado, e não
    // fire-and-forget: na Vercel a função congela quando o webhook responde.
    // Nunca lança.
    await this.visitorMatching.matchSale(saved.id);

    // Venda aprovada nova: entra na lista do Purchase da CAPI, enviado quando
    // o webhook terminar (WebhookQueueService). Venda repetida não chega aqui.
    ctx?.approvedSaleIds.push(saved.id);

    // 6. Register overage if paid plan exceeded and dispatch meter event.
    if (decision.overage) {
      try {
        const overageId = await this.insertOverage(saved.id, sale.user_id, decision);
        // Fire-and-forget — reconciliation cron retries on failure
        this.stripeOverage
          .sendMeterEvent({ overageId })
          .catch((err) => this.logger.warn(
            `Meter event delivery failed for overage ${overageId}: ${err.message}. Reconciliation will retry.`,
          ));
      } catch (err) {
        // UNIQUE(sale_id) — if exists, silent ignore.
        if (!(err as any)?.message?.includes('duplicate')) throw err;
      }
    }

    // 7. Invalidate counts.
    await this.planLimits.invalidate(sale.user_id);
    return saved;
  }

  private async findByExternalId(
    externalId: string,
    userId: string,
  ): Promise<Record<string, any> | null> {
    const { data } = await this.supabase.getClient()
      .from('sales')
      .select('id, status')
      .eq('external_id', externalId)
      .eq('user_id', userId)
      .maybeSingle();
    return data ?? null;
  }

  private async persist(
    sale: Record<string, any>,
  ): Promise<Record<string, any>> {
    const { data, error } = await this.supabase.getClient()
      .from('sales')
      .insert(sale)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  private async insertOverage(
    saleId: string,
    userId: string,
    decision: { subscriptionId: string; periodStart: string; periodEnd: string; pricePerSaleCents: number },
  ): Promise<string> {
    const { data, error } = await this.supabase.getClient()
      .from('usage_overage')
      .insert({
        user_id: userId,
        subscription_id: decision.subscriptionId,
        sale_id: saleId,
        period_start: decision.periodStart,
        period_end: decision.periodEnd,
        price_cents: decision.pricePerSaleCents,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  /**
   * Batched upsert for imported sales. Always stamps source='import' and
   * blocked_by_limit=false. Uses ON CONFLICT (external_id, workspace_id) DO NOTHING
   * to stay idempotent against concurrent webhook arrivals.
   * Returns the rows actually written (duplicates are absent from the result).
   */
  async upsertManyImported(
    rows: Record<string, any>[],
  ): Promise<Array<{ id: string; external_id: string }>> {
    if (rows.length === 0) return [];
    const CHUNK = 500;
    const stamped = rows.map((r) => ({
      ...r,
      source: 'import',
    }));

    const inserted: Array<{ id: string; external_id: string }> = [];
    for (let i = 0; i < stamped.length; i += CHUNK) {
      const batch = stamped.slice(i, i + CHUNK);
      const { data, error } = await this.supabase
        .getClient()
        .from('sales')
        .upsert(batch, {
          onConflict: 'external_id,workspace_id',
          ignoreDuplicates: true,
        })
        .select('id, external_id');
      if (error) throw new Error(error.message);
      if (data) inserted.push(...data);
    }
    return inserted;
  }

  async getSalesWithDetails(userId: string, filters: SalesFilters) {
    const client = this.supabase.getClient();
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.page_size ?? DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    let query = client
      .from('sales')
      .select(
        'id, campaign_id, ad_id, external_id, customer_name, customer_email, customer_phone, customer_doc, customer_state, product_name, amount, status, payment_method, checkout_source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, sold_at, created_at, campaigns(name), ad_sets(name), ads(name), checkout_integrations(platform)',
        { count: 'exact' },
      )
      .eq('user_id', userId);

    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }
    if (filters.from) {
      query = query.gte('sold_at', toStartOfDayUTC(filters.from));
    }
    if (filters.to) {
      query = query.lt('sold_at', toExclusiveEndDate(filters.to));
    }
    if (filters.statuses && filters.statuses.length > 0) {
      query = query.in('status', filters.statuses);
    }
    if (filters.checkout_ids && filters.checkout_ids.length > 0) {
      query = query.in('checkout_integration_id', filters.checkout_ids);
    }
    if (filters.product_names && filters.product_names.length > 0) {
      query = query.in('product_name', filters.product_names);
    }
    if (filters.campaign_ids && filters.campaign_ids.length > 0) {
      query = query.in('campaign_id', filters.campaign_ids);
    }
    if (filters.q) {
      const escaped = filters.q.replace(/[%_,()]/g, '');
      const pattern = `%${escaped}%`;
      query = query.or(
        `customer_email.ilike.${pattern},customer_name.ilike.${pattern},product_name.ilike.${pattern}`,
      );
    }

    query = query.order('sold_at', { ascending: false }).range(offset, offset + pageSize - 1);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return {
      data: data ?? [],
      total: count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  async getDistinctProductNames(userId: string, workspaceId: string): Promise<string[]> {
    const client = this.supabase.getClient();
    const PAGE = 1000; // PostgREST default cap; iterate until exhausted.
    const set = new Set<string>();
    let from = 0;

    while (from < 50_000) {
      const to = from + PAGE - 1;
      const { data, error } = await client
        .from('sales')
        .select('product_name')
        .eq('user_id', userId)
        .eq('workspace_id', workspaceId)
        .not('product_name', 'is', null)
        .order('product_name', { ascending: true })
        .range(from, to);

      if (error) {
        throw new Error(error.message);
      }

      const rows = data ?? [];
      for (const row of rows) {
        const name = (row as { product_name: string | null }).product_name;
        if (name) set.add(name);
      }

      if (rows.length < PAGE) break;
      from += PAGE;
    }

    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async getSalesSummary(userId: string, filters: SalesFilters) {
    const client = this.supabase.getClient();

    // Prefer the SQL RPC when available (single round-trip aggregation).
    const { data: rpcData, error: rpcError } = await client.rpc('sales_summary', {
      p_user_id: userId,
      p_workspace_id: filters.workspace_id ?? null,
      p_from: filters.from ? toStartOfDayUTC(filters.from) : null,
      p_to: filters.to ? toExclusiveEndDate(filters.to) : null,
      p_statuses: filters.statuses && filters.statuses.length > 0 ? filters.statuses : null,
      p_checkout_ids: filters.checkout_ids && filters.checkout_ids.length > 0 ? filters.checkout_ids : null,
      p_product_names: filters.product_names && filters.product_names.length > 0 ? filters.product_names : null,
      p_campaign_ids: filters.campaign_ids && filters.campaign_ids.length > 0 ? filters.campaign_ids : null,
      p_q: filters.q ?? null,
    });

    if (!rpcError && rpcData) {
      return rpcData;
    }

    // Fallback: aggregate in Node when the RPC migration has not been
    // applied yet. Capped at 10k rows so it works for the seeded test
    // account; long-term the RPC handles unbounded volume.
    this.logger.warn(
      `sales_summary RPC unavailable, falling back to in-memory aggregation: ${rpcError?.message ?? 'no data'}`,
    );
    return this.computeSummaryInMemory(userId, filters);
  }

  private async computeSummaryInMemory(userId: string, filters: SalesFilters) {
    const client = this.supabase.getClient();
    const PAGE = 1000;
    const HARD_CAP = 50_000;
    type JoinName = { name: string | null } | { name: string | null }[] | null;
    type Row = {
      amount: number | string;
      status: string | null;
      product_name: string | null;
      customer_name: string | null;
      customer_state: string | null;
      sold_at: string;
      utm_content: string | null;
      ad_id: string | null;
      ads: JoinName;
      ad_sets: JoinName;
      campaigns: JoinName;
    };
    const rows: Row[] = [];

    for (let from = 0; from < HARD_CAP; from += PAGE) {
      let query = client
        .from('sales')
        .select(
          'amount, status, product_name, customer_name, customer_state, utm_content, ad_id, ad_set_id, campaign_id, sold_at, ads(name), ad_sets(name), campaigns(name)',
        )
        .eq('user_id', userId);

      if (filters.workspace_id) query = query.eq('workspace_id', filters.workspace_id);
      if (filters.from) query = query.gte('sold_at', toStartOfDayUTC(filters.from));
      if (filters.to) query = query.lt('sold_at', toExclusiveEndDate(filters.to));
      if (filters.checkout_ids && filters.checkout_ids.length > 0) {
        query = query.in('checkout_integration_id', filters.checkout_ids);
      }
      if (filters.product_names && filters.product_names.length > 0) {
        query = query.in('product_name', filters.product_names);
      }
      if (filters.campaign_ids && filters.campaign_ids.length > 0) {
        query = query.in('campaign_id', filters.campaign_ids);
      }
      if (filters.q) {
        const escaped = filters.q.replace(/[%_,()]/g, '');
        const pattern = `%${escaped}%`;
        query = query.or(
          `customer_email.ilike.${pattern},customer_name.ilike.${pattern},product_name.ilike.${pattern}`,
        );
      }

      query = query.order('sold_at', { ascending: false }).range(from, from + PAGE - 1);

      const { data, error } = await query;
      if (error) {
        throw new Error(error.message);
      }
      const chunk = (data ?? []) as unknown as Row[];
      rows.push(...chunk);
      if (chunk.length < PAGE) break;
    }

    const pickName = (v: JoinName): string | null => {
      if (!v) return null;
      if (Array.isArray(v)) return v[0]?.name ?? null;
      return v.name ?? null;
    };

    let approvedCount = 0;
    let grossRevenue = 0;
    let refundsCount = 0;
    const productMap = new Map<string, { count: number; revenue: number }>();
    const adMap = new Map<string, { count: number; revenue: number }>();
    const stateMap = new Map<string, number>();
    const refundedSample: Array<{ customer_name: string | null; customer_state: string | null; amount: number }> = [];

    for (const row of rows) {
      const amt = Number(row.amount) || 0;
      if (row.status === 'approved') {
        approvedCount += 1;
        grossRevenue += amt;

        const productKey = row.product_name ?? 'Sem produto';
        const productEntry = productMap.get(productKey) ?? { count: 0, revenue: 0 };
        productEntry.count += 1;
        productEntry.revenue += amt;
        productMap.set(productKey, productEntry);

        const utm = row.utm_content?.trim() || null;
        const adKey = utm || pickName(row.ads) || row.ad_id || 'Sem anúncio';
        const adEntry = adMap.get(adKey) ?? { count: 0, revenue: 0 };
        adEntry.count += 1;
        adEntry.revenue += amt;
        adMap.set(adKey, adEntry);
      } else if (row.status === 'refunded') {
        refundsCount += 1;
        const stateKey = (row.customer_state ?? '').toUpperCase().trim() || 'N/A';
        stateMap.set(stateKey, (stateMap.get(stateKey) ?? 0) + 1);
        if (refundedSample.length < 500) {
          refundedSample.push({
            customer_name: row.customer_name,
            customer_state: row.customer_state,
            amount: amt,
          });
        }
      }
    }

    const totalCount = approvedCount + refundsCount;
    const refundRate = totalCount > 0 ? (refundsCount / totalCount) * 100 : 0;
    const avgTicket = approvedCount > 0 ? grossRevenue / approvedCount : 0;

    const byProduct = Array.from(productMap.entries())
      .map(([product_name, v]) => ({ product_name, count: v.count, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const byAd = Array.from(adMap.entries())
      .map(([name, v]) => ({ name, count: v.count, revenue: v.revenue }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const refundsByState = Array.from(stateMap.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return {
      metrics: {
        approved_count: approvedCount,
        gross_revenue: grossRevenue,
        avg_ticket: avgTicket,
        refunds_count: refundsCount,
        refund_rate: refundRate,
      },
      by_product: byProduct,
      by_ad: byAd,
      refunds_by_state: refundsByState,
      refunded_sample: refundedSample,
    };
  }
}
