import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export interface ListUsersFilters {
  page?: number;
  limit?: number;
  search?: string;
  plan?: string;
  role?: string;
  facebook_status?: string;
}

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
  plan?: string;
  role?: string;
  cpf?: string;
  cnpj?: string;
  subscription_start?: string;
  subscription_end?: string;
}

export interface UpdateUserData {
  name?: string;
  plan?: string;
  role?: string;
  cpf?: string;
  cnpj?: string;
  subscription_start?: string;
  subscription_end?: string;
}

export interface ProxyQuery {
  key: string;
  table: string;
  select?: string;
  filters?: { column: string; op: string; value: any }[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
  range?: { from: number; to: number };
}

export interface AdminDashboardRecentUser {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  plan: string | null;
  created_at: string;
  facebook_connected: boolean | null;
}

export interface AdminDashboardSyncErrorUser {
  user_id: string;
  name: string | null;
  email: string | null;
  last_sync_error: string | null;
  last_sync_at: string | null;
}

export interface AdminListUserRow {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  cpf: string | null;
  plan: string | null;
  role: string;
  facebook_connected: boolean | null;
  campaigns_count: number;
  sales_count: number;
  total_revenue: number;
  subscription_start: string | null;
  subscription_end: string | null;
  last_sign_in_at: string | null;
}

interface AdminListUsersRpc {
  users: AdminListUserRow[];
  total_count: number | string;
  page: number | string;
  total_pages: number | string;
}

export interface AdminUserDetailProfile {
  user_id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  cpf: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  role: 'admin' | 'user';
  plan: string | null;
}

export interface AdminUserDetailSubscription {
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  scheduled_plan: string | null;
  scheduled_changes_at: string | null;
}

export interface AdminUserDetailFbConnection {
  id: string;
  ad_account_id: string;
  account_name: string | null;
  account_status: number | null;
  is_valid: boolean;
  is_active: boolean;
  facebook_user_id: string | null;
  facebook_user_name: string | null;
  last_validated_at: string | null;
  token_expires_at: string | null;
  created_at: string;
}

export interface AdminUserDetailSync {
  is_active: boolean;
  interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

export interface AdminUserDetailCheckout {
  id: string;
  platform: string;
  name: string;
  is_active: boolean;
  use_commission_value: boolean;
  last_webhook_at: string | null;
  created_at: string;
  webhook_url: string | null;
  webhook_secret_masked: string | null;
  api_token_masked: string | null;
  has_webhook_secret: boolean;
  has_api_token: boolean;
}

export interface AdminUserDetailRuleExecution {
  executed_at: string;
  status: 'success' | 'error';
  action_taken: string;
  entity_name: string | null;
  error_message: string | null;
}

export interface AdminUserDetailRule {
  id: string;
  workspace_id: string;
  workspace_name: string;
  name: string;
  is_active: boolean;
  target_entity: 'campaign' | 'adset' | 'ad';
  target_status: string;
  action_type: string;
  evaluation_period: string;
  frequency_minutes: number;
  conditions_count: number;
  last_executed_at: string | null;
  last_execution: AdminUserDetailRuleExecution | null;
}

export interface AdminUserDetailRpc {
  profile: AdminUserDetailProfile | null;
  subscription: AdminUserDetailSubscription | null;
  health: { sales_count: number | string; total_revenue: number | string };
  facebook: {
    connections_count: number | string;
    connections: AdminUserDetailFbConnection[];
    sync: AdminUserDetailSync | null;
  };
  checkouts: AdminUserDetailCheckout[];
  automation_rules: AdminUserDetailRule[];
}

interface AdminDashboardStatsRpc {
  total_users: number | string;
  active_users_30d: number | string;
  new_users_7d: number | string;
  facebook_connections_active: number | string;
  total_campaigns: number | string;
  total_sales: number | string;
  total_revenue: number | string;
  checkout_integrations_active: number | string;
  users_by_plan: Record<string, number>;
  new_users_by_day: { date: string; count: number }[];
  recent_users: AdminDashboardRecentUser[];
  users_with_sync_errors: AdminDashboardSyncErrorUser[];
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private async applyPlanChangeIfChanged(userId: string, newPlanName?: string): Promise<void> {
    if (!newPlanName) return;
    const { data: plan } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select('id')
      .eq('plan', newPlanName)
      .maybeSingle();
    if (!plan) throw new BadRequestException(`Unknown plan: ${newPlanName}`);
    await this.subscriptions.applyPlanChange(userId, plan.id);
  }

  async getStats() {
    const { data, error } = await this.supabase
      .getClient()
      .rpc('admin_dashboard_stats');

    if (error) {
      throw new Error(`[admin_dashboard_stats] ${error.message}`);
    }

    const row = data as AdminDashboardStatsRpc;

    return {
      total_users: Number(row.total_users) || 0,
      active_users_30d: Number(row.active_users_30d) || 0,
      new_users_7d: Number(row.new_users_7d) || 0,
      facebook_connections_active: Number(row.facebook_connections_active) || 0,
      total_campaigns: Number(row.total_campaigns) || 0,
      total_sales: Number(row.total_sales) || 0,
      total_revenue: Number(row.total_revenue) || 0,
      checkout_integrations_active: Number(row.checkout_integrations_active) || 0,
      users_by_plan: row.users_by_plan ?? {},
      new_users_by_day: row.new_users_by_day ?? [],
      recent_users: row.recent_users ?? [],
      users_with_sync_errors: row.users_with_sync_errors ?? [],
    };
  }

  async listUsers(filters: ListUsersFilters) {
    const { page = 1, limit = 20, search, plan, role, facebook_status } = filters;

    const { data, error } = await this.supabase
      .getClient()
      .rpc('admin_list_users', {
        p_search: search ?? null,
        p_plan: plan ?? null,
        p_role: role ?? null,
        p_facebook_status: facebook_status ?? null,
        p_page: page,
        p_limit: limit,
      });

    if (error) {
      throw new BadRequestException(`[admin_list_users] ${error.message}`);
    }

    const row = data as AdminListUsersRpc;

    return {
      users: row.users ?? [],
      total_count: Number(row.total_count) || 0,
      page: Number(row.page) || page,
      total_pages: Number(row.total_pages) || 1,
    };
  }

  async getUserDetail(userId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .rpc('admin_user_detail', { p_user_id: userId });

    if (error) {
      throw new BadRequestException(`[admin_user_detail] ${error.message}`);
    }

    const payload = data as AdminUserDetailRpc | null;
    if (!payload || !payload.profile) {
      throw new NotFoundException('User not found');
    }

    return payload;
  }

  async getCheckoutCredentials(userId: string, integrationId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('checkout_integrations')
      .select('webhook_url, webhook_secret, api_token')
      .eq('id', integrationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Checkout integration not found');
    }

    return {
      webhook_url: data.webhook_url ?? null,
      webhook_secret: data.webhook_secret ?? null,
      api_token: data.api_token ?? null,
    };
  }

  async createUser(data: CreateUserData) {
    const client = this.supabase.getClient();
    const {
      name,
      email,
      password,
      plan = 'starter',
      role = 'user',
      cpf,
      cnpj,
      subscription_start,
      subscription_end,
    } = data;

    if (!name || !email || !password) {
      throw new BadRequestException('Name, email, and password are required');
    }

    if (cpf) {
      const { data: existingCpf } = await client
        .from('profiles')
        .select('user_id')
        .eq('cpf', cpf)
        .maybeSingle();
      if (existingCpf) {
        throw new BadRequestException('Ja existe um usuario cadastrado com este CPF');
      }
    }
    if (cnpj) {
      const { data: existingCnpj } = await client
        .from('profiles')
        .select('user_id')
        .eq('cnpj', cnpj)
        .maybeSingle();
      if (existingCnpj) {
        throw new BadRequestException('Ja existe um usuario cadastrado com este CNPJ');
      }
    }

    // Create user via Admin API
    const { data: newUser, error: createError } =
      await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });

    if (createError) {
      throw new BadRequestException(createError.message);
    }

    // Wait for the trigger (handle_new_user) to create profile and role
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Update role if admin
    if (role === 'admin') {
      await client
        .from('user_roles')
        .update({ role: 'admin' })
        .eq('user_id', newUser.user.id);
    }

    // Update profile fields
    const profileUpdates: Record<string, any> = {};
    if (cpf) profileUpdates.cpf = cpf;
    if (cnpj) profileUpdates.cnpj = cnpj;
    if (subscription_start)
      profileUpdates.subscription_start = subscription_start;
    if (subscription_end) profileUpdates.subscription_end = subscription_end;

    if (Object.keys(profileUpdates).length > 0) {
      await client
        .from('profiles')
        .update(profileUpdates)
        .eq('user_id', newUser.user.id);
    }

    if (plan) {
      await this.applyPlanChangeIfChanged(newUser.user.id, plan);
    }

    return { success: true, user_id: newUser.user.id };
  }

  async updateUser(userId: string, data: UpdateUserData) {
    const client = this.supabase.getClient();
    const { name, plan, role, cpf, cnpj, subscription_start, subscription_end } = data;

    if (cpf) {
      const { data: existingCpf } = await client
        .from('profiles')
        .select('user_id')
        .eq('cpf', cpf)
        .neq('user_id', userId)
        .maybeSingle();
      if (existingCpf) {
        throw new BadRequestException('Ja existe um usuario cadastrado com este CPF');
      }
    }
    if (cnpj) {
      const { data: existingCnpj } = await client
        .from('profiles')
        .select('user_id')
        .eq('cnpj', cnpj)
        .neq('user_id', userId)
        .maybeSingle();
      if (existingCnpj) {
        throw new BadRequestException('Ja existe um usuario cadastrado com este CNPJ');
      }
    }

    // Update profile
    const profileUpdates: Record<string, any> = {};
    if (name !== undefined) profileUpdates.name = name;
    if (cpf !== undefined) profileUpdates.cpf = cpf;
    if (cnpj !== undefined) profileUpdates.cnpj = cnpj;
    if (subscription_start !== undefined)
      profileUpdates.subscription_start = subscription_start;
    if (subscription_end !== undefined)
      profileUpdates.subscription_end = subscription_end;

    if (Object.keys(profileUpdates).length > 0) {
      this.logger.log(`Updating profile for ${userId}: ${JSON.stringify(profileUpdates)}`);
      const { error: updateError } = await client
        .from('profiles')
        .update(profileUpdates)
        .eq('user_id', userId)
        .select();

      if (updateError) {
        throw new BadRequestException(
          `Failed to update profile: ${updateError.message}`,
        );
      }
    }

    // Update role
    if (role !== undefined) {
      await client
        .from('user_roles')
        .update({ role })
        .eq('user_id', userId);
    }

    await this.applyPlanChangeIfChanged(userId, plan);

    return { success: true };
  }

  async deleteUser(userId: string, callerUserId: string) {
    if (userId === callerUserId) {
      throw new ForbiddenException('Nao e possivel excluir sua propria conta');
    }

    const client = this.supabase.getClient();

    // Delete user via Admin API (CASCADE will remove related data)
    const { error } = await client.auth.admin.deleteUser(userId);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { success: true };
  }

  async forceSync(userId: string) {
    const client = this.supabase.getClient();

    // Get Facebook connection
    const { data: connection, error: connError } = await client
      .from('facebook_connections')
      .select('id, user_id, is_valid')
      .eq('user_id', userId)
      .maybeSingle();

    if (connError || !connection) {
      throw new NotFoundException('Facebook connection not found');
    }

    if (!connection.is_valid) {
      throw new BadRequestException('Facebook connection is invalid');
    }

    // Update sync schedule to trigger sync
    await client
      .from('sync_schedules')
      .update({
        next_sync_at: new Date().toISOString(),
        last_sync_status: 'pending',
      })
      .eq('user_id', userId);

    return { success: true, message: 'Sync scheduled' };
  }

  async proxyQuery(targetUserId: string, queries: ProxyQuery[]) {
    if (!targetUserId || !queries || !Array.isArray(queries)) {
      throw new BadRequestException('Missing user_id or queries');
    }

    const client = this.supabase.getClient();
    const results: Record<string, any> = {};

    for (const q of queries) {
      try {
        let query = client.from(q.table).select(q.select || '*');

        // Always filter by user_id
        query = query.eq('user_id', targetUserId);

        // Apply additional filters
        if (q.filters && Array.isArray(q.filters)) {
          for (const f of q.filters) {
            switch (f.op) {
              case 'eq':
                query = query.eq(f.column, f.value);
                break;
              case 'neq':
                query = query.neq(f.column, f.value);
                break;
              case 'gt':
                query = query.gt(f.column, f.value);
                break;
              case 'gte':
                query = query.gte(f.column, f.value);
                break;
              case 'lt':
                query = query.lt(f.column, f.value);
                break;
              case 'lte':
                query = query.lte(f.column, f.value);
                break;
              case 'in':
                query = query.in(f.column, f.value);
                break;
              case 'is':
                query = query.is(f.column, f.value);
                break;
              case 'like':
                query = query.like(f.column, f.value);
                break;
              case 'ilike':
                query = query.ilike(f.column, f.value);
                break;
              case 'not_is':
                query = query.not(f.column, 'is', f.value);
                break;
            }
          }
        }

        // Order
        if (q.order) {
          query = query.order(q.order.column, {
            ascending: q.order.ascending ?? true,
          });
        }

        // Limit
        if (q.limit) {
          query = query.limit(q.limit);
        }

        // Range (for pagination)
        if (q.range && q.range.from !== undefined && q.range.to !== undefined) {
          query = query.range(q.range.from, q.range.to);
        }

        const { data, error } = await query;
        results[q.key] = { data: data || [], error: error?.message || null };
      } catch (e: any) {
        results[q.key] = { data: [], error: e.message };
      }
    }

    return results;
  }
}
