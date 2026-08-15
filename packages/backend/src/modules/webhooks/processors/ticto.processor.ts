import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

@Injectable()
export class TictoProcessor {
  private readonly logger = new Logger(TictoProcessor.name);

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
      'Webhook Ticto received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    const tictoStatus = (payload.status || '').toLowerCase().trim();
    const isApproved =
      tictoStatus === 'authorized' || tictoStatus === 'approved';
    const isRefund =
      tictoStatus === 'refunded' || tictoStatus === 'chargeback';

    if (!isApproved && !isRefund) {
      return {
        status: 200,
        body: { success: true, ignored: true, reason: tictoStatus },
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
      .eq('platform', 'ticto')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .limit(1)
      .maybeSingle();

    if (integrationError || !integration) {
      this.discordLogger.logError('ticto', {
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
    const status = isApproved ? 'approved' : 'refunded';

    const customer = payload.customer || {};
    const order = payload.order || {};
    const item = payload.item || {};
    const address = customer.address || {};
    const producer = payload.producer || {};
    const tracking = payload.tracking || {};
    // Fallback for old payload
    const queryParams = (payload.url_params || {}).query_params || {};

    // Phone: v2.0 doesn't have customer.phone, use producer.phone
    const customerPhone = producer.phone || null;
    const grossAmount = (order.paid_amount || item.amount || 0) / 100;
    const amount = integration.use_commission_value && Number(producer.amount || 0) > 0
      ? Number(producer.amount) / 100
      : grossAmount;

    // Sold at: use order.order_date from Ticto
    const soldAt = order.order_date
      ? new Date(
          order.order_date.replace(' ', 'T') + '-03:00',
        ).toISOString()
      : new Date().toISOString();

    // Extract numeric ad_id from utm_content
    const rawUtmContent =
      tracking.utm_content || queryParams.utm_content || null;
    const extractedAdId = rawUtmContent
      ? (() => {
          const parts = rawUtmContent.split(/[|\/]/);
          const numericPart = parts.find((p: string) =>
            /^\d{6,}$/.test(p.trim()),
          );
          return numericPart?.trim() || null;
        })()
      : null;

    const saleData: Record<string, any> = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: order.hash || 'ticto_' + Date.now(),
      amount: amount,
      ad_id: extractedAdId,
      product_name: item.product_name || null,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customerPhone,
      customer_doc: customer.cpf || customer.cnpj || null,
      customer_state: address.state || null,
      customer_city: address.city || null,
      customer_country: customer.is_foreign ? 'OTHER' : 'BR',
      status: status,
      payment_method: payload.payment_method || 'unknown',
      currency: 'BRL',
      utm_source:
        tracking.utm_source || queryParams.utm_source || null,
      utm_medium:
        tracking.utm_medium || queryParams.utm_medium || null,
      utm_campaign:
        tracking.utm_campaign || queryParams.utm_campaign || null,
      utm_content:
        tracking.utm_content || queryParams.utm_content || null,
      utm_term: tracking.utm_term || queryParams.utm_term || null,
      checkout_integration_id: integrationId,
      sold_at: soldAt,
      metadata: {
        ticto_status: tictoStatus,
        order_hash: order.hash,
        transaction_hash: order.transaction_hash || null,
        installments: order.installments,
        product_id: item.product_id,
        offer_id: item.offer_id,
        offer_name: item.offer_name,
        offer_code: item.offer_code || null,
        shipping: payload.shipping || null,
        bumps: payload.bumps || null,
        subscriptions: payload.subscriptions || null,
        commission_type: payload.commission_type || null,
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
          userId, customerEmail: customer.email || null, productName: item.product_name || null,
          checkoutIntegrationId: integrationId, platform: 'ticto',
        });
        if (!fallbackResult) {
          this.logger.warn(`Ticto refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('ticto', {
        amount, customerName: customer.name || null, customerEmail: customer.email || null,
        productName: item.product_name || null, paymentMethod: payload.payment_method || 'unknown',
        adMatched: !!extractedAdId,
        utmSource: tracking.utm_source || queryParams.utm_source || null,
        utmMedium: tracking.utm_medium || queryParams.utm_medium || null,
        utmCampaign: tracking.utm_campaign || queryParams.utm_campaign || null,
        utmContent: tracking.utm_content || queryParams.utm_content || null,
        utmTerm: tracking.utm_term || queryParams.utm_term || null,
      });
      await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
      return { status: 200, body: { success: true, action: 'refunded', status } };
    }

    // Approved sales: route through SalesService for plan-limit enforcement
    const sale = await this.salesService.upsertFromWebhook(saleData);

    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, {
        adId: extractedAdId,
        utmCampaign: tracking.utm_campaign || queryParams.utm_campaign || null,
        utmContent: tracking.utm_content || queryParams.utm_content || null,
        utmTerm: tracking.utm_term || queryParams.utm_term || null,
      });
    }

    const logData = {
      amount,
      customerName: customer.name || null,
      customerEmail: customer.email || null,
      productName: item.product_name || null,
      paymentMethod: payload.payment_method || 'unknown',
      adMatched: !!extractedAdId,
      utmSource: tracking.utm_source || queryParams.utm_source || null,
      utmMedium: tracking.utm_medium || queryParams.utm_medium || null,
      utmCampaign: tracking.utm_campaign || queryParams.utm_campaign || null,
      utmContent: tracking.utm_content || queryParams.utm_content || null,
      utmTerm: tracking.utm_term || queryParams.utm_term || null,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('ticto', logData);
    } else {
      this.discordLogger.logRefund('ticto', logData);
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: { success: true, sale_id: sale?.id, status: status },
    };
  }
}
