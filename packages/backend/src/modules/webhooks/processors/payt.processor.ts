import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_ORDER_STATUSES = new Set(['paid', 'billed']);
const REFUNDED_PAYMENT_STATUSES = new Set([
  'refunded',
  'refunded_partial',
  'chargeback',
  'chargeback_presented',
  'one_click_buy_refunded',
  'one_click_buy_refunded_partial',
]);

@Injectable()
export class PaytProcessor {
  private readonly logger = new Logger(PaytProcessor.name);

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
      'Webhook PayT received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    if (payload.test === true) {
      this.discordLogger.logTestIgnored('payt');
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Venda de teste (homologação)',
        },
      };
    }

    const orderStatus = (payload.status || '').toLowerCase().trim();
    const paymentStatus = (
      payload.transaction?.payment_status || ''
    )
      .toLowerCase()
      .trim();

    let status: 'approved' | 'refunded' | null = null;
    if (APPROVED_ORDER_STATUSES.has(orderStatus)) {
      status = 'approved';
    } else if (REFUNDED_PAYMENT_STATUSES.has(paymentStatus)) {
      status = 'refunded';
    }

    if (!status) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Status "${orderStatus}" / payment "${paymentStatus}" não processado`,
        },
      };
    }

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

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'payt')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      this.discordLogger.logError('payt', {
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

    const sources = payload.link?.sources || {};
    const queryParams = payload.link?.query_params || {};

    const utmSource = sources.utm_source || sources.src || null;
    const utmMedium = sources.utm_medium || null;
    const utmCampaign = sources.utm_campaign || null;
    const utmContent = sources.utm_content || null;
    const utmTerm = sources.utm_term || null;

    const adId =
      this.webhooksService.extractNumericAdId(utmContent) ||
      this.webhooksService.extractNumericAdId(sources.src);

    const customer = payload.customer || {};
    const billingAddress = customer.billing_address || {};

    let customerState = this.webhooksService.normalizeState(
      billingAddress.state,
    );
    const customerCity = billingAddress.city || null;
    const customerCountry = billingAddress.country || 'BR';

    if (!customerState && customer.phone) {
      customerState = this.webhooksService.getStateFromPhone(customer.phone);
    }

    const transaction = payload.transaction || {};
    const product = payload.product || {};
    const amountInCents = transaction.total_price || product.price || 0;
    const grossAmount = amountInCents / 100;
    let amount = grossAmount;
    if (integration.use_commission_value) {
      const producerEntry = (payload.commission || []).find(
        (c: any) => c.type === 'producer',
      );
      if (producerEntry && Number(producerEntry.amount) > 0) {
        amount = Number(producerEntry.amount) / 100;
        this.logger.log(`[PayT] Using commission value: ${amount}`);
      }
    }

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: payload.transaction_id,
      amount,
      product_name: product.name || null,
      customer_name: customer.name || null,
      customer_email: customer.fake_email
        ? null
        : customer.email || null,
      customer_phone: customer.phone || null,
      customer_doc: customer.doc || null,
      customer_state: customerState,
      customer_city: customerCity,
      customer_country: customerCountry,
      status,
      payment_method: transaction.payment_method || 'unknown',
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      ad_id: adId,
      checkout_integration_id: integrationId,
      sold_at: transaction.paid_at
        ? new Date(
            transaction.paid_at.replace(' ', 'T') + '-03:00',
          ).toISOString()
        : transaction.created_at
          ? new Date(
              transaction.created_at.replace(' ', 'T') + '-03:00',
            ).toISOString()
          : new Date().toISOString(),
      metadata: {
        seller_id: payload.seller_id,
        order_status: orderStatus,
        payment_status: paymentStatus,
        type: payload.type,
        tangible: payload.tangible,
        cart_recovered: payload.cart_recovered,
        cart_id: payload.cart_id,
        installments: transaction.installments,
        product_code: product.code,
        product_sku: product.sku,
        link_title: payload.link?.title,
        customer_code: customer.code,
        fbclid: queryParams.fbclid || null,
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
          userId, customerEmail: customer.fake_email ? null : customer.email || null,
          productName: product.name || null, checkoutIntegrationId: integrationId, platform: 'payt',
        });
        if (!fallbackResult) {
          this.logger.warn(`PayT refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('payt', {
        amount, customerName: customer.name || null,
        customerEmail: customer.fake_email ? null : customer.email || null,
        productName: product.name || null, paymentMethod: transaction.payment_method || 'unknown',
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
      customerName: customer.name || null,
      customerEmail: customer.fake_email ? null : customer.email || null,
      productName: product.name || null,
      paymentMethod: transaction.payment_method || 'unknown',
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('payt', logData);
    } else {
      this.discordLogger.logRefund('payt', logData);
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
