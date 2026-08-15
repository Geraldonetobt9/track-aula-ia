import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { LiveMetricsService } from '../metrics/live-metrics.service';
import {
  toStartOfDayUTC,
  toExclusiveEndDate,
} from '../../shared/helpers/date-range';

/** Mirrors the financial_entries_type_check constraint. */
const FINANCIAL_ENTRY_TYPES = ['expense', 'revenue', 'tax'];

@Injectable()
export class FinancialService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly liveMetrics: LiveMetricsService,
  ) {}

  private async verifyWorkspaceOwnership(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new ForbiddenException('Forbidden');
    }
  }

  /**
   * Earliest date worth asking Facebook about for an "all time" view.
   *
   * Without an explicit start, `aggregateAdSpend` falls back to the last 30
   * days — which silently pairs 30 days of ad spend with all-time revenue and
   * overstates profit. We anchor on the first sale instead, bounded by the
   * Graph API's insights retention window.
   */

  async getSummary(
    userId: string,
    workspaceId: string,
    range?: { referenceMonth?: string; from?: string; to?: string },
  ): Promise<{
    grossRevenue: number;
    adSpend: number;
    adSpendTax: number;
    adSpendTaxPercentage: number;
  }> {
    await this.verifyWorkspaceOwnership(workspaceId, userId);

    const client = this.supabase.getClient();

    let from: string | undefined = range?.from;
    let to: string | undefined = range?.to;

    if (!from && !to && range?.referenceMonth) {
      from = range.referenceMonth;
      const d = new Date(range.referenceMonth + 'T12:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      to = d.toISOString().slice(0, 10);
    }

    // Revenue aggregates over the whole table when unbounded, so ad spend has to
    // match that window instead of inheriting the 30-day default. Shared with
    // the Dashboard so both screens answer "todo período" identically.
    const adSpendFrom =
      from ?? (await this.liveMetrics.resolveAllTimeStart(userId, workspaceId));

    // Server-side SUM via RPC. The earlier `.select('amount').reduce(...)` was
    // silently capped at PostgREST's 1000-row default — the same bug the
    // dashboard already migrated away from in 20260428100000_dashboard_aggregation_rpcs.
    const fetchGrossRevenue = () =>
      client.rpc('dashboard_metrics', {
        p_user_id: userId,
        p_workspace_id: workspaceId,
        p_from: from ? toStartOfDayUTC(from) : null,
        p_to: to ? toExclusiveEndDate(to) : null,
        p_checkout_ids: null,
        p_product_names: null,
      });

    const fetchAdSpend = () =>
      this.liveMetrics.aggregateAdSpend(userId, {
        workspace_id: workspaceId,
        from: adSpendFrom,
        to,
      });

    const fetchTaxPercentage = () =>
      this.liveMetrics.getAdSpendTaxPercentage(userId, workspaceId);

    const [rpcResult, adSpendResult, taxPercentage] = await Promise.all([
      fetchGrossRevenue(),
      fetchAdSpend(),
      fetchTaxPercentage(),
    ]);

    if (rpcResult.error) {
      throw new Error(`[financial.summary:dashboard_metrics] ${rpcResult.error.message}`);
    }

    const grossRevenue = Number(
      (rpcResult.data as { gross_revenue?: number | string } | null)
        ?.gross_revenue ?? 0,
    );

    const adSpend = adSpendResult.total;

    // This is the Meta Ads tax only — a percentage over ad spend. The tax the
    // user types by hand is a separate 'tax' row in financial_entries, which
    // the frontend loads with the rest of the period's entries.
    return {
      grossRevenue,
      adSpend,
      adSpendTax: Math.round(adSpend * (taxPercentage / 100) * 100) / 100,
      adSpendTaxPercentage: taxPercentage,
    };
  }

  async list(
    userId: string,
    workspaceId: string,
    range?: { referenceMonth?: string; from?: string; to?: string },
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspace_id is required');
    }

    await this.verifyWorkspaceOwnership(workspaceId, userId);

    let query = this.supabase
      .getClient()
      .from('financial_entries')
      .select('id, type, name, amount, reference_month')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    // Entries are stamped with the first day of their month, so a year view is
    // just a bounded range over the same column.
    if (range?.from || range?.to) {
      if (range.from) query = query.gte('reference_month', range.from);
      if (range.to) query = query.lte('reference_month', range.to);
    } else if (range?.referenceMonth) {
      query = query.eq('reference_month', range.referenceMonth);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data ?? [];
  }

  async add(
    userId: string,
    body: {
      workspace_id: string;
      type: string;
      name: string;
      amount: number;
      reference_month: string;
    },
  ) {
    const { workspace_id, type, name, amount, reference_month } = body;

    if (!workspace_id || !type || !name || !reference_month) {
      throw new BadRequestException(
        'workspace_id, type, name e reference_month sao obrigatorios',
      );
    }

    if (!FINANCIAL_ENTRY_TYPES.includes(type)) {
      throw new BadRequestException('type invalido');
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new BadRequestException('amount invalido');
    }

    await this.verifyWorkspaceOwnership(workspace_id, userId);

    const { data, error } = await this.supabase
      .getClient()
      .from('financial_entries')
      .insert({
        user_id: userId,
        workspace_id,
        type,
        name: String(name).trim(),
        amount: numericAmount,
        reference_month,
      })
      .select('id, type, name, amount, reference_month')
      .single();

    if (error) throw error;
    return data;
  }

  async update(
    userId: string,
    id: string,
    workspaceId: string,
    updates: { name?: string; amount?: number },
  ) {
    if (!id || !workspaceId) {
      throw new BadRequestException('id e workspace_id sao obrigatorios');
    }

    await this.verifyWorkspaceOwnership(workspaceId, userId);

    const safeUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) safeUpdates.name = String(updates.name).trim();
    if (updates.amount !== undefined) {
      const numericAmount = Number(updates.amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new BadRequestException('amount invalido');
      }
      safeUpdates.amount = numericAmount;
    }

    if (Object.keys(safeUpdates).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('financial_entries')
      .update(safeUpdates)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .select('id, type, name, amount, reference_month')
      .single();

    if (error) throw error;
    return data;
  }

  async importEntries(
    userId: string,
    workspaceId: string,
    sourceMonth: string,
    targetMonth: string,
  ) {
    if (!workspaceId || !sourceMonth || !targetMonth) {
      throw new BadRequestException(
        'workspace_id, source_month e target_month sao obrigatorios',
      );
    }

    await this.verifyWorkspaceOwnership(workspaceId, userId);

    const client = this.supabase.getClient();

    // Fetch source entries
    const { data: sourceEntries, error: fetchErr } = await client
      .from('financial_entries')
      .select('type, name, amount')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('reference_month', sourceMonth);

    if (fetchErr) throw fetchErr;

    if (!sourceEntries || sourceEntries.length === 0) {
      return { data: [], message: 'Nenhum lancamento encontrado no mes de origem' };
    }

    // Insert copies for target month
    const toInsert = sourceEntries.map((e) => ({
      user_id: userId,
      workspace_id: workspaceId,
      type: e.type,
      name: e.name,
      amount: e.amount,
      reference_month: targetMonth,
    }));

    const { data: inserted, error: insertErr } = await client
      .from('financial_entries')
      .insert(toInsert)
      .select('id, type, name, amount, reference_month');

    if (insertErr) throw insertErr;

    return { data: inserted ?? [] };
  }

  async remove(userId: string, id: string, workspaceId: string) {
    if (!id || !workspaceId) {
      throw new BadRequestException('id e workspace_id sao obrigatorios');
    }

    await this.verifyWorkspaceOwnership(workspaceId, userId);

    const { error } = await this.supabase
      .getClient()
      .from('financial_entries')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  }
}
