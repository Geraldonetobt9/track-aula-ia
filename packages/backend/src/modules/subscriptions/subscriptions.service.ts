// packages/backend/src/modules/subscriptions/subscriptions.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { PlanLimitsService } from '../plan-limits/plan-limits.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';

export interface ApplyPlanChangeResult {
  unblocked_sales: number;
  trimmed: {
    workspaces: number;
    ad_accounts: number;
    integrations: number;
    rules: number;
  };
  old_plan: string;
  new_plan: string;
}

export interface ApplyPlanChangeOptions {
  periodStart?: string;
  periodEnd?: string;
}

interface PlanRuleRow {
  id: string;
  plan: string;
  max_sales_monthly: number;
  max_active_ad_accounts: number;
  max_checkout_integrations: number;
  max_workspaces: number;
  max_active_rules: number;
}

interface OldPlanRow {
  id: string;
  plan: string;
  max_sales_monthly: number;
}

interface SubscriptionRow {
  id: string;
  plan_id: string;
  user_id: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly planLimits: PlanLimitsService,
    private readonly discord: DiscordLoggerService,
  ) {}

  async applyPlanChange(
    userId: string,
    newPlanId: string,
    options: ApplyPlanChangeOptions = {},
  ): Promise<ApplyPlanChangeResult> {
    try {
      return await this.runApplyPlanChange(userId, newPlanId, options);
    } catch (error) {
      this.discord.logApiError({
        endpoint: 'applyPlanChange',
        userId,
        newPlanId,
        error,
      } as any);
      throw error;
    }
  }

  private async runApplyPlanChange(
    userId: string,
    newPlanId: string,
    options: ApplyPlanChangeOptions,
  ): Promise<ApplyPlanChangeResult> {
    const client = this.supabase.getClient();

    // Step 1: Fetch old subscription + new plan in parallel, then old plan.
    const [subRes, newPlanRes] = await Promise.all([
      client.from('subscriptions')
        .select('id, plan_id, user_id')
        .eq('user_id', userId)
        .maybeSingle(),
      client.from('plan_rules')
        .select('id, plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations, max_workspaces, max_active_rules')
        .eq('id', newPlanId)
        .maybeSingle(),
    ]);

    if (!newPlanRes.data) throw new Error(`Plan ${newPlanId} not found`);
    if (!subRes.data) throw new Error(`Subscription not found for user ${userId}`);

    const newPlan = newPlanRes.data as PlanRuleRow;
    const subscription = subRes.data as SubscriptionRow;

    const { data: oldPlanData } = await client.from('plan_rules')
      .select('id, plan, max_sales_monthly')
      .eq('id', subscription.plan_id)
      .maybeSingle();

    if (!oldPlanData) throw new Error(`Old plan ${subscription.plan_id} not found`);
    const oldPlan = oldPlanData as OldPlanRow;

    // Step 2: Upgrade unblock (if applicable).
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    let unblocked_sales = 0;

    if (newPlan.max_sales_monthly > oldPlan.max_sales_monthly || newPlan.max_sales_monthly === -1) {
      const { data, error } = await client.from('sales')
        .update({ blocked_by_limit: false })
        .eq('user_id', userId)
        .eq('blocked_by_limit', true)
        .gte('sold_at', thirtyDaysAgo)
        .select('id');
      if (error) throw error;
      unblocked_sales = data?.length ?? 0;
    }

    // Steps 3–6: Trim resources. Active workspace IDs are needed for steps 5 & 6.
    const trimmed = {
      workspaces: 0,
      ad_accounts: 0,
      integrations: 0,
      rules: 0,
    };

    trimmed.workspaces = await this.archiveExcessWorkspaces(userId, newPlan.max_workspaces, thirtyDaysAgo);

    trimmed.ad_accounts = await this.deactivateExcessAdAccounts(userId, newPlan.max_active_ad_accounts);

    const activeWorkspaceIds = await this.fetchActiveWorkspaceIds(userId);

    trimmed.integrations = await this.deactivateExcessIntegrations(userId, newPlan.max_checkout_integrations, activeWorkspaceIds, thirtyDaysAgo);

    trimmed.rules = await this.deactivateExcessRules(newPlan.max_active_rules, activeWorkspaceIds);

    // Step 7: Update subscription AND profile LAST — plan identity flips only after trims succeed.
    const now = new Date().toISOString();
    const currentPeriodStart = options.periodStart ?? now;
    const currentPeriodEnd = options.periodEnd ?? new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

    const { error: subErr } = await client.from('subscriptions').update({
      plan_id: newPlanId,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      scheduled_plan_id: null,
      scheduled_changes_at: null,
      updated_at: now,
    }).eq('user_id', userId);
    if (subErr) throw subErr;

    const { error: profErr } = await client.from('profiles').update({
      plan_id: newPlanId,
      updated_at: now,
    }).eq('user_id', userId);
    if (profErr) throw profErr;

    await this.planLimits.invalidate(userId);

    return {
      unblocked_sales,
      trimmed,
      old_plan: oldPlan.plan,
      new_plan: newPlan.plan,
    };
  }

  private async archiveExcessWorkspaces(userId: string, maxWorkspaces: number, thirtyDaysAgo: string): Promise<number> {
    if (maxWorkspaces === -1) return 0;

    const client = this.supabase.getClient();

    const { data: workspaces, error: wsErr } = await client.from('workspaces')
      .select('id, created_at')
      .eq('user_id', userId)
      .is('archived_at', null);
    if (wsErr) throw wsErr;

    if (!workspaces || workspaces.length <= maxWorkspaces) return 0;

    const { data: sales, error: salesErr } = await client.from('sales')
      .select('workspace_id, amount')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .eq('blocked_by_limit', false)
      .gte('sold_at', thirtyDaysAgo);
    if (salesErr) throw salesErr;

    const revenueByWorkspace = new Map<string, number>();
    for (const sale of sales ?? []) {
      const current = revenueByWorkspace.get(sale.workspace_id) ?? 0;
      revenueByWorkspace.set(sale.workspace_id, current + (sale.amount ?? 0));
    }

    const sorted = [...workspaces].sort((a, b) => {
      const revDiff = (revenueByWorkspace.get(b.id) ?? 0) - (revenueByWorkspace.get(a.id) ?? 0);
      if (revDiff !== 0) return revDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const excessIds = sorted.slice(maxWorkspaces).map((w) => w.id);
    if (excessIds.length === 0) return 0;

    const { error: archErr } = await client.from('workspaces')
      .update({ archived_at: new Date().toISOString(), archived_by_system: true })
      .in('id', excessIds);
    if (archErr) throw archErr;

    return excessIds.length;
  }

  private async deactivateExcessAdAccounts(userId: string, maxAdAccounts: number): Promise<number> {
    if (maxAdAccounts === -1) return 0;

    const client = this.supabase.getClient();

    const { data: adAccounts, error } = await client.from('facebook_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;

    if (!adAccounts || adAccounts.length <= maxAdAccounts) return 0;

    const excessIds = adAccounts.slice(maxAdAccounts).map((a) => a.id);

    const { error: updateErr } = await client.from('facebook_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', excessIds);
    if (updateErr) throw updateErr;

    return excessIds.length;
  }

  private async fetchActiveWorkspaceIds(userId: string): Promise<string[]> {
    const client = this.supabase.getClient();
    const { data, error } = await client.from('workspaces')
      .select('id')
      .eq('user_id', userId)
      .is('archived_at', null);
    if (error) throw error;
    return (data ?? []).map((w) => w.id);
  }

  private async deactivateExcessIntegrations(
    userId: string,
    maxIntegrations: number,
    activeWorkspaceIds: string[],
    thirtyDaysAgo: string,
  ): Promise<number> {
    if (maxIntegrations === -1) return 0;
    if (activeWorkspaceIds.length === 0) return 0;

    const client = this.supabase.getClient();

    const { data: integrations, error: intErr } = await client.from('checkout_integrations')
      .select('id, created_at, workspace_id')
      .eq('user_id', userId)
      .in('workspace_id', activeWorkspaceIds);
    if (intErr) throw intErr;

    if (!integrations || integrations.length <= maxIntegrations) return 0;

    const { data: sales, error: salesErr } = await client.from('sales')
      .select('integration_id')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .eq('blocked_by_limit', false)
      .gte('sold_at', thirtyDaysAgo);
    if (salesErr) throw salesErr;

    const salesByIntegration = new Map<string, number>();
    for (const sale of sales ?? []) {
      if (!sale.integration_id) continue;
      const current = salesByIntegration.get(sale.integration_id) ?? 0;
      salesByIntegration.set(sale.integration_id, current + 1);
    }

    const sorted = [...integrations].sort((a, b) => {
      const countDiff = (salesByIntegration.get(b.id) ?? 0) - (salesByIntegration.get(a.id) ?? 0);
      if (countDiff !== 0) return countDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const excessIds = sorted.slice(maxIntegrations).map((i) => i.id);

    const { error: updateErr } = await client.from('checkout_integrations')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', excessIds);
    if (updateErr) throw updateErr;

    return excessIds.length;
  }

  private async deactivateExcessRules(
    maxRules: number,
    activeWorkspaceIds: string[],
  ): Promise<number> {
    if (maxRules === -1) return 0;
    if (activeWorkspaceIds.length === 0) return 0;

    const client = this.supabase.getClient();

    const { data: rules, error } = await client.from('automation_rules')
      .select('id, last_executed_at, created_at')
      .eq('is_active', true)
      .in('workspace_id', activeWorkspaceIds);
    if (error) throw error;

    if (!rules || rules.length <= maxRules) return 0;

    const sorted = [...rules].sort((a, b) => {
      // last_executed_at DESC NULLS LAST
      if (a.last_executed_at === null && b.last_executed_at === null) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (a.last_executed_at === null) return 1;
      if (b.last_executed_at === null) return -1;
      const execDiff = new Date(b.last_executed_at).getTime() - new Date(a.last_executed_at).getTime();
      if (execDiff !== 0) return execDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const excessIds = sorted.slice(maxRules).map((r) => r.id);

    const { error: updateErr } = await client.from('automation_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', excessIds);
    if (updateErr) throw updateErr;

    return excessIds.length;
  }
}
