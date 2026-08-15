import type { SupabaseClient } from '@supabase/supabase-js';

export interface DbSnapshot {
  subscription: {
    plan_id: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    scheduled_plan_id: string | null;
    scheduled_changes_at: string | null;
  } | null;
  profile: { plan_id: string | null } | null;
  sales: { approved: number; blocked: number; refunded: number };
  usage_overage: Array<{
    id: string;
    price_cents: number;
    reported_to_stripe_at: string | null;
    created_at: string;
  }>;
  workspaces: Array<{
    id: string;
    archived_at: string | null;
    archived_by_system: boolean;
  }>;
  ad_accounts_active: number;
  integrations_active: number;
  rules_active: number;
  stripe_webhook_events_seen: string[];
}

export async function dbSnapshot(client: SupabaseClient, userId: string): Promise<DbSnapshot> {
  const [
    subRes,
    profileRes,
    approvedRes,
    blockedRes,
    refundedRes,
    overageRes,
    workspacesRes,
    adAccountsRes,
    integrationsRes,
    rulesRes,
    eventsRes,
  ] = await Promise.all([
    client.from('subscriptions')
      .select('plan_id, current_period_start, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, scheduled_plan_id, scheduled_changes_at')
      .eq('user_id', userId)
      .maybeSingle(),
    client.from('profiles').select('plan_id').eq('user_id', userId).maybeSingle(),
    client.from('sales').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'approved').eq('blocked_by_limit', false),
    client.from('sales').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'approved').eq('blocked_by_limit', true),
    client.from('sales').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'refunded'),
    client.from('usage_overage')
      .select('id, price_cents, reported_to_stripe_at, created_at')
      .eq('user_id', userId),
    client.from('workspaces').select('id, archived_at, archived_by_system').eq('user_id', userId),
    client.from('facebook_connections').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('is_active', true),
    client.from('checkout_integrations').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('is_active', true),
    client.from('automation_rules').select('id, workspaces!inner(user_id)', { count: 'exact', head: true })
      .eq('is_active', true).eq('workspaces.user_id', userId),
    client.from('stripe_webhook_events').select('id').order('received_at', { ascending: false }).limit(50),
  ]);

  return {
    subscription: (subRes.data as any) ?? null,
    profile: (profileRes.data as any) ?? null,
    sales: {
      approved: approvedRes.count ?? 0,
      blocked: blockedRes.count ?? 0,
      refunded: refundedRes.count ?? 0,
    },
    usage_overage: (overageRes.data as any[]) ?? [],
    workspaces: (workspacesRes.data as any[]) ?? [],
    ad_accounts_active: adAccountsRes.count ?? 0,
    integrations_active: integrationsRes.count ?? 0,
    rules_active: rulesRes.count ?? 0,
    stripe_webhook_events_seen: ((eventsRes.data as any[]) ?? []).map((row) => row.id),
  };
}
