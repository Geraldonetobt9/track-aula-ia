import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_STATUSES = new Set(['paid']);
const REFUNDED_STATUSES = new Set(['refunded', 'chargedback', 'canceled', 'unpaid']);
const ACCEPTED_STATUSES = new Set([...APPROVED_STATUSES, ...REFUNDED_STATUSES]);

const IGNORED_EVENTS = new Set(['checkoutAbandoned']);
const IGNORED_TYPES = new Set(['lead']);

@Injectable()
export class GreennProcessor {
  private readonly logger = new Logger(GreennProcessor.name);

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
    const payload = body || {};

    this.logger.log(
      'Webhook Greenn received: ' + JSON.stringify(payload).substring(0, 500),
    );

    const greennEvent = payload.event || '';
    const greennType = payload.type || '';
    const currentStatus = (payload.currentStatus || '').toLowerCase().trim();

    if (IGNORED_EVENTS.has(greennEvent) || IGNORED_TYPES.has(greennType)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${greennEvent}" / type "${greennType}" não processado`,
        },
      };
    }

    if (!ACCEPTED_STATUSES.has(currentStatus)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `currentStatus "${currentStatus}" não processado`,
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

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'greenn')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .maybeSingle();

    if (integrationError || !integration) {
      this.discordLogger.logError('greenn', {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar Webhook Token na Greenn (Sistema > Tokens e API Key)',
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
    const status = APPROVED_STATUSES.has(currentStatus) ? 'approved' : 'refunded';

    const sale = payload.sale || {};
    const product = payload.product || {};
    const offer = payload.offer || {};
    const client = payload.client || {};
    const saleMetas: any[] = Array.isArray(payload.saleMetas) ? payload.saleMetas : [];

    // Greenn UTMs come as saleMetas items with meta_key/meta_value
    const metaMap: Record<string, string> = {};
    for (const m of saleMetas) {
      if (m?.meta_key) metaMap[m.meta_key] = m.meta_value;
    }
    const utmSource = metaMap['utm_source'] || null;
    const utmMedium = metaMap['utm_medium'] || null;
    const utmCampaign = metaMap['utm_campaign'] || null;
    const utmContent = metaMap['utm_content'] || null;
    const utmTerm = metaMap['utm_term'] || null;
    const fbclid = metaMap['fbclid'] || null;
    const sck = metaMap['sck'] || null;

    const adId =
      this.webhooksService.extractNumericAdId(utmContent) ||
      this.webhooksService.extractNumericAdId(metaMap['utm_id']) ||
      this.webhooksService.extractNumericAdId(sck);

    const grossAmount =
      Number(sale.total) || Number(sale.amount) || Number(offer.amount) || 0;
    const fee = Number(sale.fee) || 0;
    const sellerBalance = Number(sale.seller_balance) || 0;
    let amount = grossAmount;
    if (integration.use_commission_value && sellerBalance > 0) {
      amount = sellerBalance;
    }
    void fee;

    const customerPhone = client.cellphone || null;
    const productName = product.name || offer.name || payload.oferta || null;
    const transactionId = sale.id || payload.contract?.id;
    const externalId = transactionId
      ? `greenn_${transactionId}`
      : `greenn_${Date.now()}`;

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: externalId,
      amount,
      product_name: productName,
      customer_name: client.name || null,
      customer_email: client.email || null,
      customer_phone: customerPhone,
      customer_doc: client.document || client.cpf_cnpj || null,
      customer_state:
        client.uf || this.webhooksService.getStateFromPhone(customerPhone),
      customer_city: client.city || null,
      customer_country: 'BR',
      status,
      payment_method: sale.method || product.method || 'unknown',
      currency: payload.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: sale.paid_at || sale.created_at || new Date().toISOString(),
      metadata: {
        event: greennEvent,
        type: greennType,
        currentStatus,
        oldStatus: payload.oldStatus,
        sale_id: sale.id,
        offer_hash: offer.hash,
        product_id: product.id,
        installments: sale.installments,
        seller_balance: sale.seller_balance,
        fee: sale.fee,
        is_smart_sale: sale.is_smart_sale,
        contract_id: payload.contract?.id,
        subscription_id: sale.subscription_id,
        fbclid,
        sck,
        utm_id: metaMap['utm_id'],
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
          customerEmail: client.email || null,
          productName,
          checkoutIntegrationId: integrationId,
          platform: 'greenn',
        });
        if (!fallbackResult) {
          this.logger.warn(
            `Greenn refund skipped — no matching approved sale: external_id=${saleData.external_id}`,
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

      this.discordLogger.logRefund('greenn', {
        amount,
        customerName: client.name || null,
        customerEmail: client.email || null,
        productName,
        paymentMethod: sale.method || 'unknown',
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

    const upserted = await this.salesService.upsertFromWebhook(saleData);

    if (upserted?.id) {
      this.webhooksService.matchAndUpdateSale(upserted.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    this.discordLogger.logSale('greenn', {
      amount,
      customerName: client.name || null,
      customerEmail: client.email || null,
      productName,
      paymentMethod: sale.method || 'unknown',
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
      body: { success: true, sale_id: upserted?.id, status },
    };
  }
}
