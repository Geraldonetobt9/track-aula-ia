import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_EVENTS = new Set(['purchase_approved']);
const REFUNDED_EVENTS = new Set(['refund', 'chargeback']);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class CaktoProcessor {
  private readonly logger = new Logger(CaktoProcessor.name);

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
      'Webhook Cakto received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    const caktoEvent = (payload.event || '').toLowerCase().trim();
    if (!ACCEPTED_EVENTS.has(caktoEvent)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${caktoEvent}" não processado`,
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
      .eq('platform', 'cakto')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      this.discordLogger.logError('cakto', {
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
    const status = APPROVED_EVENTS.has(caktoEvent)
      ? 'approved'
      : 'refunded';
    const data = payload.data || {};

    const utmSource = data.utm_source || null;
    const utmMedium = data.utm_medium || null;
    const utmCampaign = data.utm_campaign || null;
    const utmContent = data.utm_content || null;
    const utmTerm = data.utm_term || null;
    const sck = data.sck || null;

    const adId =
      this.webhooksService.extractNumericAdId(utmContent) ||
      this.webhooksService.extractNumericAdId(sck);

    const customer = data.customer || {};
    const grossAmount =
      typeof data.amount === 'number'
        ? data.amount
        : parseFloat(data.amount) || 0;
    let amount = grossAmount;
    if (integration.use_commission_value) {
      const producerEntry = (data.commissions || []).find(
        (c: any) => c.type === 'producer',
      );
      if (producerEntry && Number(producerEntry.totalAmount) > 0) {
        amount = Number(producerEntry.totalAmount);
        this.logger.log(`[Cakto] Using commission value: ${amount}`);
      }
    }

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: data.refId || data.id || `cakto_${Date.now()}`,
      amount,
      product_name: data.product?.name || data.offer?.name || null,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customer.phone || null,
      customer_doc: customer.docNumber || null,
      customer_state: this.webhooksService.getStateFromPhone(customer.phone),
      customer_city: null as string | null,
      customer_country: 'BR',
      status,
      payment_method: data.paymentMethod || 'unknown',
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: data.paidAt || data.createdAt || new Date().toISOString(),
      metadata: {
        event: caktoEvent,
        order_id: data.id,
        ref_id: data.refId,
        base_amount: data.baseAmount,
        discount: data.discount,
        fees: data.fees,
        coupon_code: data.couponCode,
        reason: data.reason,
        refund_reason: data.refund_reason,
        installments: data.installments,
        offer_id: data.offer?.id,
        offer_name: data.offer?.name,
        offer_type: data.offer_type,
        product_id: data.product?.id,
        product_short_id: data.product?.short_id,
        parent_order: data.parent_order,
        checkout_url: data.checkoutUrl,
        checkout: data.checkout,
        sck,
        affiliate: data.affiliate,
        release_date: data.releaseDate,
        refunded_at: data.refundedAt,
        chargedback_at: data.chargedbackAt,
        canceled_at: data.canceledAt,
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
          productName: data.product?.name || data.offer?.name || null,
          checkoutIntegrationId: integrationId, platform: 'cakto',
        });
        if (!fallbackResult) {
          this.logger.warn(`Cakto refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('cakto', {
        amount, customerName: customer.name || null, customerEmail: customer.email || null,
        productName: data.product?.name || data.offer?.name || null, paymentMethod: data.paymentMethod || 'unknown',
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
      customerEmail: customer.email || null,
      productName: data.product?.name || data.offer?.name || null,
      paymentMethod: data.paymentMethod || 'unknown',
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('cakto', logData);
    } else {
      this.discordLogger.logRefund('cakto', logData);
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
