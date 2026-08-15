// packages/backend/src/modules/plan-limits/plan-limits.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';
import {
  PlanLimitExceededException,
  PlanLimitResource,
} from './plan-limit-exceeded.exception';

const CACHE_TTL_PLAN_MS = 30_000;
const CACHE_TTL_COUNTS_MS = 10_000;

interface ResolvedPlan {
  subscription: {
    id: string;
    user_id: string;
    plan_id: string;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    scheduled_plan_id: string | null;
    scheduled_changes_at: string | null;
  };
  plan: {
    id: string;
    plan: string;
    max_sales_monthly: number;
    max_active_ad_accounts: number;
    max_checkout_integrations: number;
    max_workspaces: number;
    max_active_rules: number;
    overage_price_cents: number;
  };
}

export type SaleDecision =
  | { allowed: true; blocked_by_limit: false; overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: false; overage: true; pricePerSaleCents: number;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: true; overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string };

export interface UsageSnapshot {
  plan: string;
  period: { start: string; end: string };
  sales:        { used: number; limit: number; blocked: number };
  workspaces:   { used: number; limit: number };
  adAccounts:   { used: number; limit: number };
  integrations: { used: number; limit: number };
  activeRules:  { used: number; limit: number };
  overage:      { count: number; totalCents: number };
  subscription: {
    status: 'active' | 'past_due' | 'canceled' | null;
    next_billing_date: string | null;
    cancel_at_period_end: boolean;
    scheduled_plan: { slug: string; changes_at: string } | null;
    has_stripe_customer: boolean;
  };
}

@Injectable()
export class PlanLimitsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private async resolveUserPlan(userId: string): Promise<ResolvedPlan> {
    const cacheKey = `plan_limits:user:${userId}:plan`;
    const cached = this.cache.get<ResolvedPlan>(cacheKey);
    if (cached) return cached;

    const client = this.supabase.getClient();

    const { data: subscription, error: subErr } = await client
      .from('subscriptions')
      .select('id, user_id, plan_id, current_period_start, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, scheduled_plan_id, scheduled_changes_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!subscription) throw new Error(`No subscription for user ${userId}`);

    const { data: plan, error: planErr } = await client
      .from('plan_rules')
      .select(
        'id, plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations, max_workspaces, max_active_rules, overage_price_cents',
      )
      .eq('id', subscription.plan_id)
      .single();
    if (planErr) throw planErr;

    const resolved: ResolvedPlan = {
      subscription: subscription as any,
      plan: plan as any,
    };
    this.cache.set(cacheKey, resolved, CACHE_TTL_PLAN_MS);
    return resolved;
  }

  async invalidate(userId: string): Promise<void> {
    this.cache.invalidateByPrefix(`plan_limits:user:${userId}`);
  }

  private async countActive(
    userId: string,
    period: { current_period_start: string; current_period_end: string },
  ): Promise<{
    workspaces: number;
    ad_accounts: number;
    integrations: number;
    rules: number;
    sales: number;
  }> {
    const cacheKey = `plan_limits:user:${userId}:counts`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const client = this.supabase.getClient();

    const [workspaces, adAccounts, integrations, rules, sales] = await Promise.all([
      client
        .from('workspaces')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('archived_at', null),
      client
        .from('facebook_connections')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_active', true),
      client
        .from('checkout_integrations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      client
        .from('automation_rules')
        .select('*, workspaces!inner(user_id, archived_at)', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('workspaces.user_id', userId)
        .is('workspaces.archived_at', null),
      client
        .from('sales')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'approved')
        .eq('blocked_by_limit', false)
        .eq('source', 'webhook')
        .gte('sold_at', period.current_period_start)
        .lt('sold_at', period.current_period_end),
    ]);

    const counts = {
      workspaces: workspaces.count ?? 0,
      ad_accounts: adAccounts.count ?? 0,
      integrations: integrations.count ?? 0,
      rules: rules.count ?? 0,
      sales: sales.count ?? 0,
    };
    this.cache.set(cacheKey, counts, CACHE_TTL_COUNTS_MS);
    return counts;
  }

  private async countBlockedSales(
    userId: string,
    period: { current_period_start: string; current_period_end: string },
  ): Promise<number> {
    const { count } = await this.supabase.getClient()
      .from('sales')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'approved')
      .eq('blocked_by_limit', true)
      .gte('sold_at', period.current_period_start)
      .lt('sold_at', period.current_period_end);
    return count ?? 0;
  }

  private async getOverageTotals(
    userId: string,
    period: { current_period_start: string; current_period_end: string },
  ): Promise<{ count: number; totalCents: number }> {
    const { data, error } = await this.supabase.getClient()
      .from('usage_overage')
      .select('price_cents')
      .eq('user_id', userId)
      .gte('period_start', period.current_period_start)
      .lt('period_end', period.current_period_end);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ price_cents: number }>;
    return {
      count: rows.length,
      totalCents: rows.reduce((sum, r) => sum + r.price_cents, 0),
    };
  }

  async assertCanCreateWorkspace(userId: string): Promise<void> {
    await this.assertLimit(userId, 'workspace', 'workspaces', 'max_workspaces');
  }

  async assertCanCreateIntegration(userId: string): Promise<void> {
    await this.assertLimit(userId, 'integration', 'integrations', 'max_checkout_integrations');
  }

  async assertCanActivateAdAccount(userId: string, _adAccountId: string): Promise<void> {
    await this.assertLimit(userId, 'ad_account', 'ad_accounts', 'max_active_ad_accounts');
  }

  async assertCanActivateRule(userId: string, _ruleId: string): Promise<void> {
    await this.assertLimit(userId, 'active_rule', 'rules', 'max_active_rules');
  }

  private async assertLimit(
    userId: string,
    resource: PlanLimitResource,
    countKey: 'workspaces' | 'ad_accounts' | 'integrations' | 'rules',
    planField: 'max_workspaces' | 'max_checkout_integrations' | 'max_active_ad_accounts' | 'max_active_rules',
  ): Promise<void> {
    const { plan, subscription } = await this.resolveUserPlan(userId);
    const limit = (plan as any)[planField] as number;
    if (limit === -1) return;
    const counts = await this.countActive(userId, subscription);
    const current = counts[countKey];
    if (current >= limit) {
      throw new PlanLimitExceededException({
        resource,
        current,
        limit,
        plan: plan.plan,
      });
    }
  }

  async checkSaleAcceptance(userId: string): Promise<SaleDecision> {
    const { plan, subscription } = await this.resolveUserPlan(userId);

    const base = {
      subscriptionId: subscription.id,
      periodStart: subscription.current_period_start,
      periodEnd: subscription.current_period_end,
    };

    if (plan.max_sales_monthly === -1) {
      return { ...base, allowed: true, blocked_by_limit: false, overage: false };
    }

    const counts = await this.countActive(userId, subscription);

    if (counts.sales < plan.max_sales_monthly) {
      return { ...base, allowed: true, blocked_by_limit: false, overage: false };
    }

    // Acima do limite — Free bloqueia; pagos caem em overage.
    if (plan.overage_price_cents === 0) {
      return { ...base, allowed: true, blocked_by_limit: true, overage: false };
    }

    return {
      ...base,
      allowed: true,
      blocked_by_limit: false,
      overage: true,
      pricePerSaleCents: plan.overage_price_cents,
    };
  }

  async getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
    const { plan, subscription } = await this.resolveUserPlan(userId);
    const [counts, blocked, overageTotals, scheduledPlan] = await Promise.all([
      this.countActive(userId, subscription),
      this.countBlockedSales(userId, subscription),
      this.getOverageTotals(userId, subscription),
      this.resolveScheduledPlan(subscription.scheduled_plan_id),
    ]);

    const status: 'active' | null = subscription.stripe_subscription_id ? 'active' : null;

    return {
      plan: plan.plan,
      period: {
        start: subscription.current_period_start,
        end: subscription.current_period_end,
      },
      sales:        { used: counts.sales, limit: plan.max_sales_monthly, blocked },
      workspaces:   { used: counts.workspaces, limit: plan.max_workspaces },
      adAccounts:   { used: counts.ad_accounts, limit: plan.max_active_ad_accounts },
      integrations: { used: counts.integrations, limit: plan.max_checkout_integrations },
      activeRules:  { used: counts.rules, limit: plan.max_active_rules },
      overage:      overageTotals,
      subscription: {
        status,
        next_billing_date: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        scheduled_plan: scheduledPlan && subscription.scheduled_changes_at
          ? { slug: scheduledPlan, changes_at: subscription.scheduled_changes_at }
          : null,
        has_stripe_customer: !!subscription.stripe_customer_id,
      },
    };
  }

  private async resolveScheduledPlan(planId: string | null): Promise<string | null> {
    if (!planId) return null;
    const { data } = await this.supabase.getClient()
      .from('plan_rules')
      .select('plan')
      .eq('id', planId)
      .maybeSingle();
    return data?.plan ?? null;
  }
}
