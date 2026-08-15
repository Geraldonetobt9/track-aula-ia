import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_EVENTS = new Set(['pix.paid', 'card.paid']);
const REFUNDED_EVENTS = new Set([
  'pix.refunded',
  'card.refunded',
  'pix.chargeback',
  'card.chargeback',
]);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class GGCheckoutProcessor {
  private readonly logger = new Logger(GGCheckoutProcessor.name);

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
    const payload = body;

    this.logger.log(
      'Webhook GGCheckout received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    if (!authToken) {
      return {
        status: 200,
        body: {
          success: true,
          message:
            'Webhook endpoint active. No authentication token found in request.',
        },
      };
    }

    const eventName = (payload.event || '').toLowerCase().trim();
    if (!ACCEPTED_EVENTS.has(eventName)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${eventName}" not processed`,
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'ggcheckout')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      this.discordLogger.logError('ggcheckout', {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar com o usuário se o token está correto',
        tokenPartial: authToken ? authToken.slice(-4) : null,
      });
      return {
        status: 401,
        body: { error: 'Invalid token or integration not found' },
      };
    }

    const userId = integration.user_id;
    const integrationId = integration.id;
    const workspaceId = integration.workspace_id;

    const paymentObj = payload.payment || {};
    const customer = payload.customer || {};
    const product = payload.product || {};
    const products = payload.products || [];
    const params = payload.params || {};
    const createdAt = payload.createdAt || {};

    const status = APPROVED_EVENTS.has(eventName) ? 'approved' : 'refunded';

    const utmSource = params.utm_source || null;
    const utmMedium = params.utm_medium || null;
    const utmCampaign = params.utm_campaign || null;
    const utmContent = params.utm_content || null;
    const utmTerm = params.utm_term || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerPhone = customer.phone || null;
    const customerState =
      this.webhooksService.getStateFromPhone(customerPhone);

    const amount =
      typeof paymentObj.amount === 'number'
        ? paymentObj.amount
        : parseFloat(paymentObj.amount) || 0;

    // Firestore timestamp: { _seconds, _nanoseconds } -> ISO string
    const soldAt =
      typeof createdAt._seconds === 'number'
        ? new Date(createdAt._seconds * 1000).toISOString()
        : new Date().toISOString();

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: paymentObj.id || `ggcheckout_${Date.now()}`,
      amount,
      product_name: product.title || (products[0] && products[0].title) || null,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customerPhone,
      customer_doc: customer.document || null,
      customer_state: customerState,
      customer_city: null as string | null,
      customer_country: 'BR',
      status,
      payment_method: paymentObj.paymentMethod || null,
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: soldAt,
      metadata: {
        event: eventName,
        payment_id: paymentObj.id,
        payment_status: paymentObj.status,
        payment_gateway: paymentObj.gateway,
        product_id: product.id || (products[0] && products[0].id) || null,
        product_type: product.type || null,
        webhook_id: (payload.webhook || {}).id || null,
        business_id: (payload.webhook || {}).businessId || null,
        sck: params.sck || null,
        src: params.src || null,
        gclid: params.gclid || null,
        customer_ip: customer.ip || null,
      },
    };

    // Refunds: find and update original sale, never create phantom rows
    if (status === 'refunded') {
      const { data: existingByExtId } = await supabaseAdmin
        .from('sales').select('id, status').eq('external_id', saleData.external_id).eq('user_id', userId).maybeSingle();

      if (existingByExtId) {
        if (existingByExtId.status !== 'refunded') {
          await supabaseAdmin.from('sales').update({ status: 'refunded' }).eq('id', existingByExtId.id);
        }
      } else {
        const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
          userId, customerEmail: customer.email || null,
          productName: product.title || (products[0] && products[0].title) || null,
          checkoutIntegrationId: integrationId, platform: 'ggcheckout',
        });
        if (!fallbackResult) {
          this.logger.warn(`GGCheckout refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('ggcheckout', {
        amount, customerName: customer.name || null, customerEmail: customer.email || null,
        productName: product.title || (products[0] && products[0].title) || null,
        paymentMethod: paymentObj.paymentMethod || null, adMatched: !!adId,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      });
      await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
      return { status: 200, body: { success: true, action: 'refunded', status } };
    }

    // Approved sales: route through SalesService for plan-limit enforcement
    const sale = await this.salesService.upsertFromWebhook(saleData);

    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    const logData = {
      amount,
      customerName: customer.name || null,
      customerEmail: customer.email || null,
      productName: product.title || (products[0] && products[0].title) || null,
      paymentMethod: paymentObj.paymentMethod || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('ggcheckout', logData);
    } else {
      this.discordLogger.logRefund('ggcheckout', logData);
    }

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
