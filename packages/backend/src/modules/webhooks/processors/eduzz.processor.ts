import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_EVENTS = new Set(['myeduzz.invoice_paid']);
const REFUNDED_EVENTS = new Set([
  'myeduzz.invoice_refunded',
  'myeduzz.invoice_canceled',
  'myeduzz.invoice_expired',
  'myeduzz.invoice_refused',
  'myeduzz.invoice_chargeback',
]);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

const STATUS_TO_EVENT: Record<string, string> = {
  paid: 'myeduzz.invoice_paid',
  refunded: 'myeduzz.invoice_refunded',
  canceled: 'myeduzz.invoice_canceled',
  expired: 'myeduzz.invoice_expired',
  refused: 'myeduzz.invoice_refused',
  chargeback: 'myeduzz.invoice_refunded',
};

@Injectable()
export class EduzzProcessor {
  private readonly logger = new Logger(EduzzProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
    private readonly discordLogger: DiscordLoggerService,
    private readonly salesService: SalesService,
  ) {}

  async process(
    body: any,
    authToken: string | null,
    rawBody?: string,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook Eduzz received: ' + JSON.stringify(payload).substring(0, 500),
    );

    let eduzzEvent = (payload.event || '').toLowerCase().trim();
    if (!eduzzEvent && payload.status) {
      eduzzEvent = STATUS_TO_EVENT[String(payload.status).toLowerCase()] || '';
    }

    const isPing =
      payload.event === 'ping' ||
      payload.test === true ||
      payload?.data?.producer?.originSecret === 'originsecrettest';

    if (isPing) {
      return {
        status: 200,
        body: { success: true, ignored: true, reason: 'Eduzz test/ping ignored' },
      };
    }

    if (!ACCEPTED_EVENTS.has(eduzzEvent)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${payload.event || payload.status}" não processado`,
        },
      };
    }

    if (!authToken) {
      return {
        status: 401,
        body: { error: 'Missing authentication token' },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    // Eduzz auth: token may be either the secret directly OR HMAC-SHA256 of raw body
    // Look up by direct match first, then try HMAC fallback.
    let { data: integration } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value, webhook_secret')
      .eq('platform', 'eduzz')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .maybeSingle();

    if (!integration && rawBody) {
      // Fetch all active eduzz integrations and check HMAC
      const { data: candidates } = await supabaseAdmin
        .from('checkout_integrations')
        .select('id, user_id, workspace_id, is_active, use_commission_value, webhook_secret')
        .eq('platform', 'eduzz')
        .eq('is_active', true);

      for (const cand of candidates || []) {
        const expected = crypto
          .createHmac('sha256', cand.webhook_secret || '')
          .update(rawBody)
          .digest('hex');
        if (expected === authToken) {
          integration = cand;
          break;
        }
      }
    }

    if (!integration) {
      this.discordLogger.logError('eduzz', {
        errorType: 'token_invalid',
        message: 'Token/assinatura não corresponde a nenhuma integração ativa',
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
    const status = APPROVED_EVENTS.has(eduzzEvent) ? 'approved' : 'refunded';
    const data = payload.data || {};
    const buyer = data.buyer || data.student || {};
    const items = Array.isArray(data.items)
      ? data.items
      : data.items
        ? [data.items]
        : [];
    const firstItem = items[0] || {};

    const utm = data.utm || {};
    const utmSource = utm.source || null;
    const utmMedium = utm.medium || null;
    const utmCampaign = utm.campaign || null;
    const utmContent = utm.content || null;
    const utmTerm = utm.term || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const grossAmount =
      Number(data.paid?.value) || Number(data.price?.value) || Number(firstItem.price?.value) || 0;
    let amount = grossAmount;
    if (integration.use_commission_value && data.transaction?.netValue) {
      amount = Number(data.transaction.netValue) || amount;
    }

    const customerPhone = buyer.cellphone || buyer.phone || null;
    const productName = firstItem.name || data.offer?.name || null;
    const externalId = data.id ? `eduzz_${data.id}` : `eduzz_${Date.now()}`;

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: externalId,
      amount,
      product_name: productName,
      customer_name: buyer.name || null,
      customer_email: buyer.email || null,
      customer_phone: customerPhone,
      customer_doc: buyer.document || null,
      customer_state: this.webhooksService.getStateFromPhone(customerPhone),
      customer_city: buyer.address?.city || null,
      customer_country: buyer.address?.country || 'BR',
      status,
      payment_method: data.payment?.method || data.paymentMethod || 'unknown',
      currency: data.paid?.currency || data.price?.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: data.paidAt || data.createdAt || new Date().toISOString(),
      metadata: {
        event: eduzzEvent,
        invoice_id: data.id,
        contract_id: data.contract?.id,
        transaction_id: data.transaction?.id,
        installments: data.installments,
        producer_id: data.producer?.id,
        affiliate_id: data.affiliate?.id,
        offer_name: data.offer?.name,
        order_bump: data.orderBump,
        items: items.map((i: any) => ({ productId: i.productId, name: i.name })),
        tracker: data.tracker,
        chargeback: data.chargeback,
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
          customerEmail: buyer.email || null,
          productName,
          checkoutIntegrationId: integrationId,
          platform: 'eduzz',
        });
        if (!fallbackResult) {
          this.logger.warn(
            `Eduzz refund skipped — no matching approved sale: external_id=${saleData.external_id}`,
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

      this.discordLogger.logRefund('eduzz', {
        amount,
        customerName: buyer.name || null,
        customerEmail: buyer.email || null,
        productName,
        paymentMethod: data.payment?.method || data.paymentMethod || 'unknown',
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

    this.discordLogger.logSale('eduzz', {
      amount,
      customerName: buyer.name || null,
      customerEmail: buyer.email || null,
      productName,
      paymentMethod: data.payment?.method || data.paymentMethod || 'unknown',
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
