import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { normalizeState } from '../../../shared/helpers/normalize-state';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_EVENTS = new Set(['invoice.payment_succeeded']);
const REFUNDED_EVENTS = new Set(['refund_request.accepted']);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class HublaProcessor {
  private readonly logger = new Logger(HublaProcessor.name);

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
      'Webhook Hubla received: ' +
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

    const eventType = (payload.type || '').toLowerCase().trim();
    if (!ACCEPTED_EVENTS.has(eventType)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${eventType}" not processed (only invoice.payment_succeeded, refund_request.accepted)`,
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'hubla')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      this.discordLogger.logError('hubla', {
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

    const event = payload.event || {};
    const invoice = event.invoice || {};
    const user = event.user || {};
    const product = event.product || {};
    const products = event.products || [];
    const billingAddress = invoice.billingAddress || {};
    const utm = (invoice.firstPaymentSession || {}).utm || {};
    const amountObj = invoice.amount || {};

    const status = APPROVED_EVENTS.has(eventType) ? 'approved' : 'refunded';

    const customerName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ') || null;

    const amount =
      typeof amountObj.totalCents === 'number'
        ? amountObj.totalCents / 100
        : 0;

    const utmSource = utm.source || null;
    const utmMedium = utm.medium || null;
    const utmCampaign = utm.campaign || null;
    const utmContent = utm.content || null;
    const utmTerm = utm.term || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerState = normalizeState(billingAddress.state) ||
      this.webhooksService.getStateFromPhone(user.phone);

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: invoice.id || `hubla_${Date.now()}`,
      amount,
      product_name: product.name || (products[0] && products[0].name) || null,
      customer_name: customerName,
      customer_email: user.email || null,
      customer_phone: user.phone || null,
      customer_doc: user.document || null,
      customer_state: customerState,
      customer_city: billingAddress.city || null,
      customer_country: billingAddress.countryCode || 'BR',
      status,
      payment_method: invoice.paymentMethod || null,
      currency: invoice.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: invoice.saleDate || new Date().toISOString(),
      metadata: {
        event_type: eventType,
        invoice_id: invoice.id,
        subscription_id: invoice.subscriptionId,
        seller_id: invoice.sellerId,
        installments: invoice.installments,
        subtotal_cents: amountObj.subtotalCents,
        discount_cents: amountObj.discountCents,
        installment_fee_cents: amountObj.installmentFeeCents,
        coupon: invoice.coupon || null,
        ip: (invoice.firstPaymentSession || {}).ip || null,
        product_id: product.id || (products[0] && products[0].id) || null,
        offers: products[0] && products[0].offers ? products[0].offers : null,
        refund: event.refund || null,
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
          userId, customerEmail: user.email || null,
          productName: product.name || (products[0] && products[0].name) || null,
          checkoutIntegrationId: integrationId, platform: 'hubla',
        });
        if (!fallbackResult) {
          this.logger.warn(`Hubla refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('hubla', {
        amount, customerName: customerName, customerEmail: user.email || null,
        productName: product.name || (products[0] && products[0].name) || null,
        paymentMethod: invoice.paymentMethod || null, adMatched: !!adId,
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
      customerName: customerName,
      customerEmail: user.email || null,
      productName: product.name || (products[0] && products[0].name) || null,
      paymentMethod: invoice.paymentMethod || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('hubla', logData);
    } else {
      this.discordLogger.logRefund('hubla', logData);
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
