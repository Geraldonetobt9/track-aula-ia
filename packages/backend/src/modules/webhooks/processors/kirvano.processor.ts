import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

@Injectable()
export class KirvanoProcessor {
  private readonly logger = new Logger(KirvanoProcessor.name);

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
    const supabaseAdmin = this.supabase.getClient();

    this.logger.log(
      'Kirvano webhook received: ' +
        JSON.stringify(body).substring(0, 500),
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

    // Find integration by token
    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, webhook_secret, use_commission_value')
      .eq('platform', 'kirvano')
      .eq('webhook_secret', authToken)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (integrationError || !integration) {
      this.discordLogger.logError('kirvano', {
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
    const workspaceId = integration.workspace_id;

    const sale = body.sale || body.data?.sale || body;
    const customer =
      body.customer || body.data?.customer || sale.customer || {};
    const product = body.product || body.data?.product || sale.product || {};
    const tracking =
      body.tracking || body.data?.tracking || sale.tracking || {};

    const externalId =
      sale.transaction_id ||
      sale.sale_id ||
      sale.id ||
      body.transaction_id ||
      null;
    const saleStatus = sale.status || body.status || 'pending';

    if (!externalId) {
      return { status: 400, body: { error: 'Missing transaction_id' } };
    }

    const status = this.webhooksService.mapStatus(saleStatus, 'kirvano');

    const adId = this.webhooksService.extractAdId(tracking);
    const utmSource = tracking.utm_source || tracking.src || null;
    const utmMedium = tracking.utm_medium || null;
    const utmCampaign = tracking.utm_campaign || null;
    const utmContent = tracking.utm_content || null;
    const utmTerm = tracking.utm_term || null;

    const { data: existingSale } = await supabaseAdmin
      .from('sales')
      .select('id, status')
      .eq('external_id', externalId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingSale) {
      if (status !== existingSale.status) {
        await supabaseAdmin
          .from('sales')
          .update({ status })
          .eq('id', existingSale.id);
      }
      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integration.id);
      return { status: 200, body: { success: true, action: 'updated' } };
    }

    // Refund with no matching external_id: try fallback match, never create phantom row
    if (status === 'refunded') {
      const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
        userId,
        customerEmail: customer.email || null,
        productName: product.name || sale.product_name || null,
        checkoutIntegrationId: integration.id,
        platform: 'kirvano',
      });

      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integration.id);

      if (fallbackResult) {
        this.discordLogger.logRefund('kirvano', {
          amount: 0,
          customerName: customer.name || customer.full_name || null,
          customerEmail: customer.email || null,
          productName: product.name || sale.product_name || null,
          paymentMethod: sale.payment_method || body.payment_method || null,
          adMatched: false,
          utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
        });
        return { status: 200, body: { success: true, action: 'refunded_via_fallback', sale_id: fallbackResult.id } };
      }

      this.logger.warn(`Kirvano refund skipped — no matching approved sale: external_id=${externalId}`);
      return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
    }

    const grossAmount = sale.amount || sale.value || body.amount || 0;
    const commissionValue = Number(body.commission || body.fiscal?.commission || 0);
    const amount = integration.use_commission_value && commissionValue > 0
      ? commissionValue
      : Number(grossAmount);

    const buyer = body.buyer || {};
    const address = buyer.address || customer.address || {};
    let customerState = this.webhooksService.normalizeState(
      address.state || address.uf,
    );
    const customerCity = this.webhooksService.normalizeCity(address.city);
    const customerCountry = address.country || 'BR';

    const customerPhone = customer.phone || null;
    if (!customerState && customerPhone) {
      customerState = this.webhooksService.getStateFromPhone(customerPhone);
    }

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: externalId,
      checkout_integration_id: integration.id,
      customer_state: customerState,
      customer_city: customerCity,
      customer_country: customerCountry,
      ad_id: adId || utmTerm || utmContent || null,
      product_name: product.name || sale.product_name || null,
      customer_name: customer.name || customer.full_name || null,
      customer_email: customer.email || null,
      amount: Number(amount),
      currency: sale.currency || 'BRL',
      status,
      payment_method: sale.payment_method || body.payment_method || null,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      sold_at:
        sale.date ||
        sale.created_at ||
        body.created_at ||
        new Date().toISOString(),
      // Leva o stl_<sessao> que o snippet de rastreio escreve no link do
      // checkout: é o que liga a venda à visita.
      metadata: { sck: tracking.sck || null },
    };

    // Route through SalesService for plan-limit enforcement
    const insertedSale = await this.salesService.upsertFromWebhook(saleData);

    if (insertedSale?.id) {
      this.webhooksService.matchAndUpdateSale(insertedSale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    const logData = {
      amount: Number(amount),
      customerName: customer.name || customer.full_name || null,
      customerEmail: customer.email || null,
      productName: product.name || sale.product_name || null,
      paymentMethod: sale.payment_method || body.payment_method || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('kirvano', logData);
    } else {
      this.discordLogger.logRefund('kirvano', logData);
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integration.id);

    return {
      status: 200,
      body: {
        success: true,
        action: 'created',
      },
    };
  }
}
