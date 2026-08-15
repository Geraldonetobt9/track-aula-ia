import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
export interface DateRangeFilters {
  from?: string;
  to?: string;
  workspace_id?: string;
}

export interface AdSetFilters extends DateRangeFilters {
  campaign_id?: string;
}

export interface AdFilters extends DateRangeFilters {
  ad_set_id?: string;
}

export interface SyncLogFilters {
  limit?: number;
  workspace_id?: string;
}

@Injectable()
export class MetricsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Returns IDs of facebook_connections where is_active = true for this user.
   * All ad-spend queries must be filtered to only include data from active connections.
   */
  private async getActiveConnectionIds(userId: string, workspaceId?: string): Promise<string[]> {
    const client = this.supabase.getClient();
    let query = client
      .from('facebook_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map((c) => c.id);
  }

  async getCampaigns(userId: string, filters: DateRangeFilters) {
    const client = this.supabase.getClient();
    const activeConnIds = await this.getActiveConnectionIds(userId, filters.workspace_id);
    if (activeConnIds.length === 0) return [];

    // Fetch daily spend rows for the period — only from active connections
    let spendQuery = client
      .from('daily_ad_spend')
      .select('campaign_id, spend, impressions, clicks, conversions')
      .eq('user_id', userId)
      .in('facebook_connection_id', activeConnIds)
      .not('campaign_id', 'is', null);

    if (filters.workspace_id) spendQuery = spendQuery.eq('workspace_id', filters.workspace_id);
    if (filters.from) spendQuery = spendQuery.gte('date', filters.from);
    if (filters.to) spendQuery = spendQuery.lte('date', filters.to);

    const { data: dailyRows, error: spendError } = await spendQuery;
    if (spendError) throw new Error(spendError.message);
    if (!dailyRows || dailyRows.length === 0) return [];

    // Aggregate metrics by campaign_id
    const metricsMap = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>();
    for (const row of dailyRows) {
      const id = row.campaign_id as string;
      const existing = metricsMap.get(id);
      if (existing) {
        existing.spend += row.spend ?? 0;
        existing.impressions += row.impressions ?? 0;
        existing.clicks += row.clicks ?? 0;
        existing.conversions += row.conversions ?? 0;
      } else {
        metricsMap.set(id, {
          spend: row.spend ?? 0,
          impressions: row.impressions ?? 0,
          clicks: row.clicks ?? 0,
          conversions: row.conversions ?? 0,
        });
      }
    }

    const campaignIds = [...metricsMap.keys()];

    // Fetch campaign metadata for active campaigns
    let campQuery = client
      .from('campaigns')
      .select('id, user_id, facebook_campaign_id, name, status, objective, date_start, date_end, daily_budget, lifetime_budget, synced_at, created_at, updated_at, facebook_connection_id')
      .eq('user_id', userId)
      .in('id', campaignIds)
      .order('name', { ascending: true });

    if (filters.workspace_id) {
      campQuery = campQuery.eq('workspace_id', filters.workspace_id);
    }

    const { data: campaigns, error: campError } = await campQuery;

    if (campError) throw new Error(campError.message);

    // Combine metadata with aggregated metrics
    return (campaigns || []).map((c) => {
      const m = metricsMap.get(c.id)!;
      const totalImpressions = m.impressions || 0;
      const totalClicks = m.clicks || 0;
      const totalSpend = m.spend || 0;
      return {
        ...c,
        spend: totalSpend,
        impressions: totalImpressions,
        clicks: totalClicks,
        conversions: m.conversions,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
        cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      };
    });
  }

  async getAdSets(userId: string, filters: AdSetFilters) {
    const client = this.supabase.getClient();
    const activeConnIds = await this.getActiveConnectionIds(userId, filters.workspace_id);
    if (activeConnIds.length === 0) return [];

    // Fetch daily spend rows for the period — only from active connections
    let spendQuery = client
      .from('daily_ad_spend')
      .select('ad_set_id, spend, impressions, clicks, conversions')
      .eq('user_id', userId)
      .in('facebook_connection_id', activeConnIds)
      .not('ad_set_id', 'is', null);

    if (filters.workspace_id) spendQuery = spendQuery.eq('workspace_id', filters.workspace_id);
    if (filters.from) spendQuery = spendQuery.gte('date', filters.from);
    if (filters.to) spendQuery = spendQuery.lte('date', filters.to);

    const { data: dailyRows, error: spendError } = await spendQuery;
    if (spendError) throw new Error(spendError.message);
    if (!dailyRows || dailyRows.length === 0) return [];

    // Aggregate metrics by ad_set_id
    const metricsMap = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>();
    for (const row of dailyRows) {
      const id = row.ad_set_id as string;
      const existing = metricsMap.get(id);
      if (existing) {
        existing.spend += row.spend ?? 0;
        existing.impressions += row.impressions ?? 0;
        existing.clicks += row.clicks ?? 0;
        existing.conversions += row.conversions ?? 0;
      } else {
        metricsMap.set(id, {
          spend: row.spend ?? 0,
          impressions: row.impressions ?? 0,
          clicks: row.clicks ?? 0,
          conversions: row.conversions ?? 0,
        });
      }
    }

    const adSetIds = [...metricsMap.keys()];

    // Fetch ad set metadata
    let metaQuery = client
      .from('ad_sets')
      .select('id, user_id, campaign_id, facebook_adset_id, name, status, date_start, date_end, daily_budget, lifetime_budget, synced_at, created_at, updated_at, facebook_connection_id')
      .eq('user_id', userId)
      .in('id', adSetIds)
      .order('name', { ascending: true });

    if (filters.workspace_id) {
      metaQuery = metaQuery.eq('workspace_id', filters.workspace_id);
    }
    if (filters.campaign_id) {
      metaQuery = metaQuery.eq('campaign_id', filters.campaign_id);
    }

    const { data: adSets, error: asError } = await metaQuery;
    if (asError) throw new Error(asError.message);

    return (adSets || []).map((a) => {
      const m = metricsMap.get(a.id)!;
      const totalImpressions = m.impressions || 0;
      const totalClicks = m.clicks || 0;
      const totalSpend = m.spend || 0;
      return {
        ...a,
        spend: totalSpend,
        impressions: totalImpressions,
        clicks: totalClicks,
        conversions: m.conversions,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
        cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      };
    });
  }

  async getAds(userId: string, filters: AdFilters) {
    const client = this.supabase.getClient();
    const activeConnIds = await this.getActiveConnectionIds(userId, filters.workspace_id);
    if (activeConnIds.length === 0) return [];

    // Fetch daily spend rows for the period — only from active connections
    let spendQuery = client
      .from('daily_ad_spend')
      .select('ad_id, spend, impressions, clicks, conversions')
      .eq('user_id', userId)
      .in('facebook_connection_id', activeConnIds)
      .not('ad_id', 'is', null);

    if (filters.workspace_id) spendQuery = spendQuery.eq('workspace_id', filters.workspace_id);
    if (filters.from) spendQuery = spendQuery.gte('date', filters.from);
    if (filters.to) spendQuery = spendQuery.lte('date', filters.to);

    const { data: dailyRows, error: spendError } = await spendQuery;
    if (spendError) throw new Error(spendError.message);
    if (!dailyRows || dailyRows.length === 0) return [];

    // Aggregate metrics by ad_id
    const metricsMap = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>();
    for (const row of dailyRows) {
      const id = row.ad_id as string;
      const existing = metricsMap.get(id);
      if (existing) {
        existing.spend += row.spend ?? 0;
        existing.impressions += row.impressions ?? 0;
        existing.clicks += row.clicks ?? 0;
        existing.conversions += row.conversions ?? 0;
      } else {
        metricsMap.set(id, {
          spend: row.spend ?? 0,
          impressions: row.impressions ?? 0,
          clicks: row.clicks ?? 0,
          conversions: row.conversions ?? 0,
        });
      }
    }

    const adIds = [...metricsMap.keys()];

    // Fetch ad metadata
    let metaQuery = client
      .from('ads')
      .select('id, user_id, ad_set_id, facebook_ad_id, name, status, date_start, date_end, synced_at, created_at, updated_at, facebook_connection_id')
      .eq('user_id', userId)
      .in('id', adIds)
      .order('name', { ascending: true });

    if (filters.workspace_id) {
      metaQuery = metaQuery.eq('workspace_id', filters.workspace_id);
    }
    if (filters.ad_set_id) {
      metaQuery = metaQuery.eq('ad_set_id', filters.ad_set_id);
    }

    const { data: ads, error: adError } = await metaQuery;
    if (adError) throw new Error(adError.message);

    return (ads || []).map((a) => {
      const m = metricsMap.get(a.id)!;
      const totalImpressions = m.impressions || 0;
      const totalClicks = m.clicks || 0;
      const totalSpend = m.spend || 0;
      return {
        ...a,
        spend: totalSpend,
        impressions: totalImpressions,
        clicks: totalClicks,
        conversions: m.conversions,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
        cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      };
    });
  }

  async getDailyAdSpend(userId: string, filters: DateRangeFilters) {
    const client = this.supabase.getClient();
    const activeConnIds = await this.getActiveConnectionIds(userId, filters.workspace_id);
    if (activeConnIds.length === 0) return [];

    let query = client
      .from('daily_ad_spend')
      .select('id, user_id, campaign_id, ad_set_id, ad_id, facebook_campaign_id, facebook_adset_id, facebook_ad_id, date, spend, impressions, clicks, conversions, cpc, cpm, ctr, link_clicks, landing_page_views, initiate_checkouts, purchase_value, facebook_connection_id')
      .eq('user_id', userId)
      .in('facebook_connection_id', activeConnIds);

    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }
    if (filters.from) {
      query = query.gte('date', filters.from);
    }
    if (filters.to) {
      query = query.lte('date', filters.to);
    }

    query = query.order('date', { ascending: true });

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  }

  async getSyncSchedules(userId: string, workspaceId?: string) {
    const client = this.supabase.getClient();

    let query = client
      .from('sync_schedules')
      .select('id, user_id, sync_type, interval_minutes, is_active, last_sync_at, next_sync_at, last_sync_status, last_sync_error, last_sync_duration_ms, synced_campaigns, synced_ad_sets, synced_ads, consecutive_errors, created_at, updated_at')
      .eq('user_id', userId);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  }

  async getSyncLogs(userId: string, filters: SyncLogFilters) {
    const client = this.supabase.getClient();

    let query = client
      .from('sync_logs')
      .select('id, user_id, sync_schedule_id, sync_type, status, started_at, finished_at, duration_ms, campaigns_synced, ad_sets_synced, ads_synced, sales_rematched, error_message, created_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });

    if (filters.workspace_id) {
      query = query.eq('workspace_id', filters.workspace_id);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    } else {
      query = query.limit(50);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  }
}
