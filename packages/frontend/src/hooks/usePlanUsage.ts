import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type UsageSnapshot = {
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
};

type Resource = 'workspace' | 'integration' | 'adAccount' | 'rule';

const RESOURCE_KEY: Record<
  Resource,
  'workspaces' | 'integrations' | 'adAccounts' | 'activeRules'
> = {
  workspace:   'workspaces',
  integration: 'integrations',
  adAccount:   'adAccounts',
  rule:        'activeRules',
};

export function usePlanUsage() {
  const query = useQuery<UsageSnapshot>({
    queryKey: ['plan-usage'],
    queryFn: () => api.get<UsageSnapshot>('/plan-limits/usage'),
    staleTime: 30_000,
  });

  const usage = query.data;

  function remaining(resource: Resource): number | null {
    if (!usage) return null;
    const { used, limit } = usage[RESOURCE_KEY[resource]];
    if (limit === -1) return Infinity as any;
    return Math.max(0, limit - used);
  }

  function canCreate(resource: 'workspace' | 'integration'): boolean {
    const r = remaining(resource);
    return r === null || r > 0;
  }

  function canActivate(resource: 'adAccount' | 'rule'): boolean {
    const r = remaining(resource);
    return r === null || r > 0;
  }

  function isAtLimit(resource: Resource): boolean {
    const r = remaining(resource);
    return r !== null && r === 0;
  }

  function isNearLimit(resource: Resource, threshold = 0.9): boolean {
    if (!usage) return false;
    const { used, limit } = usage[RESOURCE_KEY[resource]];
    if (limit === -1) return false;
    return used / limit >= threshold;
  }

  return {
    usage,
    isLoading: query.isLoading,
    canCreate,
    canActivate,
    isAtLimit,
    isNearLimit,
    remaining,
  };
}
