import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import {
  getExchangeRate,
  convertToBRL,
} from '../../../shared/helpers/currency';
import { SalesService } from '../../sales/sales.service';

const APPROVED_STATUSES = new Set([2, 8, 10]);
const REFUNDED_STATUSES = new Set([6, 7, 9]);
const ACCEPTED_STATUSES = new Set([...APPROVED_STATUSES, ...REFUNDED_STATUSES]);

@Injectable()
export class PerfectPayProcessor {
  private readonly logger = new Logger(PerfectPayProcessor.name);

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
      'Webhook PerfectPay received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    const statusEnum = Number(payload.sale_status_enum);
    if (!ACCEPTED_STATUSES.has(statusEnum)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Status ${statusEnum} não processado (apenas aprovados e reembolsos)`,
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
      .eq('platform', 'perfectpay')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      this.discordLogger.logError('perfectpay', {
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

    const status = APPROVED_STATUSES.has(statusEnum)
      ? 'approved'
      : 'refunded';

    const metadata = payload.metadata || {};
    const utmSource = metadata.utm_source || metadata.src || null;
    const utmMedium = metadata.utm_medium || null;
    const utmCampaign = metadata.utm_campaign || null;
    const utmContent = metadata.utm_content || null;
    const utmTerm = metadata.utm_term || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customer = payload.customer || {};
    let customerState = this.webhooksService.normalizeState(customer.state);
    const customerCity = customer.city || null;
    const customerCountry = customer.country || 'BR';
    const customerPhone =
      customer.phone_area_code && customer.phone_number
        ? `${customer.phone_area_code}${customer.phone_number}`
        : null;

    if (!customerState && customer.phone_area_code) {
      customerState = this.webhooksService.getStateFromDDD(
        customer.phone_area_code,
      );
    }
    if (!customerState && customerPhone) {
      customerState = this.webhooksService.getStateFromPhone(customerPhone);
    }

    // PerfectPay international sales come with `currency_enum_key` (e.g. "USD").
    // Convert to BRL so downstream analytics stay in a single currency.
    const saleCurrency = (payload.currency_enum_key || 'BRL').toUpperCase();
    let originalAmount = Number(payload.sale_amount || 0);
    let conversionCurrency = saleCurrency;

    if (integration.use_commission_value) {
      const producerEntry = (payload.commission || []).find(
        (c: any) => c.affiliation_type_enum_key === 'producer',
      );
      if (producerEntry && Number(producerEntry.commission_amount) > 0) {
        originalAmount = Number(producerEntry.commission_amount);
        conversionCurrency = (
          producerEntry.currency_enum_key || saleCurrency
        ).toUpperCase();
        this.logger.log(
          `[PerfectPay] Using commission value: ${originalAmount} ${conversionCurrency}`,
        );
      }
    }

    let finalAmount = originalAmount;
    let exchangeRateUsed = 1.0;

    if (conversionCurrency !== 'BRL') {
      exchangeRateUsed = await getExchangeRate(conversionCurrency);
      finalAmount = convertToBRL(originalAmount, exchangeRateUsed);
      this.logger.log(
        `[PerfectPay] Converted ${conversionCurrency} ${originalAmount} -> BRL ${finalAmount} (rate: ${exchangeRateUsed})`,
      );
    }

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: payload.code,
      amount: finalAmount,
      product_name: payload.product?.name || null,
      customer_name: customer.full_name || null,
      customer_email: customer.email || null,
      customer_phone: customerPhone,
      customer_doc: customer.identification_number || null,
      customer_state: customerState,
      customer_city: customerCity,
      customer_country: customerCountry,
      status: status,
      payment_method: this.mapPaymentMethod(
        payload.payment_type_enum,
        payload.payment_method_enum,
      ),
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      ad_id: adId,
      checkout_integration_id: integrationId,
      sold_at: payload.date_created
        ? new Date(
            payload.date_created.replace(' ', 'T') + '-03:00',
          ).toISOString()
        : new Date().toISOString(),
      metadata: {
        sale_status_enum: statusEnum,
        sale_status_detail: payload.sale_status_detail,
        payment_type_enum: payload.payment_type_enum,
        payment_method_enum: payload.payment_method_enum,
        installments: payload.installments,
        product_code: payload.product?.code,
        plan_code: payload.plan?.code,
        plan_name: payload.plan?.name,
        coupon_code: payload.coupon_code,
        original_currency: conversionCurrency,
        original_amount: originalAmount,
        exchange_rate:
          exchangeRateUsed !== 1.0 ? exchangeRateUsed : undefined,
        converted_amount_brl:
          exchangeRateUsed !== 1.0 ? finalAmount : undefined,
      },
    };

    // Refunds: find and update original sale, never create phantom rows
    if (status === 'refunded') {
      const { data: existingByExtId } = await supabaseAdmin
        .from('sales')
        .select('id, status')
        .eq('external_id', saleData.external_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingByExtId) {
        if (existingByExtId.status !== 'refunded') {
          await supabaseAdmin.from('sales').update({ status: 'refunded' }).eq('id', existingByExtId.id);
        }
      } else {
        const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
          userId,
          customerEmail: customer.email || null,
          productName: payload.product?.name || null,
          checkoutIntegrationId: integrationId,
          platform: 'perfectpay',
        });

        if (!fallbackResult) {
          this.logger.warn(`PerfectPay refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('perfectpay', {
        amount: finalAmount,
        customerName: customer.full_name || null,
        customerEmail: customer.email || null,
        productName: payload.product?.name || null,
        paymentMethod: this.mapPaymentMethod(payload.payment_type_enum, payload.payment_method_enum),
        adMatched: !!adId,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
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
      amount: finalAmount,
      customerName: customer.full_name || null,
      customerEmail: customer.email || null,
      productName: payload.product?.name || null,
      paymentMethod: this.mapPaymentMethod(payload.payment_type_enum, payload.payment_method_enum),
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('perfectpay', logData);
    } else {
      this.discordLogger.logRefund('perfectpay', logData);
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

  private mapPaymentMethod(
    paymentTypeEnum: number,
    paymentMethodEnum: number,
  ): string {
    switch (paymentTypeEnum) {
      case 1:
        return 'credit_card';
      case 2:
        return 'boleto';
      case 3:
        return 'paypal';
      case 4:
        return 'credit_card_recurrent';
      case 5:
        return 'free';
      case 6:
        return 'credit_card_upsell';
      default:
        break;
    }
    switch (paymentMethodEnum) {
      case 1:
        return 'visa';
      case 2:
        return 'boleto';
      case 3:
        return 'amex';
      case 4:
        return 'elo';
      case 5:
        return 'hipercard';
      case 6:
        return 'mastercard';
      case 7:
        return 'melicard';
      default:
        return 'unknown';
    }
  }
}
