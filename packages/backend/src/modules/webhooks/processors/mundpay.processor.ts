import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_EVENTS = new Set(['order.paid']);
const REFUNDED_EVENTS = new Set(['order.refunded', 'order.chargedback']);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

const STATUS_TO_EVENT: Record<string, string> = {
  paid: 'order.paid',
  refunded: 'order.refunded',
  chargedback: 'order.chargedback',
  chargeback: 'order.chargedback',
};

/**
 * Mundpay does not allow custom headers in its webhook configuration UI —
 * authentication is done via a `?token=...` query param on the webhook URL.
 * The user generates a token in the Sentinela UI and pastes the full URL
 * (with token appended) into the Mundpay webhook URL field.
 *
 * Security note: query-param tokens are visible in HTTP access logs. The user
 * can rotate the token at any time via the Edit Integration flow.
 */
@Injectable()
export class MundpayProcessor {
  private readonly logger = new Logger(MundpayProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
    private readonly discordLogger: DiscordLoggerService,
    private readonly salesService: SalesService,
  ) {}

  async process(
    body: any,
    _authToken: string | null,
    _rawBody?: string,
    queryParams?: Record<string, string>,
  ): Promise<{ status: number; body: any }> {
    const payload = body || {};

    this.logger.log(
      'Webhook Mundpay received: ' + JSON.stringify(payload).substring(0, 500),
    );

    let mundpayEvent = (payload.event_type || '').toLowerCase().trim();
    if (!mundpayEvent && payload.status) {
      mundpayEvent = STATUS_TO_EVENT[String(payload.status).toLowerCase()] || '';
    }

    if (!ACCEPTED_EVENTS.has(mundpayEvent)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${payload.event_type || payload.status}" não processado`,
        },
      };
    }

    const token = queryParams?.token || null;
    if (!token) {
      return {
        status: 401,
        body: {
          error:
            'Missing token. Mundpay webhook URL must include ?token=<your-token>',
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'mundpay')
      .eq('is_active', true)
      .eq('webhook_secret', token)
      .maybeSingle();

    if (integrationError || !integration) {
      this.discordLogger.logError('mundpay', {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar com o usuário se o token está correto na URL',
        tokenPartial: token ? token.slice(-4) : null,
      });
      return {
        status: 401,
        body: { error: 'Invalid token or integration not found' },
      };
    }

    const userId = integration.user_id;
    const integrationId = integration.id;
    const workspaceId = integration.workspace_id;
    const status = APPROVED_EVENTS.has(mundpayEvent) ? 'approved' : 'refunded';

    // Mundpay sends offers as either array or object (HuskyApp normalization)
    let offers: any[] = [];
    if (Array.isArray(payload.offers)) {
      offers = payload.offers;
    } else if (payload.offers && typeof payload.offers === 'object') {
      offers = Object.values(payload.offers);
    }
    const firstOffer = offers[0] || {};
    const productName =
      firstOffer.name || firstOffer.product?.name || null;

    const customer = payload.customer || {};
    const tracking = payload.tracking || {};
    const utmSource = tracking.utm_source || null;
    const utmMedium = tracking.utm_medium || null;
    const utmCampaign = tracking.utm_campaign || null;
    const utmContent = tracking.utm_content || null;
    const utmTerm = tracking.utm_term || null;
    const sck = tracking.sck || null;
    const xcod = tracking.xcod || null;

    const adId =
      this.webhooksService.extractNumericAdId(utmContent) ||
      this.webhooksService.extractNumericAdId(sck) ||
      this.webhooksService.extractNumericAdId(xcod);

    // Mundpay amount is in cents (string). net_amount is also cents.
    const grossCents = Number(payload.amount) || 0;
    const netCents = Number(payload.net_amount) || 0;
    let amount = grossCents / 100;
    if (integration.use_commission_value && netCents > 0) {
      amount = netCents / 100;
    }

    const customerPhone = customer.phone || null;
    const externalId = payload.id ? `mundpay_${payload.id}` : `mundpay_${Date.now()}`;

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: externalId,
      amount,
      product_name: productName,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customerPhone,
      customer_doc: customer.document || null,
      customer_state:
        customer.location?.state ||
        this.webhooksService.getStateFromPhone(customerPhone),
      customer_city: customer.location?.city || null,
      customer_country: customer.location?.country || 'BR',
      status,
      payment_method: payload.payment_method || 'unknown',
      currency: payload.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: payload.paid_at || payload.created_at || new Date().toISOString(),
      metadata: {
        event: mundpayEvent,
        order_id: payload.id,
        ref: payload.ref,
        offers: offers.map((o: any) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          product_id: o.product?.id,
        })),
        net_amount: payload.net_amount,
        tracking_ref: tracking.ref,
        sck,
        xcod,
        fbclid: tracking.fbclid,
        utm_id: tracking.utm_id,
        event_source_url: tracking.event_source_url,
        payment_detail: payload.paymentDetail,
        chargeback_at: payload.chargeback_at,
      },
    };

    if (status === 'refunded') {
      const { data: existingByExtId } = await supabaseAdmin
        .from('sales')
        .select('id, status')
        .eq('external_id', saleData.external_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingByExtId) {
        if (existingByExtId.status !== 'refunded') {
          await supabaseAdmin
            .from('sales')
            .update({ status: 'refunded' })
            .eq('id', existingByExtId.id);
        }
      } else {
        const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
          userId,
          customerEmail: customer.email || null,
          productName,
          checkoutIntegrationId: integrationId,
          platform: 'mundpay',
        });
        if (!fallbackResult) {
          this.logger.warn(
            `Mundpay refund skipped — no matching approved sale: external_id=${saleData.external_id}`,
          );
          await supabaseAdmin
            .from('checkout_integrations')
            .update({ last_webhook_at: new Date().toISOString() })
            .eq('id', integrationId);
          return {
            status: 200,
            body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' },
          };
        }
      }

      this.discordLogger.logRefund('mundpay', {
        amount,
        customerName: customer.name || null,
        customerEmail: customer.email || null,
        productName,
        paymentMethod: payload.payment_method || 'unknown',
        adMatched: !!adId,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
      });
      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integrationId);
      return { status: 200, body: { success: true, action: 'refunded', status } };
    }

    const sale = await this.salesService.upsertFromWebhook(saleData);

    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    this.discordLogger.logSale('mundpay', {
      amount,
      customerName: customer.name || null,
      customerEmail: customer.email || null,
      productName,
      paymentMethod: payload.payment_method || 'unknown',
      adMatched: !!adId,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
    });

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: { success: true, sale_id: sale?.id, status },
    };
  }
}
