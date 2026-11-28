import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import {
  convertToBRL,
  getAccountCurrency,
  getExchangeRate,
} from '../../shared/helpers/currency';
import { META_API_VERSION } from '../../shared/constants/meta-api';
import {
  SPEND_FRESH_MS,
  addDaysYmd,
  clampSpendRange,
  spendRangeIsFresh,
  ymdInSaoPaulo,
} from './spend-freshness';

const FB_GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
const MAX_PAGES = 12;
const CRON_MAX_ACCOUNTS = 8;

export interface AdSpendName {
  facebookAdId: string;
  name: string | null;
  campaignName: string | null;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  access_token: string;
  ad_account_id: string;
}

interface FreshWindow {
  since: string;
  until: string;
  at: number;
}

/**
 * Atualiza daily_ad_spend no nível do anúncio, que é o que a jornada lê.
 *
 * Campanhas lê o gasto ao vivo na Meta. A jornada lia só o que o sync manual
 * tinha gravado, então o dia corrente ficava em R$ 0,00. Aqui uma chamada por
 * conta (insights diários do anúncio) cobre o período, com folga de 15 minutos
 * para não estourar o limite da API. O cron diário que já existe faz o mesmo
 * para ontem e hoje.
 */
@Injectable()
export class AdSpendSyncService {
  private readonly logger = new Logger(AdSpendSyncService.name);
  private readonly memory = new Map<string, FreshWindow>();
  private readonly inflight = new Map<string, Promise<AdSpendName[]>>();
  private readonly currencyCache = new Map<string, { rate: number; at: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  async refreshForWorkspace(
    userId: string,
    workspaceId: string,
    since: string,
    until: string,
  ): Promise<AdSpendName[]> {
    const range = clampSpendRange(since, until);
    const key = `${workspaceId}:${range.since}:${range.until}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const job = this.refreshWindow(userId, workspaceId, range.since, range.until).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, job);
    return job;
  }

  /**
   * Ontem e hoje (horário de São Paulo), para as contas ativas. Para na
   * primeira conta que a Meta recusar por limite, e não passa de algumas
   * contas por execução: o cron da Vercel tem 60s e a jornada completa o resto
   * quando alguém abre a tela.
   */
  async refreshRecentForCron(): Promise<{ checked: number; refreshed: number; stopped?: string }> {
    const today = ymdInSaoPaulo();
    const since = addDaysYmd(today, -1);
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('facebook_connections')
      .select('id, user_id, workspace_id, access_token, ad_account_id')
      .eq('is_active', true)
      .eq('is_valid', true)
      .limit(40);
    if (error) throw new Error(error.message);

    const byWorkspace = new Map<string, { userId: string; rows: ConnectionRow[] }>();
    for (const row of (data ?? []) as ConnectionRow[]) {
      if (!row.workspace_id || !row.user_id) continue;
      const bucket = byWorkspace.get(row.workspace_id) ?? { userId: row.user_id, rows: [] };
      bucket.rows.push(row);
      byWorkspace.set(row.workspace_id, bucket);
    }

    let checked = 0;
    let refreshed = 0;
    for (const [workspaceId, bucket] of byWorkspace) {
      if (refreshed >= CRON_MAX_ACCOUNTS) break;
      checked += 1;
      if (await this.dbCovers(workspaceId, since, today)) continue;
      try {
        await this.refreshWindow(bucket.userId, workspaceId, since, today, bucket.rows);
        refreshed += 1;
      } catch (err: any) {
        const message = err?.message ?? String(err);
        this.logger.warn(`[ad-spend cron] ${workspaceId}: ${message}`);
        if (/rate limit|request limit|too many calls/i.test(message)) {
          return { checked, refreshed, stopped: 'rate_limit' };
        }
      }
    }
    return { checked, refreshed };
  }

  private async refreshWindow(
    userId: string,
    workspaceId: string,
    since: string,
    until: string,
    knownConnections?: ConnectionRow[],
  ): Promise<AdSpendName[]> {
    if (this.memoryCovers(workspaceId, since, until)) return [];
    if (await this.dbCovers(workspaceId, since, until)) {
      this.remember(workspaceId, since, until);
      return [];
    }

    const connections = knownConnections ?? (await this.loadConnections(userId, workspaceId));
    if (connections.length === 0) {
      this.remember(workspaceId, since, until);
      return [];
    }

    // Busca tudo antes de apagar: se a Meta falhar, o gasto que já está
    // gravado continua na tela.
    const fetched: Array<{ conn: ConnectionRow; records: Record<string, unknown>[]; names: AdSpendName[] }> = [];
    for (const conn of connections) {
      const token = this.encryption.decryptIfNeeded(conn.access_token);
      const accountId = conn.ad_account_id.startsWith('act_')
        ? conn.ad_account_id
        : `act_${conn.ad_account_id}`;
      const rate = await this.rateFor(accountId, token);
      const insights = await this.fetchAdDailyInsights(accountId, token, since, until);
      const records: Record<string, unknown>[] = [];
      const connNames: AdSpendName[] = [];
      for (const insight of insights) {
        if (!insight.ad_id || !insight.date_start) continue;
        connNames.push({
          facebookAdId: String(insight.ad_id),
          name: insight.ad_name ? String(insight.ad_name) : null,
          campaignName: insight.campaign_name ? String(insight.campaign_name) : null,
        });
        records.push({
          user_id: conn.user_id || userId,
          workspace_id: workspaceId,
          facebook_connection_id: conn.id,
          campaign_id: null,
          ad_set_id: null,
          ad_id: null,
          facebook_campaign_id: insight.campaign_id ?? null,
          facebook_adset_id: insight.adset_id ?? null,
          facebook_ad_id: String(insight.ad_id),
          date: insight.date_start,
          spend: convertToBRL(parseFloat(insight.spend || '0'), rate),
          impressions: parseInt(insight.impressions || '0', 10) || 0,
          clicks: parseInt(insight.clicks || '0', 10) || 0,
          conversions: extractConversions(insight.actions),
          purchase_value: convertToBRL(extractPurchaseValue(insight.action_values), rate),
          cpc: convertToBRL(parseFloat(insight.cpc || '0'), rate),
          cpm: convertToBRL(parseFloat(insight.cpm || '0'), rate),
          ctr: parseFloat(insight.ctr || '0') || 0,
        });
      }
      fetched.push({ conn, records, names: connNames });
    }

    const names: AdSpendName[] = [];
    const client = this.supabase.getClient();

    // Linhas antigas sem conta não seriam substituídas pelo delete por conexão
    // e o gasto dobraria. Tira só as órfãs do período, uma vez.
    const { error: orphanErr } = await client
      .from('daily_ad_spend')
      .delete()
      .eq('workspace_id', workspaceId)
      .is('facebook_connection_id', null)
      .gte('date', since)
      .lte('date', until)
      .not('facebook_ad_id', 'is', null);
    if (orphanErr) throw new Error(orphanErr.message);

    for (const item of fetched) {
      names.push(...item.names);
      const { error: delErr } = await client
        .from('daily_ad_spend')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('facebook_connection_id', item.conn.id)
        .gte('date', since)
        .lte('date', until)
        .not('facebook_ad_id', 'is', null);
      if (delErr) throw new Error(delErr.message);

      for (let i = 0; i < item.records.length; i += 500) {
        const batch = item.records.slice(i, i + 500);
        const { error } = await client.from('daily_ad_spend').insert(batch);
        if (error) throw new Error(error.message);
      }
      this.logger.log(
        `[ad-spend] ${workspaceId} ${item.conn.ad_account_id} ${since}..${until}: ${item.records.length} dia(s) de anúncio`,
      );
    }

    this.remember(workspaceId, since, until);
    return names;
  }

  private memoryCovers(workspaceId: string, since: string, until: string): boolean {
    const hit = this.memory.get(workspaceId);
    if (!hit) return false;
    if (Date.now() - hit.at > SPEND_FRESH_MS) return false;
    return hit.since <= since && hit.until >= until;
  }

  private remember(workspaceId: string, since: string, until: string) {
    const prev = this.memory.get(workspaceId);
    const fresh = Date.now();
    if (prev && fresh - prev.at < SPEND_FRESH_MS) {
      this.memory.set(workspaceId, {
        since: prev.since < since ? prev.since : since,
        until: prev.until > until ? prev.until : until,
        at: fresh,
      });
      return;
    }
    this.memory.set(workspaceId, { since, until, at: fresh });
  }

  private async dbCovers(workspaceId: string, since: string, until: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - SPEND_FRESH_MS).toISOString();
    const client = this.supabase.getClient();
    const base = () =>
      client
        .from('daily_ad_spend')
        .select('date')
        .eq('workspace_id', workspaceId)
        .not('facebook_ad_id', 'is', null)
        .gte('date', since)
        .lte('date', until)
        .gte('updated_at', cutoff);

    const [oldest, newest] = await Promise.all([
      base().order('date', { ascending: true }).limit(1),
      base().order('date', { ascending: false }).limit(1),
    ]);
    if (oldest.error) throw new Error(oldest.error.message);
    if (newest.error) throw new Error(newest.error.message);
    return spendRangeIsFresh({
      since,
      until,
      oldestFreshDate: oldest.data?.[0]?.date ?? null,
      newestFreshDate: newest.data?.[0]?.date ?? null,
    });
  }

  private async loadConnections(userId: string, workspaceId: string): Promise<ConnectionRow[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('facebook_connections')
      .select('id, user_id, workspace_id, access_token, ad_account_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .eq('is_valid', true);
    if (error) throw new Error(error.message);
    return (data ?? []) as ConnectionRow[];
  }

  private async rateFor(accountId: string, token: string): Promise<number> {
    const hit = this.currencyCache.get(accountId);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.rate;
    const currency = await getAccountCurrency(accountId, token, META_API_VERSION);
    const rate = await getExchangeRate(currency);
    this.currencyCache.set(accountId, { rate, at: Date.now() });
    return rate;
  }

  private async fetchAdDailyInsights(
    accountId: string,
    token: string,
    since: string,
    until: string,
  ): Promise<any[]> {
    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    const fields = 'campaign_id,campaign_name,adset_id,ad_id,ad_name,spend,impressions,clicks,actions,action_values,cpc,cpm,ctr';
    let url: string | null =
      `${FB_GRAPH}/${accountId}/insights?level=ad&time_increment=1&fields=${fields}` +
      `&time_range=${timeRange}&limit=500&access_token=${encodeURIComponent(token)}`;
    const all: any[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const json = await this.getJson(url);
      if (Array.isArray(json.data)) all.push(...json.data);
      url = json.paging?.next || null;
    }
    return all;
  }

  private async getJson(url: string): Promise<any> {
    let lastMessage = 'Facebook API Error';
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url);
      const json = await response.json();
      if (!json?.error) return json;
      lastMessage = json.error.message || lastMessage;
      const limited =
        json.error.code === 32 ||
        json.error.code === 4 ||
        /request limit|rate limit|too many calls/i.test(lastMessage);
      if (!limited || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Facebook API Error: ${lastMessage}`);
  }
}

function extractConversions(actions: any[] | undefined): number {
  if (!Array.isArray(actions)) return 0;
  const types = ['offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase', 'purchase'];
  let max = 0;
  for (const action of actions) {
    if (types.includes(action.action_type)) {
      const v = parseInt(action.value || '0', 10) || 0;
      if (v > max) max = v;
    }
  }
  return max;
}

function extractPurchaseValue(actionValues: any[] | undefined): number {
  if (!Array.isArray(actionValues)) return 0;
  const types = ['offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase', 'purchase'];
  let max = 0;
  for (const action of actionValues) {
    if (types.includes(action.action_type)) {
      const v = parseFloat(action.value || '0') || 0;
      if (v > max) max = v;
    }
  }
  return max;
}
