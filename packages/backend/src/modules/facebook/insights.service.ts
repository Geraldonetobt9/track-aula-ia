import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import {
  getExchangeRate,
  convertToBRL,
  getAccountCurrency,
} from '../../shared/helpers/currency';
import { randomUUID } from 'crypto';
import { META_API_VERSION } from '../../shared/constants/meta-api';

const FB_API_VERSION = META_API_VERSION;
const FB_GRAPH_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

// ============================================
// Helper types
// ============================================
interface FacebookConnection {
  id: string;
  user_id: string;
  workspace_id: string | null;
  access_token: string;
  ad_account_id: string;
  is_valid: boolean;
}

interface SyncPeriodInput {
  period?: string;
  since?: string;
  until?: string;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  // ============================================
  // Validate a Facebook connection
  // ============================================
  async validate(userId: string, connectionId?: string) {
    const connection = await this.getConnection(userId, connectionId);

    const adAccountId = this.normalizeAdAccountId(connection.ad_account_id);
    const url = `${FB_GRAPH_URL}/${adAccountId}?fields=name,account_status,currency&access_token=${connection.access_token}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return { valid: false, error: data.error.message };
      }

      return {
        valid: true,
        account_name: data.name,
        account_status: data.account_status,
        currency: data.currency || 'BRL',
      };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  // ============================================
  // Start a sync job (returns job_id immediately)
  // ============================================
  async startSync(
    userId: string,
    connectionId?: string,
    periodInput?: SyncPeriodInput,
  ) {
    const client = this.supabase.getClient();
    const connection = await this.getConnection(userId, connectionId);
    const resolvedPeriod = this.resolveSyncPeriod(periodInput || {});

    // Create a job record immediately
    const { data: job, error: jobError } = await client
      .from('processing_jobs')
      .insert({
        user_id: userId,
        workspace_id: connection.workspace_id || null,
        job_type: 'facebook_sync',
        status: 'processing',
        progress: 0,
      })
      .select()
      .single();

    if (jobError) {
      this.logger.error(`Error creating job: ${JSON.stringify(jobError)}`);
      throw new Error('Failed to create processing job');
    }

    this.logger.log(`Created sync job ${job.id} for user ${userId}`);

    // Aguarda a sincronizacao terminar, em vez de dispara-la em segundo plano.
    //
    // O padrao fire-and-forget funciona num servidor que fica de pe. Em funcao
    // serverless a instancia e congelada assim que a resposta e enviada: o
    // trabalho morria no meio, o job ficava em 'processing' para sempre e
    // daily_ad_spend nunca era preenchido — o dashboard aparecia zerado, sem
    // erro nenhum para explicar.
    //
    // O custo e a requisicao durar o tempo da sincronizacao, por isso a funcao
    // precisa de maxDuration folgado.
    try {
      await this.performSync(connection, userId, job.id, resolvedPeriod, connection.id);
    } catch (error: any) {
      this.logger.error(`Sync do job ${job.id} falhou: ${error.message}`);
      await client
        .from('processing_jobs')
        .update({ status: 'failed', error: error.message })
        .eq('id', job.id);
    }

    return {
      success: true,
      job_id: job.id,
      message: 'Sync started in background. Poll for status using check_job action.',
    };
  }

  // ============================================
  // Check job status
  // ============================================
  async checkJob(jobId: string, userId: string) {
    if (!jobId) {
      throw new Error('job_id is required');
    }

    const client = this.supabase.getClient();
    const { data: job, error } = await client
      .from('processing_jobs')
      .select('id, status, progress, result, error')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (error || !job) {
      throw new NotFoundException('Job not found');
    }

    return {
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
    };
  }

  // ============================================
  // Fetch account-level insights
  // ============================================
  async fetchInsights(userId: string, connectionId?: string, datePreset = 'last_7d') {
    const connection = await this.getConnection(userId, connectionId);

    const adAccountId = this.normalizeAdAccountId(connection.ad_account_id);
    const fields = 'spend,impressions,clicks,reach,cpm,cpc,ctr,actions,action_values';
    const url = `${FB_GRAPH_URL}/${adAccountId}/insights?fields=${fields}&date_preset=${datePreset}&access_token=${connection.access_token}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return { success: false, error: data.error.message };
      }

      return { success: true, insights: data.data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Perform sync for auto-sync service (public for cron usage)
  // ============================================
  async performSyncForAutoSync(
    userId: string,
    connection: any,
    facebookConnectionId: string,
    workspaceId?: string,
  ): Promise<{ campaigns: number; adSets: number; ads: number }> {
    const client = this.supabase.getClient();

    // Calculate last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const periodStart = startDate.toISOString().split('T')[0];
    const periodEnd = endDate.toISOString().split('T')[0];

    const timeRange = JSON.stringify({ since: periodStart, until: periodEnd });

    // Detect account currency and get exchange rate
    const normalizedAccountId = this.normalizeAdAccountId(connection.ad_account_id);
    const accountCurrency = await getAccountCurrency(
      normalizedAccountId,
      connection.access_token,
      FB_API_VERSION,
    );
    const exchangeRate = await getExchangeRate(accountCurrency);
    this.logger.log(
      `Auto-sync: Account currency: ${accountCurrency}, Exchange rate: ${exchangeRate}`,
    );

    // Fetch campaigns
    const campaignFields = 'id,name,status,objective';
    const insightFields = 'spend,impressions,clicks,cpm,cpc,ctr,conversions';
    const campaignsUrl = `${FB_GRAPH_URL}/${connection.ad_account_id}/campaigns?fields=${campaignFields},insights.time_range(${timeRange}){${insightFields}}&limit=500&access_token=${connection.access_token}`;

    const campaignsResponse = await fetch(campaignsUrl);
    const campaignsData = await campaignsResponse.json();

    if (campaignsData.error) {
      throw new Error(campaignsData.error.message);
    }

    const allCampaigns = campaignsData.data || [];
    const campaigns = allCampaigns.filter((c: any) => c.objective === 'OUTCOME_SALES');

    const campaignIdMap = new Map<string, string>();
    let syncedCampaigns = 0;
    let syncedAdSets = 0;
    let syncedAds = 0;

    // Upsert campaigns
    for (const campaign of campaigns) {
      const insights = campaign.insights?.data?.[0] || {};

      const campaignData: any = {
        user_id: userId,
        workspace_id: workspaceId || null,
        facebook_connection_id: facebookConnectionId || null,
        facebook_campaign_id: campaign.id,
        name: campaign.name,
        status: campaign.status?.toLowerCase() === 'active' ? 'active' : 'paused',
        objective: campaign.objective,
        spend: convertToBRL(parseFloat(insights.spend) || 0, exchangeRate),
        impressions: parseInt(insights.impressions) || 0,
        clicks: parseInt(insights.clicks) || 0,
        conversions: parseInt(insights.conversions) || 0,
        cpm: convertToBRL(parseFloat(insights.cpm) || 0, exchangeRate),
        cpc: convertToBRL(parseFloat(insights.cpc) || 0, exchangeRate),
        ctr: parseFloat(insights.ctr) || 0,
        date_start: periodStart,
        date_end: periodEnd,
        synced_at: new Date().toISOString(),
      };

      const { data: existing } = await client
        .from('campaigns')
        .select('id')
        .eq('user_id', userId)
        .eq('facebook_campaign_id', campaign.id)
        .maybeSingle();

      let campaignId: string;

      if (existing) {
        await client.from('campaigns').update(campaignData).eq('id', existing.id);
        campaignId = existing.id;
      } else {
        const { data: newCampaign, error } = await client
          .from('campaigns')
          .insert(campaignData)
          .select('id')
          .single();

        if (error) continue;
        campaignId = newCampaign.id;
      }

      campaignIdMap.set(campaign.id, campaignId);
      syncedCampaigns++;
    }

    // Fetch ad sets
    const adSetFields = 'id,name,status,campaign_id';
    const adSetsUrl = `${FB_GRAPH_URL}/${connection.ad_account_id}/adsets?fields=${adSetFields},insights.time_range(${timeRange}){${insightFields}}&limit=500&access_token=${connection.access_token}`;

    const adSetsResponse = await fetch(adSetsUrl);
    const adSetsData = await adSetsResponse.json();

    const adSetIdMap = new Map<string, string>();

    if (!adSetsData.error) {
      const adSets = adSetsData.data || [];

      for (const adSet of adSets) {
        const campaignId = campaignIdMap.get(adSet.campaign_id);
        if (!campaignId) continue;

        const insights = adSet.insights?.data?.[0] || {};

        const adSetData: any = {
          user_id: userId,
          workspace_id: workspaceId || null,
          facebook_connection_id: facebookConnectionId || null,
          campaign_id: campaignId,
          facebook_adset_id: adSet.id,
          name: adSet.name,
          status: adSet.status?.toLowerCase() === 'active' ? 'active' : 'paused',
          spend: convertToBRL(parseFloat(insights.spend) || 0, exchangeRate),
          impressions: parseInt(insights.impressions) || 0,
          clicks: parseInt(insights.clicks) || 0,
          conversions: parseInt(insights.conversions) || 0,
          cpm: convertToBRL(parseFloat(insights.cpm) || 0, exchangeRate),
          cpc: convertToBRL(parseFloat(insights.cpc) || 0, exchangeRate),
          ctr: parseFloat(insights.ctr) || 0,
          date_start: periodStart,
          date_end: periodEnd,
          synced_at: new Date().toISOString(),
        };

        const { data: existing } = await client
          .from('ad_sets')
          .select('id')
          .eq('user_id', userId)
          .eq('facebook_adset_id', adSet.id)
          .maybeSingle();

        let adSetId: string;

        if (existing) {
          await client.from('ad_sets').update(adSetData).eq('id', existing.id);
          adSetId = existing.id;
        } else {
          const { data: newAdSet, error } = await client
            .from('ad_sets')
            .insert(adSetData)
            .select('id')
            .single();

          if (error) continue;
          adSetId = newAdSet.id;
        }

        adSetIdMap.set(adSet.id, adSetId);
        syncedAdSets++;
      }
    }

    // Fetch ads
    const adFields = 'id,name,status,adset_id';
    const adsUrl = `${FB_GRAPH_URL}/${connection.ad_account_id}/ads?fields=${adFields},insights.time_range(${timeRange}){${insightFields}}&limit=500&access_token=${connection.access_token}`;

    const adsResponse = await fetch(adsUrl);
    const adsData = await adsResponse.json();

    if (!adsData.error) {
      const ads = adsData.data || [];

      for (const ad of ads) {
        const adSetId = adSetIdMap.get(ad.adset_id);
        if (!adSetId) continue;

        const insights = ad.insights?.data?.[0] || {};

        const adData: any = {
          user_id: userId,
          workspace_id: workspaceId || null,
          facebook_connection_id: facebookConnectionId || null,
          ad_set_id: adSetId,
          facebook_ad_id: ad.id,
          name: ad.name,
          status: ad.status?.toLowerCase() === 'active' ? 'active' : 'paused',
          spend: convertToBRL(parseFloat(insights.spend) || 0, exchangeRate),
          impressions: parseInt(insights.impressions) || 0,
          clicks: parseInt(insights.clicks) || 0,
          conversions: parseInt(insights.conversions) || 0,
          cpm: convertToBRL(parseFloat(insights.cpm) || 0, exchangeRate),
          cpc: convertToBRL(parseFloat(insights.cpc) || 0, exchangeRate),
          ctr: parseFloat(insights.ctr) || 0,
          date_start: periodStart,
          date_end: periodEnd,
          synced_at: new Date().toISOString(),
        };

        const { data: existing } = await client
          .from('ads')
          .select('id')
          .eq('user_id', userId)
          .eq('facebook_ad_id', ad.id)
          .maybeSingle();

        if (existing) {
          await client.from('ads').update(adData).eq('id', existing.id);
        } else {
          const { error } = await client.from('ads').insert(adData);
          if (error) continue;
        }

        syncedAds++;
      }
    }

    return { campaigns: syncedCampaigns, adSets: syncedAdSets, ads: syncedAds };
  }

  // ============================================
  // PRIVATE: Full 4-step background sync
  // ============================================
  private async performSync(
    connection: FacebookConnection,
    userId: string,
    jobId: string,
    period: { since: string; until: string },
    facebookConnectionId?: string,
  ) {
    const client = this.supabase.getClient();
    const workspaceId = connection.workspace_id;
    this.logger.log(`Starting background sync for job ${jobId}`);

    const updateProgress = async (progress: number, status = 'processing') => {
      await client
        .from('processing_jobs')
        .update({ progress, status })
        .eq('id', jobId);
    };

    try {
      const periodStart = period.since;
      const periodEnd = period.until;

      const adAccountId = this.normalizeAdAccountId(connection.ad_account_id);
      const timeRange = JSON.stringify({ since: periodStart, until: periodEnd });

      this.logger.log(`Syncing data for user ${userId} from ${periodStart} to ${periodEnd}`);
      await updateProgress(5);

      // ============================================
      // STEP 0: Detect account currency and get exchange rate
      // ============================================
      const accountCurrency = await getAccountCurrency(
        adAccountId,
        connection.access_token,
        FB_API_VERSION,
      );
      const exchangeRate = await getExchangeRate(accountCurrency);
      this.logger.log(
        `Account currency: ${accountCurrency}, Exchange rate to BRL: ${exchangeRate}`,
      );

      // ============================================
      // STEP 1: Fetch ALL campaigns (including budget fields)
      // ============================================
      const campaignFields = 'id,name,status,objective,daily_budget,lifetime_budget';
      const campaignInsightFields = 'spend,impressions,clicks,cpm,cpc,ctr,actions';
      const campaignsUrl = `${FB_GRAPH_URL}/${adAccountId}/campaigns?fields=${campaignFields},insights.time_range(${timeRange}){${campaignInsightFields}}&limit=500&access_token=${connection.access_token}`;

      this.logger.log('Fetching ALL campaigns...');
      const campaigns = await this.fetchAllPages(campaignsUrl);
      this.logger.log(`Found ${campaigns.length} total campaigns`);
      await updateProgress(15);

      const campaignIdMap = new Map<string, string>();
      let syncedCampaigns = 0;
      let syncedAdSets = 0;
      let syncedAds = 0;
      let syncedDailyRecords = 0;
      let totalSpendFromApi = 0;

      // Fetch all existing campaigns in ONE query
      const { data: existingCampaigns } = await client
        .from('campaigns')
        .select('id, facebook_campaign_id')
        .eq('user_id', userId);

      const existingCampaignMap = new Map<string, string>(
        (existingCampaigns || []).map((c: any) => [c.facebook_campaign_id, c.id]),
      );

      // Build campaign rows for batch upsert
      const campaignRows: any[] = [];
      for (const campaign of campaigns) {
        const insights = campaign.insights?.data?.[0] || {};
        const conversions = this.extractConversions(insights.actions);
        const dailyBudget = campaign.daily_budget
          ? parseFloat(campaign.daily_budget) / 100
          : null;
        const lifetimeBudget = campaign.lifetime_budget
          ? parseFloat(campaign.lifetime_budget) / 100
          : null;
        const existingId = existingCampaignMap.get(campaign.id);

        const row: any = {
          user_id: userId,
          workspace_id: workspaceId || null,
          facebook_connection_id: facebookConnectionId || null,
          facebook_campaign_id: campaign.id,
          name: campaign.name,
          status: campaign.status?.toLowerCase() === 'active' ? 'active' : 'paused',
          objective: campaign.objective,
          daily_budget: dailyBudget ? convertToBRL(dailyBudget, exchangeRate) : null,
          lifetime_budget: lifetimeBudget
            ? convertToBRL(lifetimeBudget, exchangeRate)
            : null,
          spend: convertToBRL(parseFloat(insights.spend) || 0, exchangeRate),
          impressions: parseInt(insights.impressions) || 0,
          clicks: parseInt(insights.clicks) || 0,
          conversions: conversions,
          cpm: convertToBRL(parseFloat(insights.cpm) || 0, exchangeRate),
          cpc: convertToBRL(parseFloat(insights.cpc) || 0, exchangeRate),
          ctr: parseFloat(insights.ctr) || 0,
          date_start: periodStart,
          date_end: periodEnd,
          synced_at: new Date().toISOString(),
        };

        if (existingId) {
          row.id = existingId;
          campaignIdMap.set(campaign.id, existingId);
        } else {
          row.id = randomUUID();
          campaignIdMap.set(campaign.id, row.id);
        }

        campaignRows.push(row);
      }

      // Batch upsert campaigns
      if (campaignRows.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < campaignRows.length; i += batchSize) {
          const batch = campaignRows.slice(i, i + batchSize);
          const { data: upserted, error } = await client
            .from('campaigns')
            .upsert(batch, { onConflict: 'id' })
            .select('id, facebook_campaign_id');

          if (error) {
            this.logger.error(`Error upserting campaigns batch: ${JSON.stringify(error)}`);
          } else if (upserted) {
            for (const c of upserted) {
              campaignIdMap.set(c.facebook_campaign_id, c.id);
            }
            syncedCampaigns += upserted.length;
          }
        }
      }

      this.logger.log(`Synced ${syncedCampaigns} campaigns`);
      await updateProgress(30);

      // ============================================
      // STEP 2: Fetch ALL ad sets (including budget fields)
      // ============================================
      const adSetFields = 'id,name,status,campaign_id,daily_budget,lifetime_budget';
      const adSetsUrl = `${FB_GRAPH_URL}/${adAccountId}/adsets?fields=${adSetFields},insights.time_range(${timeRange}){${campaignInsightFields}}&limit=500&access_token=${connection.access_token}`;

      this.logger.log('Fetching ALL ad sets...');
      const adSets = await this.fetchAllPages(adSetsUrl);
      this.logger.log(`Found ${adSets.length} total ad sets`);

      const adSetIdMap = new Map<string, string>();

      // Fetch all existing ad sets in ONE query
      const { data: existingAdSets } = await client
        .from('ad_sets')
        .select('id, facebook_adset_id')
        .eq('user_id', userId);

      const existingAdSetMap = new Map<string, string>(
        (existingAdSets || []).map((a: any) => [a.facebook_adset_id, a.id]),
      );

      const adSetRows: any[] = [];
      for (const adSet of adSets) {
        const campaignId = campaignIdMap.get(adSet.campaign_id);
        if (!campaignId) continue;

        const insights = adSet.insights?.data?.[0] || {};
        const conversions = this.extractConversions(insights.actions);
        const dailyBudget = adSet.daily_budget
          ? parseFloat(adSet.daily_budget) / 100
          : null;
        const lifetimeBudget = adSet.lifetime_budget
          ? parseFloat(adSet.lifetime_budget) / 100
          : null;
        const existingId = existingAdSetMap.get(adSet.id);

        const row: any = {
          user_id: userId,
          workspace_id: workspaceId || null,
          facebook_connection_id: facebookConnectionId || null,
          campaign_id: campaignId,
          facebook_adset_id: adSet.id,
          name: adSet.name,
          status: adSet.status?.toLowerCase() === 'active' ? 'active' : 'paused',
          daily_budget: dailyBudget ? convertToBRL(dailyBudget, exchangeRate) : null,
          lifetime_budget: lifetimeBudget
            ? convertToBRL(lifetimeBudget, exchangeRate)
            : null,
          spend: convertToBRL(parseFloat(insights.spend) || 0, exchangeRate),
          impressions: parseInt(insights.impressions) || 0,
          clicks: parseInt(insights.clicks) || 0,
          conversions: conversions,
          cpm: convertToBRL(parseFloat(insights.cpm) || 0, exchangeRate),
          cpc: convertToBRL(parseFloat(insights.cpc) || 0, exchangeRate),
          ctr: parseFloat(insights.ctr) || 0,
          date_start: periodStart,
          date_end: periodEnd,
          synced_at: new Date().toISOString(),
        };

        if (existingId) {
          row.id = existingId;
          adSetIdMap.set(adSet.id, existingId);
        } else {
          row.id = randomUUID();
          adSetIdMap.set(adSet.id, row.id);
        }

        adSetRows.push(row);
      }

      // Batch upsert ad sets
      if (adSetRows.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < adSetRows.length; i += batchSize) {
          const batch = adSetRows.slice(i, i + batchSize);
          const { data: upserted, error } = await client
            .from('ad_sets')
            .upsert(batch, { onConflict: 'id' })
            .select('id, facebook_adset_id');

          if (error) {
            this.logger.error(`Error upserting ad sets batch: ${JSON.stringify(error)}`);
          } else if (upserted) {
            for (const a of upserted) {
              adSetIdMap.set(a.facebook_adset_id, a.id);
            }
            syncedAdSets += upserted.length;
          }
        }
      }

      this.logger.log(`Synced ${syncedAdSets} ad sets`);
      await updateProgress(50);

      // ============================================
      // STEP 3: Fetch ALL ads
      // ============================================
      const adFields = 'id,name,status,adset_id';
      const adsUrl = `${FB_GRAPH_URL}/${adAccountId}/ads?fields=${adFields},insights.time_range(${timeRange}){${campaignInsightFields}}&limit=500&access_token=${connection.access_token}`;

      this.logger.log('Fetching ALL ads...');
      const ads = await this.fetchAllPages(adsUrl);
      this.logger.log(`Found ${ads.length} total ads`);

      const adIdMap = new Map<string, string>();

      // Fetch all existing ads in ONE query
      const { data: existingAds } = await client
        .from('ads')
        .select('id, facebook_ad_id')
        .eq('user_id', userId);

      const existingAdMap = new Map<string, string>(
        (existingAds || []).map((a: any) => [a.facebook_ad_id, a.id]),
      );

      const adRows: any[] = [];
      for (const ad of ads) {
        const adSetId = adSetIdMap.get(ad.adset_id);
        if (!adSetId) continue;

        const insights = ad.insights?.data?.[0] || {};
        const conversions = this.extractConversions(insights.actions);
        const existingId = existingAdMap.get(ad.id);

        const row: any = {
          user_id: userId,
          workspace_id: workspaceId || null,
          facebook_connection_id: facebookConnectionId || null,
          ad_set_id: adSetId,
          facebook_ad_id: ad.id,
          name: ad.name,
          status: ad.status?.toLowerCase() === 'active' ? 'active' : 'paused',
          spend: convertToBRL(parseFloat(insights.spend) || 0, exchangeRate),
          impressions: parseInt(insights.impressions) || 0,
          clicks: parseInt(insights.clicks) || 0,
          conversions: conversions,
          cpm: convertToBRL(parseFloat(insights.cpm) || 0, exchangeRate),
          cpc: convertToBRL(parseFloat(insights.cpc) || 0, exchangeRate),
          ctr: parseFloat(insights.ctr) || 0,
          date_start: periodStart,
          date_end: periodEnd,
          synced_at: new Date().toISOString(),
        };

        if (existingId) {
          row.id = existingId;
          adIdMap.set(ad.id, existingId);
        } else {
          row.id = randomUUID();
          adIdMap.set(ad.id, row.id);
        }

        adRows.push(row);
      }

      // Batch upsert ads
      if (adRows.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < adRows.length; i += batchSize) {
          const batch = adRows.slice(i, i + batchSize);
          const { data: upserted, error } = await client
            .from('ads')
            .upsert(batch, { onConflict: 'id' })
            .select('id, facebook_ad_id');

          if (error) {
            this.logger.error(`Error upserting ads batch: ${JSON.stringify(error)}`);
          } else if (upserted) {
            for (const a of upserted) {
              adIdMap.set(a.facebook_ad_id, a.id);
            }
            syncedAds += upserted.length;
          }
        }
      }

      this.logger.log(`Synced ${syncedAds} ads`);
      await updateProgress(70);

      // ============================================
      // STEP 4: FETCH DAILY INSIGHTS
      // ============================================
      this.logger.log('Fetching daily insights...');

      try {
        // DELETE existing daily records for this connection+period
        this.logger.log(
          `Deleting daily_ad_spend records for user ${userId}, connection ${facebookConnectionId}, period ${periodStart} to ${periodEnd}...`,
        );

        let deleteQuery = client
          .from('daily_ad_spend')
          .delete()
          .eq('user_id', userId)
          .gte('date', periodStart)
          .lte('date', periodEnd);

        if (facebookConnectionId) {
          deleteQuery = deleteQuery.eq('facebook_connection_id', facebookConnectionId);
        }

        await deleteQuery;

        const dailyRecordsToInsert: any[] = [];

        // Fetch daily campaign insights
        const dailyCampaignUrl =
          `${FB_GRAPH_URL}/${adAccountId}/insights?` +
          `level=campaign&` +
          `fields=campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,cpc,cpm,ctr&` +
          `time_range=${encodeURIComponent(timeRange)}&` +
          `time_increment=1&` +
          `limit=500&` +
          `access_token=${connection.access_token}`;

        const dailyCampaignInsights = await this.fetchAllPages(dailyCampaignUrl);
        this.logger.log(
          `Found ${dailyCampaignInsights.length} daily campaign insight records`,
        );

        for (const insight of dailyCampaignInsights) {
          if (!insight.campaign_id) continue;

          const campaignUuid = campaignIdMap.get(insight.campaign_id);
          const rawSpend = parseFloat(insight.spend || '0');
          const spend = convertToBRL(rawSpend, exchangeRate);
          totalSpendFromApi += spend;
          const funnelMetrics = this.extractFunnelMetrics(insight.actions);

          dailyRecordsToInsert.push({
            user_id: userId,
            workspace_id: workspaceId || null,
            facebook_connection_id: facebookConnectionId || null,
            campaign_id: campaignUuid || null,
            ad_set_id: null,
            ad_id: null,
            facebook_campaign_id: insight.campaign_id,
            facebook_adset_id: null,
            facebook_ad_id: null,
            date: insight.date_start,
            spend: spend,
            impressions: parseInt(insight.impressions || '0'),
            clicks: parseInt(insight.clicks || '0'),
            conversions: this.extractConversions(insight.actions),
            purchase_value: convertToBRL(
              this.extractPurchaseValue(insight.action_values),
              exchangeRate,
            ),
            cpc: convertToBRL(parseFloat(insight.cpc || '0'), exchangeRate),
            cpm: convertToBRL(parseFloat(insight.cpm || '0'), exchangeRate),
            ctr: parseFloat(insight.ctr || '0'),
            link_clicks: funnelMetrics.linkClicks,
            landing_page_views: funnelMetrics.landingPageViews,
            initiate_checkouts: funnelMetrics.initiateCheckouts,
          });
        }

        await updateProgress(80);

        // Fetch daily adset insights
        const dailyAdSetUrl =
          `${FB_GRAPH_URL}/${adAccountId}/insights?` +
          `level=adset&` +
          `fields=campaign_id,adset_id,adset_name,spend,impressions,clicks,actions,action_values,cpc,cpm,ctr&` +
          `time_range=${encodeURIComponent(timeRange)}&` +
          `time_increment=1&` +
          `limit=500&` +
          `access_token=${connection.access_token}`;

        const dailyAdSetInsights = await this.fetchAllPages(dailyAdSetUrl);
        this.logger.log(
          `Found ${dailyAdSetInsights.length} daily adset insight records`,
        );

        for (const insight of dailyAdSetInsights) {
          if (!insight.campaign_id || !insight.adset_id) continue;

          const campaignUuid = campaignIdMap.get(insight.campaign_id);
          const adSetUuid = adSetIdMap.get(insight.adset_id);
          const funnelMetrics = this.extractFunnelMetrics(insight.actions);

          dailyRecordsToInsert.push({
            user_id: userId,
            workspace_id: workspaceId || null,
            facebook_connection_id: facebookConnectionId || null,
            campaign_id: campaignUuid || null,
            ad_set_id: adSetUuid || null,
            ad_id: null,
            facebook_campaign_id: insight.campaign_id,
            facebook_adset_id: insight.adset_id,
            facebook_ad_id: null,
            date: insight.date_start,
            spend: convertToBRL(parseFloat(insight.spend || '0'), exchangeRate),
            impressions: parseInt(insight.impressions || '0'),
            clicks: parseInt(insight.clicks || '0'),
            conversions: this.extractConversions(insight.actions),
            purchase_value: convertToBRL(
              this.extractPurchaseValue(insight.action_values),
              exchangeRate,
            ),
            cpc: convertToBRL(parseFloat(insight.cpc || '0'), exchangeRate),
            cpm: convertToBRL(parseFloat(insight.cpm || '0'), exchangeRate),
            ctr: parseFloat(insight.ctr || '0'),
            link_clicks: funnelMetrics.linkClicks,
            landing_page_views: funnelMetrics.landingPageViews,
            initiate_checkouts: funnelMetrics.initiateCheckouts,
          });
        }

        await updateProgress(90);

        // Fetch daily ad insights
        const dailyAdUrl =
          `${FB_GRAPH_URL}/${adAccountId}/insights?` +
          `level=ad&` +
          `fields=campaign_id,adset_id,ad_id,ad_name,spend,impressions,clicks,actions,action_values,cpc,cpm,ctr&` +
          `time_range=${encodeURIComponent(timeRange)}&` +
          `time_increment=1&` +
          `limit=500&` +
          `access_token=${connection.access_token}`;

        const dailyAdInsights = await this.fetchAllPages(dailyAdUrl);
        this.logger.log(`Found ${dailyAdInsights.length} daily ad insight records`);

        for (const insight of dailyAdInsights) {
          if (!insight.campaign_id || !insight.adset_id || !insight.ad_id) continue;

          const campaignUuid = campaignIdMap.get(insight.campaign_id);
          const adSetUuid = adSetIdMap.get(insight.adset_id);
          const adUuid = adIdMap.get(insight.ad_id);
          const funnelMetrics = this.extractFunnelMetrics(insight.actions);

          dailyRecordsToInsert.push({
            user_id: userId,
            workspace_id: workspaceId || null,
            facebook_connection_id: facebookConnectionId || null,
            campaign_id: campaignUuid || null,
            ad_set_id: adSetUuid || null,
            ad_id: adUuid || null,
            facebook_campaign_id: insight.campaign_id,
            facebook_adset_id: insight.adset_id,
            facebook_ad_id: insight.ad_id,
            date: insight.date_start,
            spend: convertToBRL(parseFloat(insight.spend || '0'), exchangeRate),
            impressions: parseInt(insight.impressions || '0'),
            clicks: parseInt(insight.clicks || '0'),
            conversions: this.extractConversions(insight.actions),
            purchase_value: convertToBRL(
              this.extractPurchaseValue(insight.action_values),
              exchangeRate,
            ),
            cpc: convertToBRL(parseFloat(insight.cpc || '0'), exchangeRate),
            cpm: convertToBRL(parseFloat(insight.cpm || '0'), exchangeRate),
            ctr: parseFloat(insight.ctr || '0'),
            link_clicks: funnelMetrics.linkClicks,
            landing_page_views: funnelMetrics.landingPageViews,
            initiate_checkouts: funnelMetrics.initiateCheckouts,
          });
        }

        // Batch insert all daily records
        if (dailyRecordsToInsert.length > 0) {
          this.logger.log(
            `Inserting ${dailyRecordsToInsert.length} daily spend records...`,
          );

          const batchSize = 500;
          for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
            const batch = dailyRecordsToInsert.slice(i, i + batchSize);
            const { error } = await client
              .from('daily_ad_spend')
              .upsert(batch, { ignoreDuplicates: true });

            if (error) {
              this.logger.error(
                `Error inserting batch ${i / batchSize + 1}: ${JSON.stringify(error)}`,
              );
            } else {
              syncedDailyRecords += batch.length;
            }
          }
        }

        this.logger.log(`Synced ${syncedDailyRecords} daily spend records`);
      } catch (dailyError: any) {
        this.logger.error(`Error fetching daily insights: ${dailyError.message}`);
      }

      // Calculate total spend saved
      const { data: savedSpend } = await client
        .from('daily_ad_spend')
        .select('spend')
        .eq('user_id', userId)
        .is('facebook_adset_id', null)
        .is('facebook_ad_id', null)
        .gte('date', periodStart)
        .lte('date', periodEnd);

      const totalSpendSaved = (savedSpend || []).reduce(
        (sum: number, row: any) => sum + Number(row.spend),
        0,
      );

      // Update job as completed
      const result = {
        synced: {
          campaigns: syncedCampaigns,
          adSets: syncedAdSets,
          ads: syncedAds,
          dailyRecords: syncedDailyRecords,
        },
        totals: {
          totalSpendFromApi: Math.round(totalSpendFromApi * 100) / 100,
          totalSpendSaved: Math.round(totalSpendSaved * 100) / 100,
          match: Math.abs(totalSpendFromApi - totalSpendSaved) < 0.01,
        },
        period: {
          start: periodStart,
          end: periodEnd,
        },
      };

      await client
        .from('processing_jobs')
        .update({
          status: 'completed',
          progress: 100,
          result: result,
        })
        .eq('id', jobId);

      this.logger.log(`Sync job ${jobId} completed successfully`);
    } catch (error: any) {
      this.logger.error(`Sync job ${jobId} failed: ${error.message}`);
      await client
        .from('processing_jobs')
        .update({
          status: 'failed',
          error: error.message,
        })
        .eq('id', jobId);
      throw error;
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  private async getConnection(
    userId: string,
    connectionId?: string,
  ): Promise<FacebookConnection> {
    const client = this.supabase.getClient();

    let connectionQuery = client
      .from('facebook_connections')
      .select('id, user_id, workspace_id, access_token, ad_account_id, is_valid, last_validated_at, created_at, updated_at')
      .eq('user_id', userId);

    if (connectionId) {
      connectionQuery = connectionQuery.eq('id', connectionId);
    } else {
      connectionQuery = connectionQuery.limit(1);
    }

    const { data: connection, error: connectionError } =
      await connectionQuery.maybeSingle();

    if (connectionError) {
      throw new Error(`Failed to fetch connection: ${connectionError.message}`);
    }

    if (!connection) {
      throw new NotFoundException('No Facebook connection found');
    }

    // Decrypt sensitive fields
    connection.access_token = this.encryption.decryptIfNeeded(connection.access_token);

    return connection as FacebookConnection;
  }

  private normalizeAdAccountId(adAccountId: string): string {
    if (!adAccountId) return adAccountId;
    if (adAccountId.startsWith('act_')) return adAccountId;
    return `act_${adAccountId}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetch all pages with pagination + rate limit retry
   */
  private async fetchAllPages(initialUrl: string, maxRetries = 3): Promise<any[]> {
    let allData: any[] = [];
    let url: string | null = initialUrl;
    let pageCount = 0;

    while (url) {
      pageCount++;
      let lastError: string | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response: Response = await fetch(url);
        const json: any = await response.json();

        if (json.error) {
          const isRateLimit =
            json.error.code === 32 ||
            json.error.code === 4 ||
            (json.error.message || '').toLowerCase().includes('request limit') ||
            (json.error.message || '').toLowerCase().includes('rate limit') ||
            (json.error.message || '').toLowerCase().includes('too many calls');

          if (isRateLimit && attempt < maxRetries) {
            const waitMs = Math.min(30000, 2 ** attempt * 5000); // 5s, 10s, 20s, max 30s
            this.logger.warn(
              `Rate limited on page ${pageCount}, attempt ${attempt + 1}/${maxRetries}. Waiting ${waitMs / 1000}s...`,
            );
            await this.sleep(waitMs);
            lastError = json.error.message;
            continue;
          }

          throw new Error(`Facebook API Error: ${json.error.message}`);
        }

        // Success
        if (json.data) {
          allData = allData.concat(json.data);
        }
        url = json.paging?.next || null;
        lastError = null;
        break;
      }

      if (lastError) {
        throw new Error(
          `Facebook API Error after ${maxRetries} retries: ${lastError}`,
        );
      }
    }

    this.logger.log(`Fetched ${pageCount} page(s), ${allData.length} total records`);
    return allData;
  }

  /**
   * Extract conversions from actions array (deduplicated via max)
   */
  private extractConversions(actions: any[] | undefined): number {
    if (!actions || !Array.isArray(actions)) return 0;

    const purchaseTypes = [
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
      'purchase',
    ];

    let maxVal = 0;
    for (const action of actions) {
      if (purchaseTypes.includes(action.action_type)) {
        const v = parseInt(action.value || '0');
        if (v > maxVal) maxVal = v;
      }
    }

    return maxVal;
  }

  /**
   * Extract purchase value from action_values array
   */
  private extractPurchaseValue(actionValues: any[] | undefined): number {
    if (!actionValues || !Array.isArray(actionValues)) return 0;

    const purchaseTypes = [
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
      'purchase',
    ];

    let maxVal = 0;
    for (const av of actionValues) {
      if (purchaseTypes.includes(av.action_type)) {
        const v = parseFloat(av.value || '0');
        if (v > maxVal) maxVal = v;
      }
    }

    return maxVal;
  }

  /**
   * Extract a specific action value from actions array
   */
  private extractActionValue(
    actions: any[] | undefined,
    actionType: string,
  ): number {
    if (!actions || !Array.isArray(actions)) return 0;
    const action = actions.find((a: any) => a.action_type === actionType);
    return action ? parseInt(action.value || '0') : 0;
  }

  /**
   * Extract funnel metrics from actions
   */
  private extractFunnelMetrics(actions: any[] | undefined): {
    linkClicks: number;
    landingPageViews: number;
    initiateCheckouts: number;
  } {
    return {
      linkClicks: this.extractActionValue(actions, 'link_click'),
      landingPageViews: this.extractActionValue(actions, 'landing_page_view'),
      initiateCheckouts: this.extractInitiateCheckouts(actions),
    };
  }

  // Dedupe Meta's multiple Initiate Checkout action types (Pixel web, on-Meta web,
  // on-Meta app, omni-channel, legacy) via max.
  private extractInitiateCheckouts(actions: any[] | undefined): number {
    if (!actions || !Array.isArray(actions)) return 0;
    const initiateCheckoutTypes = [
      'offsite_conversion.fb_pixel_initiate_checkout',
      'onsite_web_initiate_checkout',
      'onsite_web_app_initiate_checkout',
      'omni_initiated_checkout',
      'initiate_checkout',
    ];
    let maxVal = 0;
    for (const action of actions) {
      if (initiateCheckoutTypes.includes(action.action_type)) {
        const v = parseInt(action.value || '0');
        if (v > maxVal) maxVal = v;
      }
    }
    return maxVal;
  }

  private isYmd(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private toYmd(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private resolveSyncPeriod(input: SyncPeriodInput): {
    since: string;
    until: string;
  } {
    // Explicit range wins
    if (this.isYmd(input.since) && this.isYmd(input.until)) {
      return { since: input.since, until: input.until };
    }

    const now = new Date();
    const period = input.period;

    if (period === 'today') {
      const ymd = this.toYmd(now);
      return { since: ymd, until: ymd };
    }

    const days = period === '7d' ? 7 : period === '30d' ? 30 : 30;
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(end.getDate() - (days - 1));

    return { since: this.toYmd(start), until: this.toYmd(end) };
  }
}
