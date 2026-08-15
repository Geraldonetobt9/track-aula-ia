import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import {
  getExchangeRate,
  convertToBRL,
} from '../../../shared/helpers/currency';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';
import { parseXcod, extractAdIdFromValue } from './hotmart-tracking.util';

const APPROVED_EVENTS = new Set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE']);
const REFUNDED_EVENTS = new Set([
  'PURCHASE_REFUNDED',
  'PURCHASE_CANCELED',
  'PURCHASE_PROTEST',
  'PURCHASE_CHARGEBACK',
]);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class HotmartProcessor {
  private readonly logger = new Logger(HotmartProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
    private readonly discordLogger: DiscordLoggerService,
    private readonly salesService: SalesService,
  ) {}

  async process(
    body: any,
    authToken: string | null,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook Hotmart received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    // Ignore Hotmart test webhooks
    const purchase = payload.data?.purchase || {};
    const transactionId = purchase.transaction || '';
    const buyerEmail = (payload.data?.buyer?.email || '').toLowerCase();
    const isTestWebhook =
      transactionId === '' ||
      buyerEmail.includes('hotmart.com') ||
      buyerEmail.includes('@test') ||
      buyerEmail === 'test@test.com' ||
      purchase.price?.value === 0;

    if (isTestWebhook) {
      this.logger.log(
        `[Hotmart] Ignoring test webhook: transaction=${transactionId}, email=${buyerEmail}`,
      );
      this.discordLogger.logTestIgnored('hotmart');
      return {
        status: 200,
        body: { success: true, ignored: true, reason: 'Test webhook ignored' },
      };
    }

    // Check event
    const hotmartEvent = (payload.event || '').toUpperCase().trim();
    if (!ACCEPTED_EVENTS.has(hotmartEvent)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${hotmartEvent}" não processado`,
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

    // Find integration by token
    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'hotmart')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .limit(1)
      .maybeSingle();

    if (integrationError || !integration) {
      this.discordLogger.logError('hotmart', {
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
    const status = APPROVED_EVENTS.has(hotmartEvent)
      ? 'approved'
      : 'refunded';

    const product = payload.data?.product || {};
    const buyer = payload.data?.buyer || {};

    // The buyer's actual payment is the source of truth for sale amount.
    // `original_offer_price` is just a USD reference and must NOT be mistaken
    // for the paid amount when the buyer paid in local currency.
    const paymentSource = purchase.price?.value
      ? purchase.price
      : purchase.full_price?.value
        ? purchase.full_price
        : purchase.original_offer_price;

    const paymentCurrency = (
      paymentSource?.currency_value ||
      purchase.currency_value ||
      'BRL'
    ).toUpperCase();
    const paymentValue = Number(paymentSource?.value || 0);

    // MARKETPLACE fee — only deduct the entry whose currency matches what was paid
    const commissions = payload.data?.commissions || [];
    const marketplaceCommission = commissions.find(
      (c: any) =>
        c.source === 'MARKETPLACE' &&
        (c.currency_value || 'BRL').toUpperCase() === paymentCurrency,
    );
    const marketplaceFee = Number(marketplaceCommission?.value || 0);
    const netInPaymentCurrency = paymentValue - marketplaceFee;

    this.logger.log(
      `[Hotmart] Price calc: paid=${paymentValue} ${paymentCurrency} - marketplace_fee=${marketplaceFee} = net=${netInPaymentCurrency} ${paymentCurrency}`,
    );

    let amount = netInPaymentCurrency;
    let exchangeRateUsed = 1.0;

    if (paymentCurrency !== 'BRL') {
      // Prefer Hotmart's own conversion when its source currency matches what was paid
      const matchingProducer = commissions.find(
        (c: any) =>
          c.source === 'PRODUCER' &&
          (c.currency_value || '').toUpperCase() === paymentCurrency &&
          c.currency_conversion?.converted_to_currency === 'BRL' &&
          Number(c.currency_conversion?.conversion_rate) > 0,
      );

      if (matchingProducer) {
        exchangeRateUsed = Number(
          matchingProducer.currency_conversion.conversion_rate,
        );
        amount = convertToBRL(netInPaymentCurrency, exchangeRateUsed);
        this.logger.log(
          `[Hotmart] Converted using Hotmart rate: ${paymentCurrency} ${netInPaymentCurrency} * ${exchangeRateUsed} = BRL ${amount}`,
        );
      } else {
        exchangeRateUsed = await getExchangeRate(paymentCurrency);
        amount = convertToBRL(netInPaymentCurrency, exchangeRateUsed);
        this.logger.log(
          `[Hotmart] Converted via API: ${paymentCurrency} ${netInPaymentCurrency} -> BRL ${amount} (rate: ${exchangeRateUsed})`,
        );
      }
    }

    // If user chose to record commission (net) value instead of sale (gross) value
    if (integration.use_commission_value) {
      const producerCommission = commissions.find(
        (c: any) => c.source === 'PRODUCER',
      );
      if (producerCommission) {
        const producerValue = Number(producerCommission.value || 0);
        if (producerValue > 0) {
          const commissionCurrency = (
            producerCommission.currency_value || 'BRL'
          ).toUpperCase();

          if (commissionCurrency === 'BRL') {
            amount = producerValue;
          } else if (producerCommission.currency_conversion?.converted_value) {
            amount = Number(
              producerCommission.currency_conversion.converted_value,
            );
          } else if (
            Number(producerCommission.currency_conversion?.conversion_rate) > 0
          ) {
            amount = convertToBRL(
              producerValue,
              Number(producerCommission.currency_conversion.conversion_rate),
            );
          } else {
            const rate = await getExchangeRate(commissionCurrency);
            amount = convertToBRL(producerValue, rate);
          }
          this.logger.log(
            `[Hotmart] Using commission value: BRL ${amount} (producer: ${producerValue} ${commissionCurrency})`,
          );
        }
      }
    }

    const externalId = purchase.transaction;
    if (!externalId) {
      return { status: 400, body: { error: 'Missing transaction ID' } };
    }

    // Check existing sale
    const { data: existingSale } = await supabaseAdmin
      .from('sales')
      .select('id, status')
      .eq('external_id', externalId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingSale) {
      if (REFUNDED_EVENTS.has(hotmartEvent)) {
        await supabaseAdmin
          .from('sales')
          .update({ status })
          .eq('id', existingSale.id);
        this.logger.log(
          `Updated sale ${existingSale.id} to status: ${status}`,
        );
      } else {
        this.logger.log(
          `Sale ${externalId} already exists, skipping duplicate`,
        );
      }

      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integrationId);

      return { status: 200, body: { success: true, action: 'updated' } };
    }

    // Refund with no matching external_id: try fallback match, never create phantom row
    if (status === 'refunded') {
      const customerEmail = buyer.email || null;
      const productName = product.name || null;

      const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
        userId,
        customerEmail,
        productName,
        checkoutIntegrationId: integrationId,
        platform: 'hotmart',
      });

      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integrationId);

      if (fallbackResult) {
        this.discordLogger.logRefund('hotmart', {
          amount: 0,
          customerName: buyer.name || null,
          customerEmail,
          productName,
          paymentMethod: purchase.payment?.type || null,
          adMatched: false,
          utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
        });
        return { status: 200, body: { success: true, action: 'refunded_via_fallback', sale_id: fallbackResult.id } };
      }

      this.logger.warn(`Hotmart refund skipped — no matching approved sale: external_id=${externalId}, email=${customerEmail}, product=${productName}`);
      return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
    }

    // UTMs from xcod and origin
    const origin = purchase.origin || {};
    const xcod = origin.xcod || null;
    const src = origin.src || null;
    const sck = origin.sck || null;

    const parsed = parseXcod(xcod);

    const utmSource = parsed.utm_source || src || null;
    const utmMedium = parsed.utm_medium || null;
    const utmCampaign = parsed.utm_campaign || null;
    const utmContent = parsed.utm_content || null;
    const utmTerm = parsed.utm_term || null;
    const adId =
      parsed.ad_id ||
      extractAdIdFromValue(src) ||
      extractAdIdFromValue(sck);
    const adsetFbId = parsed.adset_fb_id || null;
    const campaignFbId = parsed.campaign_fb_id || null;

    // Buyer data
    const buyerAddress = buyer.address || {};
    let customerState = this.webhooksService.normalizeState(
      buyerAddress.state,
    );
    const customerCity = this.webhooksService.normalizeCity(buyerAddress.city);
    const customerCountry =
      buyerAddress.country_iso ||
      (buyerAddress.country === 'Brasil' ? 'BR' : buyerAddress.country) ||
      'BR';
    const customerPhone = buyer.checkout_phone || buyer.phone || null;
    const isBrazil =
      customerCountry === 'BR' ||
      customerCountry === 'BRA' ||
      (buyerAddress.country || '').toLowerCase() === 'brasil';

    if (!customerState && isBrazil && customerPhone) {
      customerState = this.webhooksService.getStateFromPhone(customerPhone);
    }

    // For international sales, use country name as state for region display
    if (!customerState && !isBrazil) {
      customerState = buyerAddress.country || customerCountry;
    }

    const orderDate = purchase.order_date
      ? new Date(
          typeof purchase.order_date === 'number'
            ? purchase.order_date
            : parseInt(purchase.order_date, 10) || purchase.order_date,
        ).toISOString()
      : new Date().toISOString();
    const approvedDate = purchase.approved_date
      ? new Date(
          typeof purchase.approved_date === 'number'
            ? purchase.approved_date
            : parseInt(purchase.approved_date, 10) || purchase.approved_date,
        ).toISOString()
      : null;

    const soldAt =
      status === 'approved' ? approvedDate || orderDate : orderDate;

    const saleData: Record<string, any> = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: externalId,
      checkout_integration_id: integrationId,
      amount: amount,
      currency: 'BRL',
      product_name: product.name || null,
      customer_name: buyer.name || null,
      customer_email: buyer.email || null,
      customer_phone: customerPhone,
      customer_doc: buyer.document || null,
      customer_state: customerState,
      customer_city: customerCity,
      customer_country: customerCountry,
      status,
      payment_method: purchase.payment?.type || null,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      ad_id: adId,
      sold_at: soldAt,
      metadata: {
        event: hotmartEvent,
        hottok:
          (headers?.['x-hottok'] as string) ||
          (headers?.['x-hotmart-hottok'] as string) ||
          null,
        xcod_raw: xcod,
        src,
        sck,
        product_id: product.id,
        product_ucode: product.ucode,
        offer: purchase.offer?.code || null,
        original_currency: paymentCurrency,
        original_amount: netInPaymentCurrency,
        exchange_rate:
          exchangeRateUsed !== 1.0 ? exchangeRateUsed : undefined,
        converted_amount_brl:
          exchangeRateUsed !== 1.0 ? amount : undefined,
        price_value: purchase.price?.value,
        price_currency: purchase.price?.currency_value,
        full_price_value: purchase.full_price?.value,
        full_price_currency: purchase.full_price?.currency_value,
        original_offer_price_value: purchase.original_offer_price?.value,
        original_offer_price_currency:
          purchase.original_offer_price?.currency_value,
        currency_conversion: purchase.currency_conversion || null,
        payment_installments: purchase.payment?.installments_number,
        commissions: payload.data?.commissions,
        affiliates: payload.data?.affiliates,
        producer: payload.data?.producer,
        approved_date: approvedDate,
        order_date: orderDate,
        transaction: purchase.transaction,
        subscription: purchase.subscription || null,
        campaign_fb_id: campaignFbId,
        adset_fb_id: adsetFbId,
      },
    };

    // Route through SalesService for plan-limit enforcement
    const insertedSale = await this.salesService.upsertFromWebhook(saleData);

    const saleId = insertedSale.id;

    // Ad matching (non-blocking, fire-and-forget)
    this.webhooksService.matchAndUpdateSale(saleId, userId, {
      adId,
      utmCampaign,
      utmContent,
      utmTerm,
      adSetFbId: adsetFbId,
      campaignFbId,
    });

    const logData = {
      amount,
      customerName: buyer.name || null,
      customerEmail: buyer.email || null,
      productName: product.name || null,
      paymentMethod: purchase.payment?.type || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('hotmart', logData);
    } else {
      this.discordLogger.logRefund('hotmart', logData);
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    this.logger.log(
      `Hotmart sale processed: ${externalId}, amount: R$ ${amount}, status: ${status}`,
    );

    return {
      status: 200,
      body: {
        success: true,
        action: 'created',
        amount_brl: amount,
        original_currency: paymentCurrency,
        original_amount: netInPaymentCurrency,
      },
    };
  }

}
