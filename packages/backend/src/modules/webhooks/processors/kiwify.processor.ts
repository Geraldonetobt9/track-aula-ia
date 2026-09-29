import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import {
  getExchangeRate,
  convertToBRL,
} from '../../../shared/helpers/currency';
import { SalesService } from '../../sales/sales.service';

@Injectable()
export class KiwifyProcessor {
  private readonly logger = new Logger(KiwifyProcessor.name);

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
    query?: Record<string, string>,
  ): Promise<{ status: number; body: any }> {
    const supabaseAdmin = this.supabase.getClient();
    const bodyRaw = body;

    this.logger.log(
      'Kiwify webhook received: ' +
        JSON.stringify(bodyRaw).substring(0, 500),
    );

    // Kiwify international sales wrap everything under "order"
    const kiwifyBody = bodyRaw.order ? bodyRaw.order : bodyRaw;

    // Kiwify sends signature as ?signature=HMAC_SHA1(body, token) or top-level "signature"
    let receivedSignature: string | null = bodyRaw.signature || null;
    if (!receivedSignature && query) {
      receivedSignature = query['signature'] || null;
    }

    this.logger.log(
      'Received signature: ' +
        (receivedSignature
          ? `${receivedSignature.substring(0, 12)}...`
          : 'NULL'),
    );

    if (!receivedSignature) {
      return {
        status: 200,
        body: {
          success: true,
          message: 'Webhook endpoint active. No signature found.',
        },
      };
    }

    // Get all active kiwify integrations and validate HMAC signature
    const { data: integrations, error: intError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, webhook_secret, use_commission_value')
      .eq('platform', 'kiwify')
      .eq('is_active', true);

    if (intError || !integrations?.length) {
      this.logger.error(
        'No active kiwify integrations found:',
        intError,
      );
      return {
        status: 401,
        body: { error: 'No active integration found' },
      };
    }

    let matchedIntegration: any = null;
    const bodyForHmac = rawBody || JSON.stringify(bodyRaw);

    for (const integration of integrations) {
      const secret = integration.webhook_secret;
      if (!secret) continue;

      const computedHex = crypto
        .createHmac('sha1', secret)
        .update(bodyForHmac)
        .digest('hex');

      this.logger.log(
        `Integration ${integration.id}: computed=${computedHex.substring(0, 12)} vs received=${receivedSignature.substring(0, 12)}`,
      );

      if (computedHex === receivedSignature) {
        matchedIntegration = integration;
        this.logger.log(
          'Signature matched for integration: ' + integration.id,
        );
        break;
      }
    }

    if (!matchedIntegration) {
      this.logger.log('No signature match. Received: ' + receivedSignature);
      this.discordLogger.logError('kiwify', {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar com o usuário se o token está correto',
        tokenPartial: receivedSignature ? receivedSignature.slice(-4) : null,
      });
      return { status: 401, body: { error: 'Invalid signature' } };
    }

    const userId = matchedIntegration.user_id;

    const orderId =
      kiwifyBody.order_id || kiwifyBody.subscription?.id || null;
    const orderStatus =
      kiwifyBody.order_status ||
      kiwifyBody.subscription?.status ||
      'pending';
    const customer = kiwifyBody.Customer || kiwifyBody.customer || {};
    const product = kiwifyBody.Product || kiwifyBody.product || {};
    this.logger.log(
      'Product data: ' +
        JSON.stringify(product) +
        ' product_name: ' +
        kiwifyBody.product_name +
        ' product_type: ' +
        kiwifyBody.product_type,
    );
    const tracking =
      kiwifyBody.TrackingParameters || kiwifyBody.tracking_parameters || {};
    const commissions = kiwifyBody.Commissions || kiwifyBody.commissions || {};

    if (!orderId) {
      return { status: 400, body: { error: 'Missing order_id' } };
    }

    const status = this.webhooksService.mapStatus(orderStatus, 'kiwify');
    this.logger.log(
      'Order status: ' + orderStatus + ' -> Mapped status: ' + status,
    );

    // Skip non-approved sales (only process approved and refunded)
    if (status === 'pending') {
      this.logger.log('Skipping pending sale: ' + orderId);
      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', matchedIntegration.id);
      return {
        status: 200,
        body: {
          success: true,
          action: 'skipped',
          reason: 'pending status',
        },
      };
    }

    const adId = this.webhooksService.extractAdId(tracking);
    const utmSource = tracking.src || tracking.utm_source || null;
    const utmMedium = tracking.utm_medium || null;
    const utmCampaign = tracking.utm_campaign || null;
    const utmContent = tracking.utm_content || null;
    const utmTerm = tracking.utm_term || null;

    const { data: existingSale } = await supabaseAdmin
      .from('sales')
      .select('id, status')
      .eq('external_id', orderId)
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
        .eq('id', matchedIntegration.id);
      return { status: 200, body: { success: true, action: 'updated' } };
    }

    // Refund with no matching external_id: try fallback match, never create phantom row
    if (status === 'refunded') {
      const customerEmail = customer.email || null;
      const productName = product.product_name || product.name || kiwifyBody.product_name || null;

      const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
        userId,
        customerEmail,
        productName,
        checkoutIntegrationId: matchedIntegration.id,
        platform: 'kiwify',
      });

      await supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', matchedIntegration.id);

      if (fallbackResult) {
        this.discordLogger.logRefund('kiwify', {
          amount: 0,
          customerName: customer.full_name || customer.name || null,
          customerEmail,
          productName,
          paymentMethod: kiwifyBody.payment_method || null,
          adMatched: false,
          utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
        });
        return { status: 200, body: { success: true, action: 'refunded_via_fallback', sale_id: fallbackResult.id } };
      }

      this.logger.warn(`Kiwify refund skipped — no matching approved sale: external_id=${orderId}, email=${customerEmail}, product=${productName}`);
      return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
    }

    // Extract gross amount + its original currency. Kiwify international sales
    // may quote product_base_price / charge_amount / settlement in non-BRL
    // currencies (USD, COP, etc), so we must convert before persisting.
    let rawAmount: number | string = 0;
    let originalCurrency = 'BRL';
    let priceSource = 'none';

    if (commissions?.product_base_price) {
      rawAmount = commissions.product_base_price;
      originalCurrency = (
        commissions.product_base_price_currency || 'BRL'
      ).toUpperCase();
      priceSource = 'product_base_price';
    } else if (commissions?.charge_amount) {
      rawAmount = commissions.charge_amount;
      originalCurrency = (commissions.currency || 'BRL').toUpperCase();
      priceSource = 'charge_amount';
    } else if (product?.price) {
      rawAmount = product.price;
      priceSource = 'product_price';
    } else if (kiwifyBody.sale_amount) {
      rawAmount = kiwifyBody.sale_amount;
      priceSource = 'sale_amount';
    }

    const parseKiwifyNumber = (value: unknown): number => {
      if (typeof value === 'string') {
        return Number(value.replace(/\./g, '').replace(',', '.'));
      }
      const num = Number(value);
      // Integer values are in centavos (e.g. 4700 = R$47.00)
      if (Number.isInteger(num) && num >= 100) return num / 100;
      return num;
    };

    const originalAmount = parseKiwifyNumber(rawAmount);

    this.logger.log(
      `Raw amount: ${rawAmount} source: ${priceSource} currency: ${originalCurrency} parsed: ${originalAmount}`,
    );

    let amount = originalAmount;
    let exchangeRateUsed = 1.0;

    if (originalCurrency !== 'BRL') {
      exchangeRateUsed = await getExchangeRate(originalCurrency);
      amount = convertToBRL(originalAmount, exchangeRateUsed);
      this.logger.log(
        `[Kiwify] Converted ${originalCurrency} ${originalAmount} -> BRL ${amount} (rate: ${exchangeRateUsed}, source: ${priceSource})`,
      );
    }

    // If user chose to record commission (net) value
    if (matchedIntegration.use_commission_value) {
      const myCommission = commissions?.my_commission;
      if (myCommission) {
        let parsed = parseKiwifyNumber(myCommission);
        if (parsed > 0) {
          const commissionCurrency = (
            commissions?.settlement_amount_currency ||
            originalCurrency ||
            'BRL'
          ).toUpperCase();
          if (commissionCurrency !== 'BRL') {
            const commissionRate =
              commissionCurrency === originalCurrency && exchangeRateUsed !== 1.0
                ? exchangeRateUsed
                : await getExchangeRate(commissionCurrency);
            parsed = convertToBRL(parsed, commissionRate);
            this.logger.log(
              `[Kiwify] Commission converted ${commissionCurrency} -> BRL ${parsed} (rate: ${commissionRate})`,
            );
          }
          amount = parsed;
          this.logger.log('Using commission value: ' + amount);
        }
      }
    }

    const address = customer.address || customer.billing_address || {};
    let customerState = this.webhooksService.normalizeState(
      address.state || address.uf,
    );
    const customerCity = this.webhooksService.normalizeCity(address.city);
    const customerCountry = address.country || 'BR';

    const customerPhone = customer.mobile || customer.phone || null;
    if (!customerState && customerPhone) {
      customerState = this.webhooksService.getStateFromPhone(customerPhone);
    }

    const saleData = {
      user_id: userId,
      workspace_id: matchedIntegration.workspace_id,
      external_id: orderId,
      checkout_integration_id: matchedIntegration.id,
      customer_state: customerState,
      customer_city: customerCity,
      customer_country: customerCountry,
      ad_id: adId || utmTerm || utmContent || utmSource || null,
      product_name:
        product.product_name ||
        product.name ||
        kiwifyBody.product_name ||
        kiwifyBody.Product?.product_name ||
        null,
      customer_name: customer.full_name || customer.name || null,
      customer_email: customer.email || null,
      amount: Number(amount),
      currency: 'BRL',
      status,
      payment_method: kiwifyBody.payment_method || null,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      sold_at: (() => {
        const raw =
          kiwifyBody.created_at || kiwifyBody.approved_date || null;
        if (!raw) return new Date().toISOString();
        // Kiwify sends local BRT time without timezone (e.g. "2026-02-17 09:39")
        if (!raw.includes('T') && !raw.includes('+') && !raw.includes('Z')) {
          return new Date(raw.replace(' ', 'T') + '-03:00').toISOString();
        }
        return raw;
      })(),
      metadata: {
        original_currency: originalCurrency,
        original_amount: originalAmount,
        price_source: priceSource,
        exchange_rate:
          exchangeRateUsed !== 1.0 ? exchangeRateUsed : undefined,
        converted_amount_brl:
          exchangeRateUsed !== 1.0 ? Number(amount) : undefined,
        // Leva o stl_<sessao> que o snippet de rastreio escreve no link do
        // checkout: é o que liga a venda à visita.
        sck: tracking.sck || null,
      },
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
      customerName: customer.full_name || customer.name || null,
      customerEmail: customer.email || null,
      productName: product.product_name || product.name || kiwifyBody.product_name || null,
      paymentMethod: kiwifyBody.payment_method || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('kiwify', logData);
    } else {
      this.discordLogger.logRefund('kiwify', logData);
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', matchedIntegration.id);

    return {
      status: 200,
      body: {
        success: true,
        action: 'created',
      },
    };
  }
}
