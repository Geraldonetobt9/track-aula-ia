import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import {
  normalizeState,
  normalizeCity,
} from '../../../shared/helpers/normalize-state';
import { getStateFromPhone } from '../../../shared/helpers/ddd-to-state';
import { SalesService } from '../../sales/sales.service';

const STATUS_MAP: Record<string, string> = {
  approved: 'approved',
  paid: 'approved',
  completed: 'approved',
  waiting_payment: 'pending',
  pending: 'pending',
  refused: 'refunded',
  refunded: 'refunded',
  chargedback: 'refunded',
  canceled: 'refunded',
};

@Injectable()
export class GuruProcessor {
  private readonly logger = new Logger(GuruProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
    private readonly discordLogger: DiscordLoggerService,
    private readonly salesService: SalesService,
  ) {}

  async process(
    body: any,
    authToken: string | null,
  ): Promise<{ status: number; body: any }> {
    const payload = body.payload || body;

    this.logger.log(
      'Webhook Guru received: ' +
        JSON.stringify(body).substring(0, 500),
    );

    // Guru sends api_token in body, not in headers
    const token = authToken || payload.api_token || body.api_token;

    if (!token) {
      return {
        status: 200,
        body: {
          success: true,
          message:
            'Webhook endpoint active. No authentication token found in request.',
        },
      };
    }

    if (!payload || !payload.id) {
      return {
        status: 400,
        body: { error: 'Missing payload or payload.id' },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    // Find integration by token
    const { data: integration, error: intErr } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, webhook_secret, use_commission_value')
      .eq('platform', 'guru')
      .eq('is_active', true)
      .eq('webhook_secret', token)
      .limit(1)
      .maybeSingle();

    if (intErr || !integration) {
      this.discordLogger.logError('guru', {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar com o usuário se o token está correto',
        tokenPartial: token ? token.slice(-4) : null,
      });
      return {
        status: 401,
        body: { error: 'Invalid token or integration not found' },
      };
    }

    const userId = integration.user_id;
    const integrationId = integration.id;
    const externalId = payload.id;
    const status = STATUS_MAP[(payload.status || 'pending').toLowerCase()] || 'pending';

    // Check existing sale — if exists, just update status if changed
    const { data: existingSale } = await supabaseAdmin
      .from('sales')
      .select('id, status')
      .eq('external_id', externalId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingSale) {
      if (existingSale.status !== status) {
        await supabaseAdmin
          .from('sales')
          .update({ status })
          .eq('id', existingSale.id);
      }
      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integrationId);
      return {
        status: 200,
        body: { success: true, sale_id: existingSale.id, status, action: 'updated' },
      };
    }

    // Refund with no matching external_id: try fallback match, never create phantom row
    if (status === 'refunded') {
      const contact = payload.contact || {};
      const product = payload.product || {};

      const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
        userId,
        customerEmail: contact.email || null,
        productName: product.name || null,
        checkoutIntegrationId: integrationId,
        platform: 'guru',
      });

      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integrationId);

      if (fallbackResult) {
        this.discordLogger.logRefund('guru', {
          amount: 0,
          customerName: contact.name || null,
          customerEmail: contact.email || null,
          productName: product.name || null,
          paymentMethod: null,
          adMatched: false,
          utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
        });
        return { status: 200, body: { success: true, action: 'refunded_via_fallback', sale_id: fallbackResult.id } };
      }

      this.logger.warn(`Guru refund skipped — no matching approved sale: external_id=${externalId}`);
      return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
    }

    // Extract data from payload
    const payment = payload.payment || {};
    const product = payload.product || {};
    const contact = payload.contact || {};
    const source = payload.source || {};
    const dates = payload.dates || {};
    const infrastructure = payload.infrastructure || {};

    const adId = this.extractIdFromPipedString(source.utm_content);
    const adSetFbId = this.extractIdFromPipedString(source.utm_campaign);
    const campaignFbId = this.extractIdFromPipedString(source.utm_medium);

    const customerPhone =
      contact.phone_local_code && contact.phone_number
        ? `${contact.phone_local_code}${contact.phone_number}`
        : null;

    let customerState = normalizeState(
      contact.state || infrastructure.region,
    );
    const customerCity = normalizeCity(
      contact.city || infrastructure.city,
    );
    const customerCountry = infrastructure.country || 'BR';

    if (!customerState && customerPhone) {
      customerState = getStateFromPhone(customerPhone);
    }

    const utmSource = source.utm_source || null;
    const utmMedium = source.utm_medium || null;
    const utmCampaign = source.utm_campaign || null;
    const utmContent = source.utm_content || null;
    const utmTerm = source.utm_term || null;
    const grossAmount = Number(payment.total || 0);
    let amount = grossAmount;
    if (integration.use_commission_value && Number(payment.net || 0) > 0) {
      amount = Number(payment.net);
      this.logger.log(`[Guru] Using commission value: ${amount}`);
    }

    const saleData = {
      user_id: userId,
      workspace_id: integration.workspace_id,
      external_id: externalId,
      checkout_integration_id: integrationId,
      customer_state: customerState,
      customer_city: customerCity,
      customer_country: customerCountry,
      ad_id: adId || null,
      product_name: product.name || null,
      customer_name: contact.name || null,
      customer_email: contact.email || null,
      customer_phone: customerPhone,
      customer_doc: contact.doc || null,
      amount,
      currency: payment.currency || 'BRL',
      status,
      payment_method: payment.method || null,
      checkout_source: source.checkout_source || null,
      metadata: {
        ip: infrastructure.ip || null,
        city: infrastructure.city || null,
        region: infrastructure.region || null,
        country: infrastructure.country || null,
        user_agent: infrastructure.user_agent || null,
        facebook_browser_id: infrastructure.facebook_browser_id || null,
        ga_id: infrastructure.ga_id || null,
        source_raw: source.source || null,
      },
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      sold_at:
        dates.ordered_at || dates.confirmed_at || new Date().toISOString(),
    };

    // Route through SalesService for plan-limit enforcement
    const insertedSale = await this.salesService.upsertFromWebhook(saleData);

    if (insertedSale?.id) {
      this.webhooksService.matchAndUpdateSale(insertedSale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
        adSetFbId,
        campaignFbId,
      });
    }

    // Discord log
    const logData = {
      amount,
      customerName: contact.name || null,
      customerEmail: contact.email || null,
      productName: product.name || null,
      paymentMethod: payment.method || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('guru', logData);
    } else if (status === 'refunded') {
      this.discordLogger.logRefund('guru', logData);
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    this.logger.log(
      `Guru sale processed: ${externalId}, amount: ${amount}, status: ${status}`,
    );

    return {
      status: 200,
      body: { success: true, sale_id: insertedSale?.id, status },
    };
  }

  private extractIdFromPipedString(value: string | null): string | null {
    if (!value) return null;
    const parts = value.split('|');
    for (let i = parts.length - 1; i >= 0; i--) {
      const trimmed = parts[i].trim();
      if (/^\d+$/.test(trimmed)) return trimmed;
    }
    return null;
  }
}
