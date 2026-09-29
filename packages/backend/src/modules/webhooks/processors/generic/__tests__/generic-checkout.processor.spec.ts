import { GenericCheckoutProcessor } from '../generic-checkout.processor';
import { WebhooksService } from '../../../webhooks.service';

const INTEGRATION = {
  id: 'int-1',
  user_id: 'user-1',
  workspace_id: 'ws-1',
  is_active: true,
  use_commission_value: false,
};

const YAMPI_PAID = {
  event: 'order.paid',
  resource: {
    id: 7788,
    value_total: 159.9,
    utm_source: 'facebook',
    utm_campaign: 'camp|123',
    utm_content: 'ad|120245519580910309',
    customer: { data: { email: 'g@mail.com', first_name: 'Gil', last_name: 'Nunes', phone: { formated_number: '71944443333' } } },
    items: { data: [{ sku: { data: { title: 'Tênis', product_id: 321 } } }] },
    shipping_address: { data: { city: 'Salvador', uf: 'BA', zipcode: '40000000' } },
  },
};

function build(opts: { integration?: any; existingSale?: any } = {}) {
  const updates: any[] = [];
  const integration = 'integration' in opts ? opts.integration : INTEGRATION;
  const from = (table: string) => {
    const b: any = {};
    for (const m of ['select', 'eq', 'in']) b[m] = () => b;
    b.maybeSingle = async () =>
      table === 'checkout_integrations' ? { data: integration } : { data: opts.existingSale ?? null };
    b.update = (values: any) => {
      updates.push({ table, values });
      return b;
    };
    b.then = (ok: any) => Promise.resolve({ data: null, error: null }).then(ok);
    return b;
  };

  const sales = { upsertFromWebhook: jest.fn().mockResolvedValue({ id: 'sale-1' }) };
  const webhooks = {
    extractNumericAdId: WebhooksService.prototype.extractNumericAdId,
    normalizeState: (s: string | null) => (s ? s.toUpperCase() : null),
    normalizeCity: (c: string | null) => c,
    getStateFromPhone: () => 'SP',
    matchAndUpdateSale: jest.fn().mockResolvedValue(undefined),
    findAndRefundOriginalSale: jest.fn().mockResolvedValue(null),
  };
  const discord = { logSale: jest.fn(), logError: jest.fn() };
  const processor = new GenericCheckoutProcessor(
    { getClient: () => ({ from }) } as any,
    webhooks as any,
    discord as any,
    sales as any,
  );
  return { processor, sales, webhooks, discord, updates };
}

describe('GenericCheckoutProcessor', () => {
  it('sem token responde 401, para a plataforma reenviar', async () => {
    const { processor, sales } = build();
    const r = await processor.process('yampi', YAMPI_PAID, null, {});
    expect(r.status).toBe(401);
    expect(sales.upsertFromWebhook).not.toHaveBeenCalled();
  });

  it('token que nao bate com integracao ativa responde 401', async () => {
    const { processor, discord } = build({ integration: null });
    const r = await processor.process('yampi', YAMPI_PAID, null, { token: 'errado' });
    expect(r.status).toBe(401);
    expect(discord.logError).toHaveBeenCalled();
  });

  it('token da URL vence um campo "token" que venha no corpo da plataforma', async () => {
    const { processor } = build();
    const r = await processor.process('yampi', YAMPI_PAID, 'token-do-corpo', { token: 'tok' });
    expect(r.status).toBe(200);
  });

  it('venda aprovada: grava pelo SalesService com os campos do payload e atribui por UTM', async () => {
    const { processor, sales, webhooks, updates } = build();
    const r = await processor.process('yampi', YAMPI_PAID, null, { token: 'tok' });

    expect(r).toEqual({ status: 200, body: { success: true, sale_id: 'sale-1', status: 'approved' } });
    expect(sales.upsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        workspace_id: 'ws-1',
        checkout_integration_id: 'int-1',
        external_id: '7788',
        amount: 159.9,
        currency: 'BRL',
        product_name: 'Tênis',
        customer_name: 'Gil Nunes',
        customer_email: 'g@mail.com',
        customer_phone: '71944443333',
        customer_state: 'BA',
        customer_city: 'Salvador',
        customer_country: 'BR',
        status: 'approved',
        utm_source: 'facebook',
        utm_content: 'ad|120245519580910309',
        metadata: expect.objectContaining({ event: 'order.paid', product_id: '321', zipcode: '40000000' }),
      }),
    );
    expect(webhooks.matchAndUpdateSale).toHaveBeenCalledWith('sale-1', 'user-1', expect.objectContaining({ adId: '120245519580910309' }));
    expect(updates.some((u) => u.table === 'checkout_integrations' && u.values.last_webhook_at)).toBe(true);
  });

  it('comissao so quando a integracao pede; onde so existe comissao, ela e o valor', async () => {
    const pagtrust = {
      event: 'PURCHASE_APPROVED',
      data: { purchase: { transaction: 'T1', price: { value: 297 } }, commissions: [{}, { value: 250 }] },
    };
    const gross = build();
    await gross.processor.process('pagtrust', pagtrust, null, { token: 't' });
    expect(gross.sales.upsertFromWebhook.mock.calls[0][0].amount).toBe(297);

    const net = build({ integration: { ...INTEGRATION, use_commission_value: true } });
    await net.processor.process('pagtrust', pagtrust, null, { token: 't' });
    expect(net.sales.upsertFromWebhook.mock.calls[0][0].amount).toBe(250);

    const kavoo = build();
    await kavoo.processor.process('kavoo', { transaction: { code: 'K', fee_producer: 8970 } }, null, { token: 't' });
    expect(kavoo.sales.upsertFromWebhook.mock.calls[0][0].amount).toBe(89.7);
  });

  it('evento que nao e venda: 200, nada gravado', async () => {
    const { processor, sales } = build();
    const r = await processor.process('yampi', { event: 'order.created', resource: { id: 1 } }, null, { token: 'tok' });
    expect(r.status).toBe(200);
    expect(r.body.ignored).toBe(true);
    expect(sales.upsertFromWebhook).not.toHaveBeenCalled();
  });

  it('reembolso atualiza a venda existente e nunca cria linha', async () => {
    const { processor, sales, updates } = build({ existingSale: { id: 'sale-9', status: 'approved' } });
    const r = await processor.process('yampi', { event: 'order.refunded', resource: { id: 7788 } }, null, { token: 'tok' });
    expect(r.body).toMatchObject({ action: 'refunded', sale_id: 'sale-9' });
    expect(updates).toContainEqual({ table: 'sales', values: { status: 'refunded' } });
    expect(sales.upsertFromWebhook).not.toHaveBeenCalled();
  });

  it('reembolso sem venda: tenta pelo e-mail e, sem achar, pula', async () => {
    const { processor, webhooks } = build();
    const r = await processor.process('wiven', { event: 'TRANSACTION_REFUNDED', transaction: { id: 'X' }, client: { email: 'a@b.com' } }, null, { token: 't' });
    expect(webhooks.findAndRefundOriginalSale).toHaveBeenCalledWith(expect.objectContaining({ customerEmail: 'a@b.com', platform: 'wiven' }));
    expect(r.body.action).toBe('skipped');
  });

  it('sem id da transacao: 400', async () => {
    const { processor } = build();
    const r = await processor.process('yampi', { event: 'order.paid', resource: {} }, null, { token: 'tok' });
    expect(r.status).toBe(400);
  });
});
