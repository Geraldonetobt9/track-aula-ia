import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';

const ALLOWED_FIELDS = [
  'max_sales_monthly',
  'max_active_ad_accounts',
  'max_checkout_integrations',
  'max_workspaces',
  'max_active_rules',
  'overage_price_cents',
] as const;

const SELECT_FIELDS =
  'id, plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations, max_workspaces, max_active_rules, overage_price_cents, stripe_price_id_base, updated_at';

const PLAN_RULES_CACHE_KEY = 'plan_rules:list';
const PLAN_RULES_TTL_MS = 60 * 1000;

@Injectable()
export class PlansService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async list() {
    const cached = this.cache.get<any[]>(PLAN_RULES_CACHE_KEY);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select(SELECT_FIELDS)
      .order('plan');

    if (error) throw error;
    this.cache.set(PLAN_RULES_CACHE_KEY, data, PLAN_RULES_TTL_MS);
    return data;
  }

  async getRulesForPlan(plan: string) {
    const cacheKey = `plan_rules:plan:${plan}`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select(SELECT_FIELDS)
      .eq('plan', plan)
      .single();

    if (error) throw error;
    this.cache.set(cacheKey, data, PLAN_RULES_TTL_MS);
    return data;
  }

  async getRulesForPlanId(planId: string) {
    const cacheKey = `plan_rules:id:${planId}`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select(SELECT_FIELDS)
      .eq('id', planId)
      .single();

    if (error) throw error;
    this.cache.set(cacheKey, data, PLAN_RULES_TTL_MS);
    return data;
  }

  async update(plan: string, updates: Record<string, unknown>) {
    if (!plan || !updates) {
      throw new BadRequestException('plan and updates required');
    }

    const safeUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const key of ALLOWED_FIELDS) {
      if (updates[key] !== undefined) {
        safeUpdates[key] = updates[key];
      }
    }

    const { error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .update(safeUpdates)
      .eq('plan', plan);

    if (error) throw error;
    this.cache.invalidateByPrefix('plan_rules:');
    return { success: true };
  }
}
