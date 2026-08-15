import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';
import { PlanLimitsService } from '../plan-limits/plan-limits.service';

@Injectable()
export class IntegrationsService {
  constructor(
    private supabase: SupabaseService,
    private discordLogger: DiscordLoggerService,
    private planLimits: PlanLimitsService,
  ) {}

  // Checkout integrations
  async listCheckoutIntegrations(userId: string, workspaceId?: string) {
    const db = this.supabase.getClient();
    let query = db.from('checkout_integrations').select('id, platform, name, webhook_secret, is_active, last_webhook_at, use_commission_value').eq('user_id', userId);
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    const { data, error } = await query.order('created_at');
    if (error) throw error;
    return data || [];
  }

  async saveCheckoutIntegration(userId: string, body: any) {
    const db = this.supabase.getClient();
    if (body.id) {
      const { id, ...updates } = body;
      const { data, error } = await db.from('checkout_integrations').update(updates).eq('id', id).eq('user_id', userId).select().single();
      if (error) throw error;
      return data;
    }

    await this.planLimits.assertCanCreateIntegration(userId);

    const insertPayload: Record<string, unknown> = { ...body, user_id: userId };
    if (body.workspace_id) {
      insertPayload.workspace_id = body.workspace_id;
    }
    const { data, error } = await db.from('checkout_integrations').insert(insertPayload).select().single();
    if (error) throw error;

    await this.planLimits.invalidate(userId);

    // Discord log — fire-and-forget
    this.logIntegrationEvent(db, userId, body.workspace_id, body.platform, 'created');

    return data;
  }

  async toggleCheckoutIntegration(userId: string, id: string, isActive: boolean) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('checkout_integrations').update({ is_active: isActive }).eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
  }

  async deleteCheckoutIntegration(userId: string, id: string) {
    const db = this.supabase.getClient();

    // Fetch integration before deleting (for Discord log)
    const { data: integration } = await db
      .from('checkout_integrations')
      .select('platform, workspace_id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    const { error } = await db.from('checkout_integrations').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;

    // Discord log — fire-and-forget
    if (integration) {
      this.logIntegrationEvent(db, userId, integration.workspace_id, integration.platform, 'removed');
    }

    return { success: true };
  }

  // Company costs
  async listCompanyCosts(userId: string, workspaceId?: string) {
    const db = this.supabase.getClient();
    let query = db.from('company_costs').select('id, name, type, value').eq('user_id', userId);
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    const { data, error } = await query.order('created_at');
    if (error) throw error;
    return data || [];
  }

  async addCompanyCost(userId: string, body: { name: string; type: string; value: number; workspace_id?: string }) {
    const db = this.supabase.getClient();
    const insertPayload: Record<string, unknown> = { user_id: userId, name: body.name, type: body.type, value: body.value };
    if (body.workspace_id) {
      insertPayload.workspace_id = body.workspace_id;
    }
    const { data, error } = await db.from('company_costs').insert(insertPayload).select().single();
    if (error) throw error;
    return data;
  }

  async removeCompanyCost(userId: string, id: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('company_costs').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }

  // Sync schedules
  async getSyncSchedules(userId: string, workspaceId?: string) {
    const db = this.supabase.getClient();
    let query = db.from('sync_schedules').select('id, user_id, sync_type, interval_minutes, is_active, last_sync_at, next_sync_at, last_sync_status, last_sync_error, last_sync_duration_ms, synced_campaigns, synced_ad_sets, synced_ads, consecutive_errors, created_at, updated_at').eq('user_id', userId);
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async updateSyncSchedule(userId: string, id: string, updates: any) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('sync_schedules').update(updates).eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
  }

  async createSyncSchedule(userId: string, body: any) {
    const db = this.supabase.getClient();
    const upsertPayload: Record<string, unknown> = { ...body, user_id: userId };
    if (body.workspace_id) {
      upsertPayload.workspace_id = body.workspace_id;
    }
    const { data, error } = await db.from('sync_schedules').upsert(upsertPayload, { onConflict: 'user_id,sync_type' }).select().single();
    if (error) throw error;
    return data;
  }

  async getSyncLogs(userId: string, limit = 20, workspaceId?: string) {
    const db = this.supabase.getClient();
    let query = db.from('sync_logs').select('id, user_id, sync_schedule_id, sync_type, status, started_at, finished_at, duration_ms, campaigns_synced, ad_sets_synced, ads_synced, sales_rematched, error_message, created_at').eq('user_id', userId);
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }

  private logIntegrationEvent(
    db: ReturnType<SupabaseService['getClient']>,
    userId: string,
    workspaceId: string | null,
    platform: string,
    event: 'created' | 'removed',
  ): void {
    Promise.allSettled([
      db.from('profiles').select('email').eq('id', userId).maybeSingle(),
      workspaceId
        ? db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]).then(([profileRes, wsRes]) => {
      const email = (profileRes as any).value?.data?.email || userId;
      const wsName = (wsRes as any).value?.data?.name || '—';
      const logData = { userEmail: email, workspaceName: wsName, platform };
      if (event === 'created') {
        this.discordLogger.logIntegrationCreated(logData);
      } else {
        this.discordLogger.logIntegrationRemoved(logData);
      }
    });
  }
}
