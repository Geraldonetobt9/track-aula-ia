import { WebhookQueueService } from '../webhook-queue.service';
import { SalesService } from '../../sales/sales.service';
import { GenericCheckoutProcessor } from '../processors/generic/generic-checkout.processor';
import { extractTrackingRef, webhookContext } from '../../../shared/helpers/webhook-context';

const REF = 'stl_ffffffff-0000-4111-8222-333333333333';

/**
 * A costura entre o webhook e a CAPI: o indexador sai do corpo cru, a venda
 * aprovada gravada pelo processor entra na lista, e o Purchase sai depois
 * que o processor termina — com a venda já gravada.
 */
describe('webhook → venda → Purchase', () => {
  function build(processImpl: (...args: any[]) => Promise<any>) {
    const processors = Array.from({ length: 16 }, () => ({ process: jest.fn() }));
    processors[0].process.mockImplementation(processImpl); // hotmart
    const capi = { sendPurchases: jest.fn().mockResolvedValue(undefined) };
    const service = new (WebhookQueueService as any)({}, ...processors, {}, capi) as WebhookQueueService;
    return { service, capi };
  }

  function salesService() {
    const persisted: any[] = [];
    const svc = new SalesService(
      {} as any,
      { checkSaleAcceptance: jest.fn().mockResolvedValue({ allowed: true, overage: false }), invalidate: jest.fn() } as any,
      {} as any,
      { matchSale: jest.fn() } as any,
    );
    jest.spyOn(svc as any, 'findByExternalId').mockResolvedValue(null);
    jest.spyOn(svc as any, 'persist').mockImplementation(async (sale: any) => {
      persisted.push(sale);
      return { id: `sale-${persisted.length}` };
    });
    return { svc, persisted };
  }

  it('acha o indexador em qualquer caminho do corpo, e manda o Purchase das vendas aprovadas depois do processor', async () => {
    const { svc, persisted } = salesService();
    const order: string[] = [];
    const { service, capi } = build(async () => {
      // Processor que não guarda o sck em lugar nenhum: grava duas linhas do
      // mesmo pedido, uma aprovada nova e uma pendente.
      await svc.upsertFromWebhook({ user_id: 'u', status: 'approved', external_id: 'A', metadata: { x: 1 } });
      await svc.upsertFromWebhook({ user_id: 'u', status: 'pending', external_id: 'B' });
      order.push('processor');
      return { status: 200, body: { ok: true } };
    });
    capi.sendPurchases.mockImplementation(async () => order.push('capi'));

    const rawBody = JSON.stringify({ data: { purchase: { origin: { sck: REF } } } });
    const result = await service.processDirect({ platform: 'hotmart', body: JSON.parse(rawBody), authToken: 't', rawBody });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(persisted[0].metadata).toEqual({ x: 1, tracking_ref: REF });
    expect(persisted[1].metadata).toEqual({ tracking_ref: REF });
    expect(capi.sendPurchases).toHaveBeenCalledWith(['sale-1']); // só a aprovada
    expect(order).toEqual(['processor', 'capi']);
  });

  it('plataforma dos containers (Yampi): processor generico, indexador no utm_term, Purchase no fim', async () => {
    const { svc, persisted } = salesService();
    const capi = { sendPurchases: jest.fn().mockResolvedValue(undefined) };
    const integration = { id: 'int', user_id: 'u', workspace_id: 'ws', is_active: true, use_commission_value: false };
    const from = () => {
      const b: any = {};
      for (const m of ['select', 'eq', 'update']) b[m] = () => b;
      b.maybeSingle = async () => ({ data: integration });
      b.then = (ok: any) => Promise.resolve({ data: null }).then(ok);
      return b;
    };
    const generic = new GenericCheckoutProcessor(
      { getClient: () => ({ from }) } as any,
      {
        extractNumericAdId: () => null,
        normalizeState: () => null,
        normalizeCity: () => null,
        getStateFromPhone: () => null,
        matchAndUpdateSale: jest.fn(),
      } as any,
      { logSale: jest.fn(), logError: jest.fn() } as any,
      svc,
    );
    const processors = Array.from({ length: 16 }, () => ({ process: jest.fn() }));
    const service = new (WebhookQueueService as any)({}, ...processors, {}, capi, generic) as WebhookQueueService;

    const body = {
      event: 'order.paid',
      resource: { id: 55, value_total: 99.9, utm_term: REF, customer: { data: { email: 'a@b.com' } } },
    };
    const result = await service.processDirect({
      platform: 'yampi', body, authToken: null, rawBody: JSON.stringify(body), queryParams: { token: 'tok' },
    });

    expect(result.status).toBe(200);
    expect(persisted[0]).toMatchObject({ external_id: '55', amount: 99.9, utm_term: null });
    expect(persisted[0].metadata.tracking_ref).toBe(REF);
    expect(capi.sendPurchases).toHaveBeenCalledWith(['sale-1']);
  });

  it('sem venda aprovada nova, nao chama a CAPI', async () => {
    const { service, capi } = build(async () => ({ status: 200, body: {} }));
    await service.processDirect({ platform: 'hotmart', body: {}, authToken: 't' });
    expect(capi.sendPurchases).not.toHaveBeenCalled();
  });

  it('webhooks simultaneos nao misturam contexto', async () => {
    const { svc } = salesService();
    const seen: Record<string, any> = {};
    const { service } = build(async (body: any) => {
      await new Promise((r) => setTimeout(r, body.delay));
      seen[body.name] = webhookContext.getStore()?.trackingRef;
      await svc.upsertFromWebhook({ user_id: 'u', status: 'pending', external_id: body.name });
      return { status: 200, body: {} };
    });
    const refA = 'stl_aaaaaaaa-0000-4111-8222-333333333333';
    const refB = 'stl_bbbbbbbb-0000-4111-8222-333333333333';
    await Promise.all([
      service.processDirect({ platform: 'hotmart', body: { name: 'a', delay: 20, sck: refA }, authToken: 't' }),
      service.processDirect({ platform: 'hotmart', body: { name: 'b', delay: 5, sck: refB }, authToken: 't' }),
    ]);
    expect(seen).toEqual({ a: refA, b: refB });
  });

  it('extractTrackingRef acha o marcador em formatos diferentes de corpo', () => {
    expect(extractTrackingRef(JSON.stringify({ saleMetas: [{ meta_key: 'xcod', meta_value: REF }] }))).toBe(REF);
    expect(extractTrackingRef(`sck=${REF}&status=paid`)).toBe(REF);
    expect(extractTrackingRef(JSON.stringify({ utm_term: REF.toUpperCase() }))).toBe(REF);
    expect(extractTrackingRef('{"sck":"meu-codigo"}')).toBeNull();
    expect(extractTrackingRef(undefined)).toBeNull();
  });
});
