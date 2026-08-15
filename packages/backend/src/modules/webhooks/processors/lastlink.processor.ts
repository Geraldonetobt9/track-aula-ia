import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

@Injectable()
export class LastLinkProcessor {
  private readonly logger = new Logger(LastLinkProcessor.name);

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
      'Webhook LastLink received: ' +
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

    // Detect event type from payload structure
    const isRefund =
      (payload.Action || '').toLowerCase() === 'remove' ||
      (payload.action || '').toLowerCase() === 'remove';
    const isPurchase = !!payload.Purchase;

    if (!isPurchase && !isRefund) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Payload has no Purchase and no Action=Remove — ignored',
        },
      };
    }

    // Ignore test events
    if (payload.IsTest === true) {
      this.discordLogger.logTestIgnored('lastlink');
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Test event ignored',
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active')
      .eq('platform', 'lastlink')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .limit(1)
      .maybeSingle();

    if (integrationError || !integration) {
      this.discordLogger.logError('lastlink', {
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

    if (isRefund) {
      return this.processRefund(
        supabaseAdmin,
        payload,
        userId,
        integrationId,
      );
    }

    return this.processPurchase(
      supabaseAdmin,
      payload,
      userId,
      workspaceId,
      integrationId,
    );
  }

  private async processPurchase(
    supabaseAdmin: ReturnType<SupabaseService['getClient']>,
    payload: any,
    userId: string,
    workspaceId: string,
    integrationId: string,
  ): Promise<{ status: number; body: any }> {
    const buyer = payload.Buyer || {};
    const purchase = payload.Purchase || {};
    const products = payload.Products || [];
    const product = payload.Product || products[0] || {};
    const payment = purchase.Payment || {};
    const utm = payload.Utm || {};
    const commissions = payload.Commissions || [];
    const subscriptions = payload.Subscriptions || [];
    const deviceInfo = payload.DeviceInfo || {};

    const utmSource = utm.UtmSource || null;
    const utmMedium = utm.UtmMedium || null;
    const utmCampaign = utm.UtmCampaign || null;
    const utmContent = utm.UtmContent || null;
    const utmTerm = utm.UtmTerm || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerPhone = buyer.PhoneNumber || null;
    const customerState =
      this.webhooksService.getStateFromPhone(customerPhone);

    const priceObj = purchase.Price || {};
    const amount =
      typeof priceObj.Value === 'number'
        ? priceObj.Value
        : parseFloat(priceObj.Value) || 0;

    // LastLink dates are local time without timezone
    const rawDate = purchase.PaymentDate || '';
    const soldAt = rawDate
      ? rawDate.includes('T') && (rawDate.includes('+') || rawDate.includes('Z'))
        ? rawDate
        : rawDate.includes('T')
          ? `${rawDate}-03:00`
          : `${rawDate.replace(' ', 'T')}-03:00`
      : new Date().toISOString();

    const subscriptionId = subscriptions[0]?.Id || null;

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: purchase.PaymentId || `lastlink_${Date.now()}`,
      amount,
      product_name: product.Name || null,
      customer_name: buyer.Name ? buyer.Name.trim() : null,
      customer_email: buyer.Email || null,
      customer_phone: customerPhone,
      customer_doc: buyer.Document || null,
      customer_state: customerState,
      customer_city: null as string | null,
      customer_country: 'BR',
      status: 'approved',
      payment_method: payment.PaymentMethod || null,
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: soldAt,
      metadata: {
        event: 'purchase',
        payment_id: purchase.PaymentId,
        subscription_id: subscriptionId,
        utm_id: utm.UtmId || null,
        offer_id: (payload.Offer || {}).Id || null,
        offer_name: (payload.Offer || {}).Name || null,
        seller_id: (payload.Seller || {}).Id || null,
        recurrency: purchase.Recurrency,
        installments: payment.NumberOfInstallments,
        interest_rate: payment.InterestRateAmount,
        original_price: (purchase.OriginalPrice || {}).Value,
        commissions,
        product_id: product.Id || null,
        ip: deviceInfo.ip || null,
        user_agent: deviceInfo.UserAgent || null,
      },
    };

    // Route through SalesService for plan-limit enforcement
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
      customerName: buyer.Name ? buyer.Name.trim() : null,
      customerEmail: buyer.Email || null,
      productName: product.Name || null,
      paymentMethod: payment.PaymentMethod || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    this.discordLogger.logSale('lastlink', logData);

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: { success: true, sale_id: sale?.id, status: 'approved' },
    };
  }

  private async processRefund(
    supabaseAdmin: ReturnType<SupabaseService['getClient']>,
    payload: any,
    userId: string,
    integrationId: string,
  ): Promise<{ status: number; body: any }> {
    const subscriptionId =
      (payload.Subscription || {}).Id || null;

    if (!subscriptionId) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Refund event without Subscription.Id — cannot match sale',
        },
      };
    }

    // Find the original sale by subscription_id stored in raw_data
    const { data: existingSale } = await supabaseAdmin
      .from('sales')
      .select('id, status')
      .eq('user_id', userId)
      .eq('checkout_integration_id', integrationId)
      .filter('metadata->>subscription_id', 'eq', subscriptionId)
      .maybeSingle();

    if (!existingSale) {
      this.logger.warn(
        `LastLink refund: no sale found for subscription_id=${subscriptionId}`,
      );
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `No sale found for subscription_id ${subscriptionId}`,
        },
      };
    }

    if (existingSale.status === 'refunded') {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Sale already refunded',
        },
      };
    }

    const { error: updateError } = await supabaseAdmin
      .from('sales')
      .update({ status: 'refunded' })
      .eq('id', existingSale.id);

    if (updateError) {
      this.logger.error('Error updating sale to refunded:', updateError);
      this.discordLogger.logError('lastlink', {
        errorType: 'save_failed',
        message: 'Erro ao inserir/atualizar venda no banco de dados',
        suggestion: 'Verificar logs do servidor e status do Supabase',
      });
      throw updateError;
    }

    this.discordLogger.logRefund('lastlink', {
      amount: 0,
      customerName: null,
      customerEmail: null,
      productName: null,
      paymentMethod: null,
      adMatched: false,
      utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
    });

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: {
        success: true,
        sale_id: existingSale.id,
        status: 'refunded',
      },
    };
  }
}
