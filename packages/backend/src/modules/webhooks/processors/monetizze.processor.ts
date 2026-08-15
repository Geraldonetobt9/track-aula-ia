import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

/**
 * Monetizze status codes:
 *   1=AwaitingPayment, 2=Approved, 3=Canceled, 4=Refunded, 5=Blocked, 6=Completa
 *   101=SubscriptionActive, 102=SubscriptionInadimplente,
 *   103=SubscriptionCanceled, 104=SubscriptionAwaitingPayment
 */
const APPROVED_CODES = new Set([2, 6, 101]);
const REFUNDED_CODES = new Set([3, 4, 102, 103]);
const ACCEPTED_CODES = new Set([...APPROVED_CODES, ...REFUNDED_CODES]);

@Injectable()
export class MonetizzeProcessor {
  private readonly logger = new Logger(MonetizzeProcessor.name);

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
      'Webhook Monetizze received: ' + JSON.stringify(payload).substring(0, 500),
    );

    const codigoStatus =
      parseInt(payload.codigo_status, 10) ||
      parseInt(payload.postback_evento, 10) ||
      0;

    if (!ACCEPTED_CODES.has(codigoStatus)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `codigo_status "${payload.codigo_status}" não processado`,
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
      .eq('platform', 'monetizze')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .maybeSingle();

    if (integrationError || !integration) {
      this.discordLogger.logError('monetizze', {
        errorType: 'token_invalid',
        message: 'Token (Chave Única) não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar a Chave Única no painel Monetizze',
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
    const status = APPROVED_CODES.has(codigoStatus) ? 'approved' : 'refunded';

    const venda = payload.venda || {};
    const produto = payload.produto || {};
    const comprador = payload.comprador || {};
    const produtosArr = Array.isArray(payload.produtos) ? payload.produtos : [];
    const firstProduto = produtosArr[0] || {};

    // UTMs come at the venda level
    const utmSource = venda.utm_source || null;
    const utmMedium = venda.utm_medium || null;
    const utmCampaign = venda.utm_campaign || null;
    const utmContent = venda.utm_content || null;
    const sck = venda.src || null;

    const adId =
      this.webhooksService.extractNumericAdId(utmContent) ||
      this.webhooksService.extractNumericAdId(sck);

    const grossAmount = parseFloat(venda.valor) || parseFloat(firstProduto.valor) || 0;
    const netAmount = parseFloat(venda.valorRecebido) || 0;
    let amount = grossAmount;
    if (integration.use_commission_value && netAmount > 0) {
      amount = netAmount;
    }

    const customerPhone = comprador.telefone || null;
    const productName = produto.nome || firstProduto.nome || null;
    const externalId =
      venda.codigo
        ? `monetizze_${venda.codigo}`
        : payload.codigo_venda
          ? `monetizze_${payload.codigo_venda}`
          : payload.chave_unica
            ? `monetizze_${payload.chave_unica}`
            : `monetizze_${Date.now()}`;

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: externalId,
      amount,
      product_name: productName,
      customer_name: comprador.nome || null,
      customer_email: comprador.email || null,
      customer_phone: customerPhone,
      customer_doc: comprador.cnpj_cpf || null,
      customer_state:
        comprador.estado || this.webhooksService.getStateFromPhone(customerPhone),
      customer_city: comprador.cidade || null,
      customer_country: comprador.pais || 'BR',
      status,
      payment_method: venda.formaPagamento || venda.meioPagamento || 'unknown',
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: null as string | null,
      checkout_integration_id: integrationId,
      sold_at:
        venda.dataFinalizada || venda.dataInicio || new Date().toISOString(),
      metadata: {
        codigo_status: codigoStatus,
        codigo_venda: payload.codigo_venda || venda.codigo,
        chave_unica: payload.chave_unica,
        produto_codigo: produto.codigo,
        produto_chave: produto.chave,
        plano: payload.plano,
        afiliados: payload.afiliados,
        comissoes: payload.comissoes,
        order_bump: payload.order_bump,
        assinatura: payload.assinatura,
        rastreio: payload.rastreio,
        produtos: produtosArr.map((p: any) => ({ produto: p.produto, nome: p.nome })),
        sck,
        installments: venda.parcelas,
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
          customerEmail: comprador.email || null,
          productName,
          checkoutIntegrationId: integrationId,
          platform: 'monetizze',
        });
        if (!fallbackResult) {
          this.logger.warn(
            `Monetizze refund skipped — no matching approved sale: external_id=${saleData.external_id}`,
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

      this.discordLogger.logRefund('monetizze', {
        amount,
        customerName: comprador.nome || null,
        customerEmail: comprador.email || null,
        productName,
        paymentMethod: venda.formaPagamento || 'unknown',
        adMatched: !!adId,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm: null,
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
        utmTerm: null,
      });
    }

    this.discordLogger.logSale('monetizze', {
      amount,
      customerName: comprador.nome || null,
      customerEmail: comprador.email || null,
      productName,
      paymentMethod: venda.formaPagamento || 'unknown',
      adMatched: !!adId,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm: null,
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
