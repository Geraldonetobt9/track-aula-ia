import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { PlanLimitsService } from '../plan-limits/plan-limits.service';
import {
  getExchangeRate,
  convertFromBRL,
  getAccountCurrency,
} from '../../shared/helpers/currency';
import { META_API_VERSION } from '../../shared/constants/meta-api';

const FB_API_VERSION = META_API_VERSION;

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  // ============================================
  // Get connections
  // ============================================
  async getConnections(
    userId: string,
    workspaceId?: string,
    options?: { activeOnly?: boolean; minimal?: boolean },
  ) {
    const client = this.supabase.getClient();

    const columns = options?.minimal
      ? 'id, ad_account_id, account_name'
      : 'id, ad_account_id, account_name, account_status, facebook_user_id, facebook_user_name, is_valid, is_active';

    let query = client
      .from('facebook_connections')
      .select(columns)
      .eq('user_id', userId);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    if (options?.activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('account_name', { ascending: true });

    if (error) throw error;

    if (options?.minimal) {
      return (data || []).map((conn: any) => ({
        id: conn.id,
        ad_account_id: conn.ad_account_id,
        account_name: conn.account_name,
      }));
    }

    return (data || []).map((conn: any) => ({
      id: conn.id,
      ad_account_id: conn.ad_account_id,
      account_name: conn.account_name,
      account_status: conn.account_status ?? null,
      facebook_user_id: conn.facebook_user_id || null,
      facebook_user_name: conn.facebook_user_name || null,
      is_valid: conn.is_valid,
      is_active: conn.is_active ?? false,
    }));
  }

  // ============================================
  // Delete all connections for a Facebook profile
  // ============================================
  async deleteConnectionsByProfile(userId: string, facebookUserId: string) {
    const client = this.supabase.getClient();

    // Find all connections for this FB profile
    const { data: profileConns, error: fetchError } = await client
      .from('facebook_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('facebook_user_id', facebookUserId);

    if (fetchError) throw fetchError;

    if (!profileConns?.length) {
      throw new NotFoundException('No connections found for this Facebook profile');
    }

    const connIds = profileConns.map((c) => c.id);

    // Delete all facebook_connections for this profile
    const { error } = await client
      .from('facebook_connections')
      .delete()
      .eq('user_id', userId)
      .eq('facebook_user_id', facebookUserId);

    if (error) throw error;

    return { success: true, deleted_count: connIds.length };
  }

  // ============================================
  // List ad accounts from a raw access token
  // ============================================
  async listAccounts(accessToken: string) {
    if (!accessToken) {
      throw new BadRequestException('access_token is required');
    }

    try {
      // Step 1: Get the token owner's identity
      const meUrl = `https://graph.facebook.com/${FB_API_VERSION}/me?fields=id,name&access_token=${accessToken}`;
      const meResponse = await fetch(meUrl);
      const meData = await meResponse.json();
      const tokenOwnerId = meData?.id;
      this.logger.log(`Token owner: ${JSON.stringify({ id: tokenOwnerId, name: meData?.name, error: meData?.error?.message })}`);

      // Step 2: Try /me/adaccounts (personal tokens)
      const url = `https://graph.facebook.com/${FB_API_VERSION}/me/adaccounts?fields=id,name,account_status,currency,business_name&limit=100&access_token=${accessToken}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.error && data.data?.length) {
        this.logger.log(`/me/adaccounts returned ${data.data.length} accounts`);
        return { accounts: this.mapAccounts(data.data) };
      }
      this.logger.log(`/me/adaccounts failed or empty: ${data.error?.message || 'no accounts'}`);

      // Step 3: Try /{tokenOwnerId}/assigned_ad_accounts (System User tokens)
      if (tokenOwnerId) {
        const assignedUrl = `https://graph.facebook.com/${FB_API_VERSION}/${tokenOwnerId}/assigned_ad_accounts?fields=id,name,account_status,currency,business_name&limit=100&access_token=${accessToken}`;
        const assignedResponse = await fetch(assignedUrl);
        const assignedData = await assignedResponse.json();

        if (!assignedData.error && assignedData.data?.length) {
          return { accounts: this.mapAccounts(assignedData.data) };
        }
      }

      // Step 4: Try via Business Manager
      const bizUrl = `https://graph.facebook.com/${FB_API_VERSION}/me/businesses?fields=id,name&limit=10&access_token=${accessToken}`;
      const bizResponse = await fetch(bizUrl);
      const bizData = await bizResponse.json();

      if (!bizData.error && bizData.data?.length) {
        const allAccounts: any[] = [];
        for (const biz of bizData.data) {
          for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
            const edgeUrl = `https://graph.facebook.com/${FB_API_VERSION}/${biz.id}/${edge}?fields=id,name,account_status,currency,business_name&limit=100&access_token=${accessToken}`;
            const edgeResponse = await fetch(edgeUrl);
            const edgeData = await edgeResponse.json();
            if (!edgeData.error && edgeData.data) {
              allAccounts.push(...this.mapAccounts(edgeData.data));
            }
          }
        }

        if (allAccounts.length > 0) {
          const uniqueMap = new Map<string, any>();
          for (const acc of allAccounts) uniqueMap.set(acc.id, acc);
          return { accounts: Array.from(uniqueMap.values()) };
        }
      }

      // Step 5: If tokenOwnerId looks like a business/page, try direct owned_ad_accounts
      if (tokenOwnerId) {
        const directUrl = `https://graph.facebook.com/${FB_API_VERSION}/${tokenOwnerId}/owned_ad_accounts?fields=id,name,account_status,currency,business_name&limit=100&access_token=${accessToken}`;
        const directResponse = await fetch(directUrl);
        const directData = await directResponse.json();

        if (!directData.error && directData.data?.length) {
          return { accounts: this.mapAccounts(directData.data) };
        }
      }

      // All strategies exhausted
      const errorMsg =
        data.error?.message || 'Nao foi possivel listar contas de anuncios com este token.';
      this.logger.error(`All list-accounts strategies failed for token owner: ${tokenOwnerId}`);
      throw new BadRequestException(errorMsg);
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(`handleListAccounts exception: ${e.message}`);
      throw e;
    }
  }

  // ============================================
  // Update budget via Facebook API
  // ============================================
  async updateBudget(userId: string, payload: any) {
    const { type, facebook_id, budget_type, amount, ad_account_id } = payload;

    if (!type || !facebook_id || !budget_type || amount === undefined) {
      throw new BadRequestException('Missing required fields: type, facebook_id, budget_type, amount');
    }
    if (type !== 'campaign' && type !== 'adset') {
      throw new BadRequestException("Invalid type. Must be 'campaign' or 'adset'");
    }
    if (budget_type !== 'daily' && budget_type !== 'lifetime') {
      throw new BadRequestException("Invalid budget_type. Must be 'daily' or 'lifetime'");
    }
    if (typeof amount !== 'number' || amount < 100) {
      throw new BadRequestException('Amount must be at least 100 (R$1.00 in cents)');
    }

    const accessToken = await this.getTokenForAccount(userId, ad_account_id);
    const normalizedAccountId = ad_account_id?.startsWith('act_') ? ad_account_id : `act_${ad_account_id || ''}`;

    const accountCurrency = await getAccountCurrency(normalizedAccountId, accessToken);
    const exchangeRate = await getExchangeRate(accountCurrency);
    const nativeAmount = exchangeRate === 1.0 ? amount : Math.round(convertFromBRL(amount / 100, exchangeRate) * 100);

    const budgetField = budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget';
    const body = new URLSearchParams();
    body.append('access_token', accessToken);
    body.append(budgetField, nativeAmount.toString());

    const fbResponse = await fetch(`https://graph.facebook.com/${FB_API_VERSION}/${facebook_id}`, { method: 'POST', body });
    const fbData = await fbResponse.json();

    if (!fbResponse.ok || fbData.error) {
      this.logger.error(`Facebook budget error: ${JSON.stringify(fbData.error)}`);
      throw new BadRequestException(fbData.error?.message || 'Erro ao atualizar orcamento no Facebook');
    }

    return { success: true, message: 'Budget updated successfully', facebook_response: fbData };
  }

  // ============================================
  // Update campaign/adset/ad status via Facebook API
  // ============================================
  async updateStatus(userId: string, payload: any) {
    const { facebook_id, status, type, ad_account_id } = payload;

    if (!facebook_id || !status || !type) {
      throw new BadRequestException('facebook_id, status e type sao obrigatorios');
    }
    if (!['ACTIVE', 'PAUSED'].includes(status)) {
      throw new BadRequestException('Status deve ser ACTIVE ou PAUSED');
    }
    if (!['campaign', 'adset', 'ad'].includes(type)) {
      throw new BadRequestException('Type deve ser campaign, adset ou ad');
    }

    const accessToken = await this.getTokenForAccount(userId, ad_account_id);

    const fbResponse = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/${facebook_id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status, access_token: accessToken }),
      },
    );
    const fbData = await fbResponse.json();

    if (fbData.error) {
      this.logger.error(`Facebook status error: ${JSON.stringify(fbData.error)}`);
      throw new BadRequestException(fbData.error.message || 'Erro ao atualizar status no Facebook');
    }

    return { success: true };
  }

  // ============================================
  // Duplicate campaign, ad set, or ad
  // ============================================
  async duplicateObject(userId: string, payload: any) {
    const { facebook_id, type, rename_suffix, ad_account_id } = payload;

    if (!facebook_id || !type) {
      throw new BadRequestException('facebook_id e type sao obrigatorios');
    }
    if (!['campaign', 'adset', 'ad'].includes(type)) {
      throw new BadRequestException('Type deve ser campaign, adset ou ad');
    }

    const accessToken = await this.getTokenForAccount(userId, ad_account_id);

    const body = new URLSearchParams();
    body.append('access_token', accessToken);
    body.append('deep_copy', 'true');
    body.append('status_option', 'ACTIVE');
    body.append('rename_strategy', 'NO_RENAME');
    if (rename_suffix) {
      body.append('rename_suffix', rename_suffix);
    }

    const url = `https://graph.facebook.com/${FB_API_VERSION}/${facebook_id}/copies`;
    this.logger.log(`[duplicate] POST /{${facebook_id}}/copies | type=${type} account=${ad_account_id}`);

    const fbResponse = await fetch(url, { method: 'POST', body });
    const fbData = await fbResponse.json();

    if (fbData.error) {
      this.logger.error(`Facebook duplicate error: ${JSON.stringify(fbData.error)}`);
      throw new BadRequestException(fbData.error.message || 'Erro ao duplicar no Facebook');
    }

    const copiedId =
      fbData.copied_campaign_id ||
      fbData.copied_adset_id ||
      fbData.copied_ad_id ||
      fbData.ad_object_ids?.[0]?.copied_id ||
      null;

    this.logger.log(`[duplicate] Success: copied_id=${copiedId}`);
    return { success: true, copied_id: copiedId, facebook_response: fbData };
  }

  // ============================================
  // Get decrypted token for a connection (used by other services)
  // ============================================
  async getDecryptedToken(connectionId: string): Promise<string> {
    const client = this.supabase.getClient();
    const { data: conn, error } = await client
      .from('facebook_connections')
      .select('access_token')
      .eq('id', connectionId)
      .single();

    if (error || !conn) {
      throw new NotFoundException('Connection not found');
    }

    return this.encryption.decryptIfNeeded(conn.access_token);
  }

  // ============================================
  // Save connection from OAuth flow
  // Discovers all ad accounts and creates one row per account
  // ============================================
  async saveOAuthConnection(
    userId: string,
    accessToken: string,
    facebookUserId: string,
    facebookUserName: string,
    tokenExpiresAt: Date | null,
  ): Promise<{ savedCount: number }> {
    const client = this.supabase.getClient();

    // Fetch the user's workspace (required for facebook_connections)
    const { data: workspace, error: wsError } = await client
      .from('workspaces')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (wsError || !workspace) {
      this.logger.error(`No workspace found for user ${userId}: ${wsError?.message || 'not found'}`);
      throw new BadRequestException('Workspace não encontrado. Crie um workspace antes de conectar o Facebook.');
    }

    const workspaceId = workspace.id;

    const encAccessToken = this.encryption.encrypt(accessToken);
    const now = new Date().toISOString();

    // Discover all ad accounts available to this token
    let accounts: any[] = [];
    try {
      const result = await this.listAccounts(accessToken);
      accounts = result.accounts || [];
    } catch (err: any) {
      this.logger.warn(`Failed to discover ad accounts during OAuth: ${err.message}`);
    }

    if (accounts.length === 0) {
      this.logger.warn(`No ad accounts found for FB user ${facebookUserId}`);
      return { savedCount: 0 };
    }

    // Update existing connections for this FB user (refresh token)
    const { data: existingConns } = await client
      .from('facebook_connections')
      .select('id, ad_account_id')
      .eq('user_id', userId)
      .eq('facebook_user_id', facebookUserId);

    const existingByAdAccount = new Map<string, string>();
    for (const conn of existingConns || []) {
      existingByAdAccount.set(conn.ad_account_id, conn.id);
    }

    let savedCount = 0;

    for (const account of accounts) {
      const adAccountId = account.id.startsWith('act_') ? account.id : `act_${account.id}`;
      const existingId = existingByAdAccount.get(adAccountId);

      if (existingId) {
        // Update token on existing connection
        await client
          .from('facebook_connections')
          .update({
            access_token: encAccessToken,
            token_expires_at: tokenExpiresAt?.toISOString() ?? null,
            account_name: account.name || null,
            account_status: account.account_status ?? null,
            facebook_user_name: facebookUserName || null,
            is_valid: true,
            last_validated_at: now,
          })
          .eq('id', existingId);
      } else {
        // Insert new connection (is_active defaults to false)
        const { error } = await client
          .from('facebook_connections')
          .insert({
            user_id: userId,
            workspace_id: workspaceId,
            access_token: encAccessToken,
            ad_account_id: adAccountId,
            facebook_user_id: facebookUserId,
            facebook_user_name: facebookUserName || null,
            token_expires_at: tokenExpiresAt?.toISOString() ?? null,
            account_name: account.name || null,
            account_status: account.account_status ?? null,
            is_valid: true,
            last_validated_at: now,
            is_active: false,
          });

        if (error) {
          this.logger.error(`Failed to save ad account ${adAccountId}: ${error.message}`);
          continue;
        }
      }
      savedCount++;
    }

    return { savedCount };
  }

  // ============================================
  // Rediscover ad accounts for an already-connected profile
  // ============================================
  /**
   * Re-queries the Graph API with the profile's stored token and records ad
   * accounts that appeared since the last discovery — the common case being
   * access granted to the user after they connected.
   *
   * Accounts the token no longer returns are left untouched: they may hold
   * synced insights and campaign history, so removal stays a manual decision.
   */
  async refreshProfileAdAccounts(
    userId: string,
    facebookUserId: string,
  ): Promise<{ added: number; updated: number; total: number }> {
    const client = this.supabase.getClient();

    const { data: profileConns, error: fetchError } = await client
      .from('facebook_connections')
      .select('id, ad_account_id, account_name, account_status, access_token, workspace_id, token_expires_at, facebook_user_name')
      .eq('user_id', userId)
      .eq('facebook_user_id', facebookUserId);

    if (fetchError) throw fetchError;

    if (!profileConns?.length) {
      throw new NotFoundException('Perfil do Facebook não encontrado.');
    }

    const reference = profileConns[0];

    if (reference.token_expires_at && new Date(reference.token_expires_at) <= new Date()) {
      throw new BadRequestException(
        'O acesso ao Facebook expirou. Remova o perfil e conecte novamente.',
      );
    }

    const accessToken = this.encryption.decryptIfNeeded(reference.access_token);

    let accounts: any[];
    try {
      const result = await this.listAccounts(accessToken);
      accounts = result.accounts || [];
    } catch (err: any) {
      // A token the Graph API rejects will keep failing — flag it so the UI can
      // steer the user to reconnect instead of retrying the refresh.
      await client
        .from('facebook_connections')
        .update({ is_valid: false, last_validated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('facebook_user_id', facebookUserId);

      this.logger.warn(`Refresh failed for FB user ${facebookUserId}: ${err.message}`);
      throw new BadRequestException(
        'Não foi possível consultar as contas no Facebook. Reconecte o perfil e tente de novo.',
      );
    }

    const now = new Date().toISOString();
    const existingByAdAccount = new Map(profileConns.map((conn) => [conn.ad_account_id, conn]));

    const newRows: Record<string, unknown>[] = [];
    const staleRows: { id: string; account_name: string | null; account_status: number | null }[] = [];

    for (const account of accounts) {
      const adAccountId = account.id.startsWith('act_') ? account.id : `act_${account.id}`;
      const existing = existingByAdAccount.get(adAccountId);
      const accountName = account.name || null;
      const accountStatus = account.account_status ?? null;

      if (!existing) {
        newRows.push({
          user_id: userId,
          workspace_id: reference.workspace_id,
          access_token: reference.access_token,
          ad_account_id: adAccountId,
          facebook_user_id: facebookUserId,
          facebook_user_name: reference.facebook_user_name,
          token_expires_at: reference.token_expires_at,
          account_name: accountName,
          account_status: accountStatus,
          is_valid: true,
          last_validated_at: now,
          is_active: false,
        });
        continue;
      }

      if (existing.account_name !== accountName || existing.account_status !== accountStatus) {
        staleRows.push({ id: existing.id, account_name: accountName, account_status: accountStatus });
      }
    }

    if (newRows.length > 0) {
      const { error } = await client.from('facebook_connections').insert(newRows);
      if (error) {
        this.logger.error(`Failed to insert ${newRows.length} new ad accounts: ${error.message}`);
        throw new BadRequestException('Erro ao salvar as novas contas de anúncio.');
      }
    }

    // Renames and status changes are rare, so this stays a handful of rows.
    await Promise.all(
      staleRows.map((row) =>
        client
          .from('facebook_connections')
          .update({
            account_name: row.account_name,
            account_status: row.account_status,
            is_valid: true,
            last_validated_at: now,
          })
          .eq('id', row.id),
      ),
    );

    this.logger.log(
      `Refresh FB user ${facebookUserId}: +${newRows.length} new, ${staleRows.length} updated, ${accounts.length} total`,
    );

    return { added: newRows.length, updated: staleRows.length, total: accounts.length };
  }

  // ============================================
  // Toggle is_active on a connection
  // ============================================
  async toggleActive(userId: string, connectionId: string, isActive: boolean) {
    if (isActive) {
      await this.planLimits.assertCanActivateAdAccount(userId, connectionId);
    }

    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('facebook_connections')
      .update({ is_active: isActive })
      .eq('id', connectionId)
      .eq('user_id', userId)
      .select('id, ad_account_id, is_active')
      .single();

    if (error) throw error;

    await this.planLimits.invalidate(userId);

    return { success: true, connection: data };
  }

  // ============================================
  // Private helpers
  // ============================================

  /**
   * Get decrypted access token for a specific ad account.
   * Falls back to first active connection if ad_account_id not provided.
   */
  private async getTokenForAccount(userId: string, adAccountId?: string): Promise<string> {
    const client = this.supabase.getClient();

    let query = client
      .from('facebook_connections')
      .select('access_token')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('is_valid', true);

    if (adAccountId) {
      query = query.eq('ad_account_id', adAccountId);
    }

    const { data: conn, error } = await query.limit(1).maybeSingle();

    if (error || !conn?.access_token) {
      throw new BadRequestException('Conexao com Facebook nao encontrada para esta conta de anuncio');
    }

    return this.encryption.decryptIfNeeded(conn.access_token);
  }

  private mapAccounts(data: any[]): any[] {
    return (data || []).map((acc: any) => ({
      id: acc.id,
      name: acc.name || 'Sem nome',
      business_name: acc.business_name || null,
      currency: acc.currency || 'BRL',
      account_status: acc.account_status,
    }));
  }

}
