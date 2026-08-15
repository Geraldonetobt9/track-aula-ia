import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import {
  normalizeState,
  normalizeCity,
} from '../../shared/helpers/normalize-state';
import {
  getStateFromPhone,
  getStateFromDDD,
} from '../../shared/helpers/ddd-to-state';

export interface MatchResult {
  campaign_id: string | null;
  ad_set_id: string | null;
  ad_internal_id: string | null;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Extracts a long numeric ad_id from composite tracking strings.
   * Supports separators: | (pipe) and / (slash)
   */
  extractNumericAdId(raw: string | null): string | null {
    if (!raw) return null;
    const parts = raw.split(/[|\/]/);
    const numericPart = parts.find((p) => /^\d{6,}$/.test(p.trim()));
    return numericPart?.trim() || raw;
  }

  /**
   * Extracts the ad_id from tracking parameters based on priority
   */
  extractAdId(tracking: Record<string, any>): string | null {
    return (
      tracking?.ad_id ||
      tracking?.utm_term ||
      tracking?.utm_content ||
      tracking?.src ||
      tracking?.sck ||
      null
    );
  }

  /**
   * Maps checkout platform status to our internal status
   */
  mapStatus(
    status: string,
    platform: 'hotmart' | 'kiwify' | 'kirvano',
  ): string {
    const normalizedStatus = status.toLowerCase();

    if (platform === 'hotmart') {
      const hotmartStatusMap: Record<string, string> = {
        approved: 'approved',
        purchase_approved: 'approved',
        completed: 'approved',
        purchase_complete: 'approved',
        refunded: 'refunded',
        purchase_refunded: 'refunded',
        canceled: 'refunded',
        purchase_canceled: 'refunded',
        protest: 'refunded',
        purchase_protest: 'refunded',
        chargeback: 'refunded',
        purchase_chargeback: 'refunded',
        billet_printed: 'pending',
        waiting_payment: 'pending',
        pending: 'pending',
      };
      return hotmartStatusMap[normalizedStatus] || 'pending';
    }

    if (platform === 'kiwify') {
      const kiwifyStatusMap: Record<string, string> = {
        paid: 'approved',
        approved: 'approved',
        completed: 'approved',
        refunded: 'refunded',
        chargedback: 'refunded',
        cancelled: 'refunded',
        waiting: 'pending',
        pending: 'pending',
      };
      return kiwifyStatusMap[normalizedStatus] || 'pending';
    }

    if (platform === 'kirvano') {
      const kirvanoStatusMap: Record<string, string> = {
        approved: 'approved',
        paid: 'approved',
        completed: 'approved',
        refunded: 'refunded',
        chargeback: 'refunded',
        cancelled: 'refunded',
        pending: 'pending',
        waiting: 'pending',
      };
      return kirvanoStatusMap[normalizedStatus] || 'pending';
    }

    return 'pending';
  }

  /**
   * Matches a sale to Facebook Ads hierarchy using ad_id as the primary key.
   */
  async matchSaleToAds(
    userId: string,
    adId: string | null,
    utmCampaign: string | null,
    utmContent: string | null,
    utmTerm: string | null,
    adSetFbId?: string | null,
    campaignFbId?: string | null,
  ): Promise<MatchResult> {
    const supabaseAdmin = this.supabase.getClient();

    const result: MatchResult = {
      campaign_id: null,
      ad_set_id: null,
      ad_internal_id: null,
    };

    // Step 1: Extract effective ad_id (priority: adId > utmTerm > utmContent)
    const rawAdId = adId || utmTerm || utmContent || null;
    const effectiveAdId = this.extractNumericAdId(rawAdId);
    this.logger.log(
      `[matchSaleToAds] userId: ${userId}, effectiveAdId: ${effectiveAdId}, adSetFbId: ${adSetFbId}, campaignFbId: ${campaignFbId}, utmCampaign: ${utmCampaign}`,
    );

    // Step 2: If we have an effective ad_id, look up the full hierarchy
    if (effectiveAdId) {
      const { data: adMatch, error: adError } = await supabaseAdmin
        .from('ads')
        .select(
          `
          id,
          ad_set_id,
          ad_sets!inner(id, campaign_id)
        `,
        )
        .eq('user_id', userId)
        .eq('facebook_ad_id', effectiveAdId)
        .maybeSingle();

      if (adError) {
        this.logger.error(
          '[matchSaleToAds] Error matching by ad_id:',
          adError,
        );
      }

      if (adMatch) {
        result.ad_internal_id = adMatch.id;
        result.ad_set_id = adMatch.ad_set_id;
        result.campaign_id =
          (adMatch.ad_sets as any)?.campaign_id || null;

        this.logger.log(
          `[matchSaleToAds] Matched by ad_id: campaign=${result.campaign_id}, adSet=${result.ad_set_id}, ad=${result.ad_internal_id}`,
        );
        return result;
      }

      // Also try matching by ad_set facebook_adset_id
      const { data: adSetMatch, error: adSetError } = await supabaseAdmin
        .from('ad_sets')
        .select('id, campaign_id')
        .eq('user_id', userId)
        .eq('facebook_adset_id', effectiveAdId)
        .maybeSingle();

      if (adSetError) {
        this.logger.error(
          '[matchSaleToAds] Error matching by adset_id:',
          adSetError,
        );
      }

      if (adSetMatch) {
        result.ad_set_id = adSetMatch.id;
        result.campaign_id = adSetMatch.campaign_id;

        this.logger.log(
          `[matchSaleToAds] Matched by adset_id: campaign=${result.campaign_id}, adSet=${result.ad_set_id}`,
        );
        return result;
      }
    }

    // Step 3: Try matching by adSetFbId (Guru-specific)
    if (adSetFbId) {
      const { data: adSetByFbId, error: adSetFbError } = await supabaseAdmin
        .from('ad_sets')
        .select('id, campaign_id')
        .eq('user_id', userId)
        .eq('facebook_adset_id', adSetFbId)
        .maybeSingle();

      if (adSetFbError) {
        this.logger.error(
          '[matchSaleToAds] Error matching by adSetFbId:',
          adSetFbError,
        );
      }

      if (adSetByFbId) {
        result.ad_set_id = adSetByFbId.id;
        result.campaign_id = adSetByFbId.campaign_id;

        this.logger.log(
          `[matchSaleToAds] Matched by adSetFbId: campaign=${result.campaign_id}, adSet=${result.ad_set_id}`,
        );
        return result;
      }
    }

    // Step 4: Try matching by campaignFbId (Guru-specific)
    if (campaignFbId) {
      const { data: campaignByFbId } = await supabaseAdmin
        .from('campaigns')
        .select('id')
        .eq('user_id', userId)
        .eq('facebook_campaign_id', campaignFbId)
        .maybeSingle();

      if (campaignByFbId) {
        result.campaign_id = campaignByFbId.id;
        this.logger.log(
          `[matchSaleToAds] Matched by campaignFbId: campaign=${result.campaign_id}`,
        );
        return result;
      }
    }

    // Step 5: Fallback - Try to match by utm_campaign
    if (utmCampaign) {
      const { data: campaignById } = await supabaseAdmin
        .from('campaigns')
        .select('id')
        .eq('user_id', userId)
        .eq('facebook_campaign_id', utmCampaign)
        .maybeSingle();

      if (campaignById) {
        result.campaign_id = campaignById.id;
        this.logger.log(
          `[matchSaleToAds] Matched by facebook_campaign_id: campaign=${result.campaign_id}`,
        );
        return result;
      }

      const { data: campaignByName } = await supabaseAdmin
        .from('campaigns')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', `%${utmCampaign}%`)
        .limit(1)
        .maybeSingle();

      if (campaignByName) {
        result.campaign_id = campaignByName.id;
        this.logger.log(
          `[matchSaleToAds] Matched by campaign name: campaign=${result.campaign_id}`,
        );
        return result;
      }
    }

    // Step 6: No match found - organic sale
    this.logger.log('[matchSaleToAds] No match found - treating as organic sale');
    return result;
  }

  /**
   * Fire-and-forget: matches a sale to Facebook Ads and updates the sale row.
   * Call this AFTER the sale has been inserted/upserted.
   * Never throws — failures are logged and left for rematchSales() to fix later.
   */
  async matchAndUpdateSale(
    saleId: string,
    userId: string,
    params: {
      adId: string | null;
      utmCampaign: string | null;
      utmContent: string | null;
      utmTerm: string | null;
      adSetFbId?: string | null;
      campaignFbId?: string | null;
    },
  ): Promise<void> {
    try {
      const match = await this.matchSaleToAds(
        userId,
        params.adId,
        params.utmCampaign,
        params.utmContent,
        params.utmTerm,
        params.adSetFbId,
        params.campaignFbId,
      );

      const hasMatch = match.campaign_id || match.ad_set_id || match.ad_internal_id;
      if (!hasMatch) return;

      const supabaseAdmin = this.supabase.getClient();
      const updateData: Record<string, string | null> = {};
      if (match.campaign_id) updateData.campaign_id = match.campaign_id;
      if (match.ad_set_id) updateData.ad_set_id = match.ad_set_id;
      if (match.ad_internal_id) updateData.ad_internal_id = match.ad_internal_id;

      // Match landed at adset level only — the number we wrote to sales.ad_id
      // was actually a facebook_adset_id, so clear it to avoid pretending it's an ad.
      if (match.ad_set_id && !match.ad_internal_id) updateData.ad_id = null;

      const { error } = await supabaseAdmin
        .from('sales')
        .update(updateData)
        .eq('id', saleId);

      if (error) {
        this.logger.warn(`[matchAndUpdateSale] Failed to update sale ${saleId}: ${error.message}`);
      } else {
        this.logger.log(`[matchAndUpdateSale] Sale ${saleId} matched: campaign=${match.campaign_id}, adSet=${match.ad_set_id}, ad=${match.ad_internal_id}`);
      }
    } catch (err: any) {
      this.logger.warn(`[matchAndUpdateSale] Non-blocking error for sale ${saleId}: ${err.message}`);
    }
  }

  /**
   * Fallback refund resolution: when external_id lookup fails for a refund webhook,
   * finds the most recent approved sale matching customer_email + product_name +
   * checkout_integration_id and updates its status to 'refunded'.
   *
   * Returns the matched sale { id } or null if no match found.
   */
  async findAndRefundOriginalSale(params: {
    userId: string;
    customerEmail: string | null;
    productName: string | null;
    checkoutIntegrationId: string;
    platform: string;
  }): Promise<{ id: string } | null> {
    const { userId, customerEmail, productName, checkoutIntegrationId, platform } = params;

    if (!customerEmail) {
      this.logger.warn(
        `[findAndRefundOriginalSale] No customer email for ${platform} refund — cannot match`,
      );
      return null;
    }

    const supabaseAdmin = this.supabase.getClient();

    let query = supabaseAdmin
      .from('sales')
      .select('id')
      .eq('user_id', userId)
      .eq('checkout_integration_id', checkoutIntegrationId)
      .eq('status', 'approved')
      .eq('customer_email', customerEmail);

    if (productName) {
      query = query.eq('product_name', productName);
    }

    const { data: match, error } = await query
      .order('sold_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `[findAndRefundOriginalSale] Query error for ${platform}: ${error.message}`,
      );
      return null;
    }

    if (!match) {
      this.logger.warn(
        `[findAndRefundOriginalSale] No matching approved sale for ${platform} refund: email=${customerEmail}, product=${productName}`,
      );
      return null;
    }

    const { error: updateError } = await supabaseAdmin
      .from('sales')
      .update({ status: 'refunded' })
      .eq('id', match.id);

    if (updateError) {
      this.logger.error(
        `[findAndRefundOriginalSale] Failed to update sale ${match.id}: ${updateError.message}`,
      );
      return null;
    }

    this.logger.log(
      `[findAndRefundOriginalSale] Matched ${platform} refund to sale ${match.id} via fallback (email=${customerEmail}, product=${productName})`,
    );
    return { id: match.id };
  }

  // Proxy methods for helpers
  normalizeState(input: string | null | undefined): string | null {
    return normalizeState(input);
  }

  normalizeCity(input: string | null | undefined): string | null {
    return normalizeCity(input);
  }

  getStateFromPhone(phone: string | null | undefined): string | null {
    return getStateFromPhone(phone);
  }

  getStateFromDDD(ddd: string | null | undefined): string | null {
    return getStateFromDDD(ddd);
  }
}
