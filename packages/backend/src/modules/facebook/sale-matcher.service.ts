import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class SaleMatcherService {
  private readonly logger = new Logger(SaleMatcherService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Rematch sales: fills missing ad_id from utm_content, builds in-memory
   * lookup map, and matches unmatched sales to ads.
   */
  async rematchSales(userId: string) {
    const client = this.supabase.getClient();
    this.logger.log(`[rematch-sales] Starting rematch for user ${userId}`);

    // Step 0: Fill missing ad_id from utm_content for sales with pipe/slash patterns
    const { data: salesMissingAdId } = await client
      .from('sales')
      .select('id, utm_content, utm_term, ad_id')
      .eq('user_id', userId)
      .or('utm_content.not.is.null,utm_term.not.is.null');

    // Debug: log samples with pipe in utm_content
    const pipeSamples = (salesMissingAdId || [])
      .filter((s: any) => s.utm_content && s.utm_content.includes('|'))
      .slice(0, 5);
    this.logger.log(`[rematch-sales] Pipe samples: ${JSON.stringify(pipeSamples)}`);

    let adIdFilledCount = 0;
    for (const sale of salesMissingAdId || []) {
      if (sale.ad_id) continue; // already has ad_id
      const raw = sale.utm_content || sale.utm_term || null;
      if (!raw) continue;
      const numId = this.extractNumericId(raw);
      if (!numId) continue;
      const { error } = await client
        .from('sales')
        .update({ ad_id: numId })
        .eq('id', sale.id);
      if (!error) adIdFilledCount++;
    }
    this.logger.log(`[rematch-sales] Filled ad_id for ${adIdFilledCount} sales`);

    // Step 1: Fetch ALL ads for this user (with hierarchy) - single query
    const { data: allAds, error: adsError } = await client
      .from('ads')
      .select('id, facebook_ad_id, ad_set_id, ad_sets!inner(id, campaign_id)')
      .eq('user_id', userId);

    if (adsError) {
      this.logger.error(`[rematch-sales] Error fetching ads: ${JSON.stringify(adsError)}`);
      throw adsError;
    }

    // Build lookup map: facebook_ad_id -> { ad_internal_id, ad_set_id, campaign_id }
    const adLookup = new Map<
      string,
      { ad_internal_id: string; ad_set_id: string; campaign_id: string }
    >();
    for (const ad of allAds || []) {
      if (ad.facebook_ad_id) {
        adLookup.set(ad.facebook_ad_id, {
          ad_internal_id: ad.id,
          ad_set_id: ad.ad_set_id,
          campaign_id: (ad.ad_sets as any)?.campaign_id || null,
        });
      }
    }

    this.logger.log(`[rematch-sales] Built ad lookup with ${adLookup.size} ads`);

    // Step 2: Fetch unmatched sales with tracking params
    const { data: unmatchedSales, error: fetchError } = await client
      .from('sales')
      .select('id, ad_id, utm_content, utm_term, utm_campaign')
      .eq('user_id', userId)
      .or('ad_id.not.is.null,utm_content.not.is.null,utm_term.not.is.null')
      .or('ad_internal_id.is.null,campaign_id.is.null');

    if (fetchError) {
      this.logger.error(
        `[rematch-sales] Error fetching unmatched sales: ${JSON.stringify(fetchError)}`,
      );
      throw fetchError;
    }

    const totalUnmatched = unmatchedSales?.length || 0;
    this.logger.log(`[rematch-sales] Found ${totalUnmatched} unmatched sales`);

    let rematchedCount = 0;
    const errors: string[] = [];

    // Step 3: Match sales using in-memory lookup (no DB queries per sale)
    for (const sale of unmatchedSales || []) {
      try {
        // Extract effective ad_id from tracking params
        const rawAdId = sale.ad_id || sale.utm_term || sale.utm_content || null;
        const effectiveAdId = this.extractNumericId(rawAdId);

        if (!effectiveAdId) continue;

        // Look up in our in-memory map
        const match = adLookup.get(effectiveAdId);
        if (!match) continue;

        // Update the sale
        const { error: updateError } = await client
          .from('sales')
          .update({
            campaign_id: match.campaign_id,
            ad_set_id: match.ad_set_id,
            ad_internal_id: match.ad_internal_id,
          })
          .eq('id', sale.id);

        if (updateError) {
          errors.push(`Sale ${sale.id}: ${updateError.message}`);
        } else {
          rematchedCount++;
        }
      } catch (err: any) {
        errors.push(`Sale ${sale.id}: ${err.message}`);
      }
    }

    this.logger.log(
      `[rematch-sales] Completed: ${rematchedCount} rematched out of ${totalUnmatched}`,
    );

    return {
      success: true,
      total_unmatched: totalUnmatched,
      rematched: rematchedCount,
      still_unmatched: totalUnmatched - rematchedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Extracts a long numeric Facebook ID from composite tracking strings.
   * "vid34-d09-02|120245519580910309" -> "120245519580910309"
   * "creative/120245519580910309" -> "120245519580910309"
   * "120245519580910309" -> "120245519580910309"
   * "bio" -> null (no numeric ID)
   */
  private extractNumericId(raw: string | null): string | null {
    if (!raw) return null;
    const parts = raw.split(/[|\/]/);
    const numericPart = parts.find((p) => /^\d{6,}$/.test(p.trim()));
    return numericPart?.trim() || null;
  }
}
