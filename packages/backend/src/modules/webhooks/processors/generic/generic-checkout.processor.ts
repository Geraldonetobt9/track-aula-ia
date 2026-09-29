import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../../../shared/services/discord-logger.service';
import { SalesService } from '../../../sales/sales.service';
import { WebhooksService } from '../../webhooks.service';
import { CHECKOUT_SPECS } from './checkout-specs';
import { parseCheckout, ParsedCheckout } from './checkout-parser';

type Result = { status: number; body: any };

/** Data aceita pelo Postgres, ou null (vale a hora do recebimento). */
function toIso(value: string | null): string | null {
  if (!value) return null;
  const numeric = /^\d{10,13}$/.test(value) ? Number(value) * (value.length === 10 ? 1000 : 1) : NaN;
  const d = new Date(Number.isFinite(numeric) ? numeric : value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Processor das plataformas que vieram dos containers do sGTM: Wiven,
 * Frendz, Herospark, Kavoo, PagTrust, Assiny, Yampi, Wiapy e Doppus.
 *
 * Um só, dirigido pela tabela CHECKOUT_SPECS, em vez de nove cópias do mesmo
 * fluxo: o que muda entre elas é onde cada campo mora no payload. O fluxo é o
 * dos processors existentes (Cakto como referência):
 *
 *   token → integração → decisão (aprovada / reembolso / ignorar)
 *   aprovada  → SalesService.upsertFromWebhook (casamento com a visita e
 *               Purchase da CAPI vêm daí) → atribuição por UTM
 *   reembolso → atualiza a venda existente; nunca cria linha
 *
 * Autenticação: essas plataformas não mandam token próprio — o Data Client
 * dos containers aceitava qualquer requisição. Aqui vale o token gerado no
 * painel, na URL (?token=, como na Mundpay) ou em header/corpo, se a
 * plataforma permitir.
 */
@Injectable()
export class GenericCheckoutProcessor {
  private readonly logger = new Logger(GenericCheckoutProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
    private readonly discordLogger: DiscordLoggerService,
    private readonly salesService: SalesService,
  ) {}

  async process(
    platform: string,
    body: any,
    authToken: string | null,
    queryParams: Record<string, string> = {},
  ): Promise<Result> {
    const spec = CHECKOUT_SPECS[platform];
    if (!spec) return { status: 404, body: { error: `Plataforma desconhecida: ${platform}` } };

    this.logger.log(`Webhook ${spec.label}: ${JSON.stringify(body ?? {}).substring(0, 500)}`);

    // A URL primeiro: o extrator genérico também lê `token` do corpo, e um
    // campo da própria plataforma com esse nome tomaria o lugar do nosso.
    const token = queryParams.token || authToken || null;
    if (!token) {
      // 401, e não 200: sem token a venda se perderia em silêncio, e a
      // plataforma marcaria a entrega como feita (ver o fix da Hubla, 8c03d4c).
      return {
        status: 401,
        body: { error: 'Token ausente. Use a URL do webhook com ?token=<token> gerada no painel.' },
      };
    }

    const supabaseAdmin = this.supabase.getClient();
    const { data: integration } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', platform)
      .eq('is_active', true)
      .eq('webhook_secret', token)
      .maybeSingle();

    if (!integration) {
      this.discordLogger.logError(platform, {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Conferir se a URL colada na plataforma tem o ?token= do painel',
        tokenPartial: token.slice(-4),
      });
      return { status: 401, body: { error: 'Invalid token or integration not found' } };
    }

    const parsed = parseCheckout(spec, body);
    const touch = () =>
      supabaseAdmin
        .from('checkout_integrations')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', integration.id);

    if (parsed.decision === 'ignored') {
      await touch();
      return { status: 200, body: { success: true, ignored: true, reason: parsed.reason } };
    }

    if (!parsed.externalId) {
      this.logger.warn(`${spec.label}: webhook sem id da transacao (${spec.externalId.join(', ')})`);
      return { status: 400, body: { error: 'Id da transacao ausente no payload' } };
    }

    const amount = this.amount(parsed, integration.use_commission_value);

    if (parsed.decision === 'refunded') {
      return this.refund(spec.platform, integration, parsed, touch);
    }

    const country = (parsed.country ?? 'BR').toUpperCase();
    const isBrazil = country === 'BR' || country === 'BRA';
    const saleData = {
      user_id: integration.user_id,
      workspace_id: integration.workspace_id,
      checkout_integration_id: integration.id,
      external_id: parsed.externalId,
      amount,
      currency: parsed.currency,
      product_name: parsed.productName,
      customer_name: parsed.customerName,
      customer_email: parsed.customerEmail,
      customer_phone: parsed.customerPhone,
      customer_doc: parsed.customerDoc,
      customer_state:
        this.webhooksService.normalizeState(parsed.state) ??
        (isBrazil ? this.webhooksService.getStateFromPhone(parsed.customerPhone) : null),
      customer_city: this.webhooksService.normalizeCity(parsed.city),
      customer_country: isBrazil ? 'BR' : country,
      status: 'approved',
      payment_method: parsed.paymentMethod,
      utm_source: parsed.utmSource,
      utm_medium: parsed.utmMedium,
      utm_campaign: parsed.utmCampaign,
      utm_content: parsed.utmContent,
      utm_term: parsed.utmTerm,
      sold_at: toIso(parsed.soldAt) ?? new Date().toISOString(),
      metadata: {
        event: parsed.event,
        status_raw: parsed.status,
        decision_reason: parsed.reason,
        product_id: parsed.productId,
        zipcode: parsed.zip,
        gross_amount: parsed.grossAmount,
        commission_amount: parsed.commissionAmount,
        indexer: parsed.indexer,
      },
    };

    const sale = await this.salesService.upsertFromWebhook(saleData);

    const adId =
      this.webhooksService.extractNumericAdId(parsed.utmContent) ||
      this.webhooksService.extractNumericAdId(parsed.utmTerm);
    if (sale?.id) {
      // Aguardado: na Vercel a função congela quando o webhook responde.
      await this.webhooksService.matchAndUpdateSale(sale.id, integration.user_id, {
        adId,
        utmCampaign: parsed.utmCampaign,
        utmContent: parsed.utmContent,
        utmTerm: parsed.utmTerm,
      });
    }

    this.discordLogger.logSale(platform, {
      amount,
      customerName: parsed.customerName,
      customerEmail: parsed.customerEmail,
      productName: parsed.productName,
      paymentMethod: parsed.paymentMethod,
      adMatched: !!adId,
      utmSource: parsed.utmSource,
      utmMedium: parsed.utmMedium,
      utmCampaign: parsed.utmCampaign,
      utmContent: parsed.utmContent,
      utmTerm: parsed.utmTerm,
    });

    await touch();
    return { status: 200, body: { success: true, sale_id: sale?.id, status: 'approved' } };
  }

  /**
   * Bruto por padrão; comissão com a opção da integração ligada. Onde o
   * container só tinha a comissão (Kavoo, Doppus, Wiven), ela é o valor.
   */
  private amount(parsed: ParsedCheckout, useCommission: boolean): number {
    if (useCommission && parsed.commissionAmount != null) return parsed.commissionAmount;
    return parsed.grossAmount ?? parsed.commissionAmount ?? 0;
  }

  private async refund(
    platform: string,
    integration: { id: string; user_id: string },
    parsed: ParsedCheckout,
    touch: () => PromiseLike<unknown>,
  ): Promise<Result> {
    const supabaseAdmin = this.supabase.getClient();
    const { data: existing } = await supabaseAdmin
      .from('sales')
      .select('id, status')
      .eq('external_id', parsed.externalId)
      .eq('user_id', integration.user_id)
      .maybeSingle();

    let saleId: string | null = existing?.id ?? null;
    if (existing && existing.status !== 'refunded') {
      await supabaseAdmin.from('sales').update({ status: 'refunded' }).eq('id', existing.id);
    } else if (!existing) {
      const fallback = await this.webhooksService.findAndRefundOriginalSale({
        userId: integration.user_id,
        customerEmail: parsed.customerEmail,
        productName: parsed.productName,
        checkoutIntegrationId: integration.id,
        platform,
      });
      saleId = fallback?.id ?? null;
    }

    await touch();
    if (!saleId) {
      return { status: 200, body: { success: true, action: 'skipped', reason: 'Nenhuma venda aprovada para reembolsar' } };
    }
    return { status: 200, body: { success: true, action: 'refunded', sale_id: saleId } };
  }
}
