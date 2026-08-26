import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { normalizeState } from '../../../shared/helpers/normalize-state';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';

const APPROVED_EVENTS = new Set(['invoice.payment_succeeded']);
const REFUNDED_EVENTS = new Set(['refund_request.accepted']);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class HublaProcessor {
  private readonly logger = new Logger(HublaProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
    private readonly discordLogger: DiscordLoggerService,
    private readonly salesService: SalesService,
  ) {}

  /**
   * Desmembra event.products em uma linha por oferta.
   *
   * Uma compra na Hubla pode trazer o produto principal e varios order bumps.
   * O invoice.amount.totalCents ja vem somado — e o que a venda registra, e o
   * que o dashboard conta como UMA venda. Esta lista guarda a outra leitura:
   * quanto foi cada produto.
   *
   * O valor sai de offers[].amountCents, e nao de um campo por produto, porque
   * e ali que a Hubla poe o preco cobrado naquela oferta.
   */
  private extractItems(products: any[]): Array<{
    name: string;
    amount: number;
    is_order_bump: boolean;
    product_id: string | null;
    offer_id: string | null;
  }> {
    const items: Array<{
      name: string;
      amount: number;
      is_order_bump: boolean;
      product_id: string | null;
      offer_id: string | null;
    }> = [];

    for (const produto of Array.isArray(products) ? products : []) {
      const ofertas = Array.isArray(produto?.offers) ? produto.offers : [];

      // Produto sem oferta detalhada ainda deve aparecer, com valor zero, para
      // a linha nao sumir do painel.
      if (ofertas.length === 0) {
        if (produto?.name) {
          items.push({
            name: produto.name,
            amount: 0,
            is_order_bump: false,
            product_id: produto.id ?? null,
            offer_id: null,
          });
        }
        continue;
      }

      for (const oferta of ofertas) {
        const centavos = typeof oferta?.amountCents === 'number' ? oferta.amountCents : 0;
        items.push({
          // O nome do produto identifica melhor que o da oferta: a oferta
          // costuma ser um codigo de preco ("M7D - 297").
          name: produto?.name || oferta?.name || 'Sem produto',
          amount: centavos / 100,
          is_order_bump: oferta?.isOrderBump === true,
          product_id: produto?.id ?? null,
          offer_id: oferta?.id ?? null,
        });
      }
    }

    return items;
  }

  async process(
    body: any,
    authToken: string | null,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook Hubla received: ' +
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

    const eventType = (payload.type || '').toLowerCase().trim();
    if (!ACCEPTED_EVENTS.has(eventType)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${eventType}" not processed (only invoice.payment_succeeded, refund_request.accepted)`,
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active, use_commission_value')
      .eq('platform', 'hubla')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      this.discordLogger.logError('hubla', {
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

    const event = payload.event || {};
    const invoice = event.invoice || {};
    const user = event.user || {};
    const product = event.product || {};
    const products = event.products || [];
    const billingAddress = invoice.billingAddress || {};
    // A Hubla manda a sessao de pagamento em `paymentSession` no payload 2.0.0 e
    // em `firstPaymentSession` no formato antigo. Ler so um dos dois perdia as
    // UTMs em silencio — e sao elas que ligam a venda ao anuncio, entao a venda
    // entrava sem atribuicao nenhuma.
    const paymentSession = invoice.paymentSession || invoice.firstPaymentSession || {};
    const utm = paymentSession.utm || {};
    const amountObj = invoice.amount || {};

    // Quando a venda aconteceu, para o painel, e quando o dinheiro entrou.
    //
    // invoice.saleDate e a data em que a fatura nasceu, nao em que foi paga.
    // Num PIX ou boleto isso costuma ser outro dia: a venda era gravada no dia
    // do checkout e nao aparecia no "hoje", mesmo tendo caido agora. Pior, ela
    // aparecia retroativamente num dia que ja tinha sido conferido.
    //
    // O momento do pagamento vem em statusAt, na entrada de status "paid".
    const pagamento = Array.isArray(invoice.statusAt)
      ? invoice.statusAt.find((s: any) => s?.status === 'paid')?.when
      : null;

    // Quebra por produto: principal + order bumps, cada um com seu valor.
    // O dashboard continua contando UMA venda pelo total; esta lista existe
    // para o painel de produtos mostrar as linhas separadas.
    const items = this.extractItems(products);

    const status = APPROVED_EVENTS.has(eventType) ? 'approved' : 'refunded';

    const customerName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ') || null;

    const amount =
      typeof amountObj.totalCents === 'number'
        ? amountObj.totalCents / 100
        : 0;

    const utmSource = utm.source || null;
    const utmMedium = utm.medium || null;
    const utmCampaign = utm.campaign || null;
    const utmContent = utm.content || null;
    const utmTerm = utm.term || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerState = normalizeState(billingAddress.state) ||
      this.webhooksService.getStateFromPhone(user.phone);

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: invoice.id || `hubla_${Date.now()}`,
      // Todas as linhas da compra repetem este valor. É por ele que a contagem
      // de vendas enxerga um pedido só, mesmo com três produtos.
      order_external_id: invoice.id || null,
      amount,
      product_name: product.name || (products[0] && products[0].name) || null,
      customer_name: customerName,
      customer_email: user.email || null,
      customer_phone: user.phone || null,
      customer_doc: user.document || null,
      customer_state: customerState,
      customer_city: billingAddress.city || null,
      customer_country: billingAddress.countryCode || 'BR',
      status,
      payment_method: invoice.paymentMethod || null,
      currency: invoice.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      checkout_integration_id: integrationId,
      sold_at: pagamento || invoice.saleDate || new Date().toISOString(),
      metadata: {
        event_type: eventType,
        invoice_id: invoice.id,
        subscription_id: invoice.subscriptionId,
        seller_id: invoice.sellerId,
        installments: invoice.installments,
        subtotal_cents: amountObj.subtotalCents,
        discount_cents: amountObj.discountCents,
        installment_fee_cents: amountObj.installmentFeeCents,
        coupon: invoice.coupon || null,
        ip: paymentSession.ip || null,
        product_id: product.id || (products[0] && products[0].id) || null,
        offers: products[0] && products[0].offers ? products[0].offers : null,
        // Lido pelo painel "Vendas por Produto" para desmembrar a venda.
        items,
        has_order_bump: items.some((i) => i.is_order_bump),
        refund: event.refund || null,
      },
    };

    // Refunds: find and update original sale, never create phantom rows
    if (status === 'refunded') {
      // Estorno vale para o pedido inteiro: busca por order_external_id, e nao
      // por external_id, porque a compra virou varias linhas e cada uma tem seu
      // proprio external_id. Estornar so uma deixaria os bumps como aprovados.
      const { data: linhasDoPedido } = await supabaseAdmin
        .from('sales')
        .select('id, status')
        .eq('order_external_id', saleData.external_id)
        .eq('user_id', userId);

      if (linhasDoPedido && linhasDoPedido.length > 0) {
        const aEstornar = linhasDoPedido.filter((l) => l.status !== 'refunded').map((l) => l.id);
        if (aEstornar.length > 0) {
          await supabaseAdmin.from('sales').update({ status: 'refunded' }).in('id', aEstornar);
        }
        this.logger.log(`Hubla refund: ${aEstornar.length} linha(s) do pedido ${saleData.external_id}`);
      } else {
        const fallbackResult = await this.webhooksService.findAndRefundOriginalSale({
          userId, customerEmail: user.email || null,
          productName: product.name || (products[0] && products[0].name) || null,
          checkoutIntegrationId: integrationId, platform: 'hubla',
        });
        if (!fallbackResult) {
          this.logger.warn(`Hubla refund skipped — no matching approved sale: external_id=${saleData.external_id}`);
          await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
          return { status: 200, body: { success: true, action: 'skipped', reason: 'No matching approved sale for refund' } };
        }
      }

      this.discordLogger.logRefund('hubla', {
        amount, customerName: customerName, customerEmail: user.email || null,
        productName: product.name || (products[0] && products[0].name) || null,
        paymentMethod: invoice.paymentMethod || null, adMatched: !!adId,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      });
      await supabaseAdmin.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integrationId);
      return { status: 200, body: { success: true, action: 'refunded', status } };
    }

    // Uma linha por produto: o principal e cada order bump.
    //
    // O pedido continua sendo um — todas as linhas repetem order_external_id, e
    // e por ele que "Vendas aprovadas" conta. Gravar assim faz "Vendas em tempo
    // real", a lista de vendas e o painel de produtos mostrarem os produtos
    // separados sem nenhum tratamento especial: eles leem linhas.
    //
    // Compra sem quebra detalhada cai no caminho de sempre, com uma linha so.
    const linhas =
      items.length > 0
        ? items.map((item, indice) => ({
            ...saleData,
            // Deterministico, para o reenvio do webhook atualizar em vez de
            // duplicar. O offer_id identifica a oferta dentro da fatura.
            external_id: `${saleData.external_id}:${item.offer_id || item.product_id || indice}`,
            product_name: item.name,
            amount: item.amount,
            is_order_bump: item.is_order_bump,
          }))
        : [saleData];

    let primeiraVenda: any = null;

    for (const linha of linhas) {
      const gravada = await this.salesService.upsertFromWebhook(linha);
      if (!primeiraVenda) primeiraVenda = gravada;

      // A atribuicao vale por linha: cada uma precisa apontar para o anuncio,
      // senao o faturamento por anuncio perderia os bumps.
      if (gravada?.id) {
        this.webhooksService.matchAndUpdateSale(gravada.id, userId, {
          adId,
          utmCampaign,
          utmContent,
          utmTerm,
        });
      }
    }

    const sale = primeiraVenda;

    const logData = {
      amount,
      customerName: customerName,
      customerEmail: user.email || null,
      productName: product.name || (products[0] && products[0].name) || null,
      paymentMethod: invoice.paymentMethod || null,
      adMatched: !!adId,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('hubla', logData);
    } else {
      this.discordLogger.logRefund('hubla', logData);
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
