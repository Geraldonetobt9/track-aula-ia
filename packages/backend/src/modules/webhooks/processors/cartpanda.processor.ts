import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_EVENTS = new Set(['order.paid']);
const REFUNDED_EVENTS = new Set(['order.refunded']);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class CartPandaProcessor {
  private readonly logger = new Logger(CartPandaProcessor.name);

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
      'Webhook CartPanda received: ' +
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
          reason: `Event "${eventName}" not processed (only order.paid, order.refunded)`,
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'cartpanda')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      this.discordLogger.logError('cartpanda', {
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

    const order = payload.order || {};
    const customer = order.customer || {};
    const payment = order.payment || {};
    const lineItems = order.line_items || [];
    const trackingParams: Array<{ parameter_name: string; parameter_value: string }> =
      order.tracking_parameters || [];

    const status = APPROVED_EVENTS.has(eventName) ? 'approved' : 'refunded';

    const getTrackingParam = (name: string): string | null => {
      const param = trackingParams.find(
        (p) => p.parameter_name === name,
      );
      return param ? param.parameter_value : null;
    };

    const utmSource = getTrackingParam('utm_source');
    const utmMedium = getTrackingParam('utm_medium');
    const utmCampaign = getTrackingParam('utm_campaign');
    const utmContent = getTrackingParam('utm_content');
    const utmTerm = getTrackingParam('utm_term');

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerPhone = customer.phone || null;
    const customerState =
      this.webhooksService.getStateFromPhone(customerPhone);

    let amount =
      typeof payment.amount === 'number'
        ? payment.amount
        : parseFloat(payment.amount) || 0;

    // If user chose to record commission (net) value
    if (integration.use_commission_value) {
      const sellerSplit = Number(payment.seller_split_amount || 0);
      if (sellerSplit > 0) {
        amount = sellerSplit;
        this.logger.log(`[CartPanda] Using commission value: ${amount}`);
      }
    }

    // CartPanda dates are local time without timezone
    const rawDate = order.created_at || '';
    const soldAt = rawDate
      ? rawDate.includes('T') || rawDate.includes('+') || rawDate.includes('Z')
        ? rawDate
        : `${rawDate.replace(' ', 'T')}-03:00`
      : new Date().toISOString();

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: order.id
        ? String(order.id)
        : `cartpanda_${Date.now()}`,
      amount,
      product_name: lineItems[0]?.title || lineItems[0]?.name || null,
      customer_name: customer.full_name || null,
      customer_email: customer.email || order.email || null,
      customer_phone: customerPhone,
      customer_doc: customer.cpf || null,
      customer_state: customerState,
      customer_city: null as string | null,
      customer_country: 'BR',
      status,
      payment_method: payment.payment_type || payment.type || null,
      currency: order.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: soldAt,
      metadata: {
        event: eventName,
        order_id: order.id,
        order_number: order.order_number || order.number,
        click_id: order.click_id,
        shop_id: order.shop_id,
        line_items_count: lineItems.length,
        coproducer_slug: order.coproducer_slug || null,
        coproducer_amount: order.coproducer_amount || null,
        gateway: payment.gateway || null,
        installments: order.no_of_installments || null,
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
          userId, customerEmail: customer.email || order.email || null,
          productName: lineItems[0]?.title || lineItems[0]?.name || null,
          checkoutIntegrationId: integrationId, platform: 'cartpanda',
        });
        if (!fallbackResult) {
          this.logger.warn(`CartPanda refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('cartpanda', {
        amount, customerName: customer.full_name || null,
        customerEmail: customer.email || order.email || null,
        productName: lineItems[0]?.title || lineItems[0]?.name || null,
        paymentMethod: payment.payment_type || payment.type || null,
        adMatched: !!adId, utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
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
      customerName: customer.full_name || null,
      customerEmail: customer.email || order.email || null,
      productName: lineItems[0]?.title || lineItems[0]?.name || null,
      paymentMethod: payment.payment_type || payment.type || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('cartpanda', logData);
    } else {
      this.discordLogger.logRefund('cartpanda', logData);
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
