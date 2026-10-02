import { MetaCapiService } from '../meta-capi.service';
import { sha256 } from '../meta-user-data';

const WS = '11111111-2222-4333-8444-555555555555';
const SID = 'ffffffff-0000-4111-8222-333333333333';
const VID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/**
 * Supabase de mentira: cada chamada from(tabela) devolve um builder que anota
 * a operação e resolve com o que o teste mandou para (tabela, operação).
 */
function fakeSupabase(results: Record<string, any>) {
  const calls: { table: string; op: string; args: any[] }[] = [];
  const from = (table: string) => {
    let op = 'select';
    const builder: any = {};
    const chain = ['eq', 'in', 'lt', 'gte', 'order', 'limit'];
    for (const m of chain) builder[m] = () => builder;
    builder.select = (...args: any[]) => {
      if (op === 'select') calls.push({ table, op: 'select', args });
      return builder;
    };
    for (const m of ['insert', 'update', 'upsert']) {
      builder[m] = (...args: any[]) => {
        op = m;
        calls.push({ table, op: m, args });
        return builder;
      };
    }
    const resolve = () => {
      const r = results[`${table}.${op}`];
      return Promise.resolve(typeof r === 'function' ? r() : r ?? { data: null, error: null });
    };
    builder.maybeSingle = resolve;
    builder.single = resolve;
    builder.then = (ok: any, fail: any) => resolve().then(ok, fail);
    return builder;
  };
  return { client: { from }, calls };
}

const WORKSPACE_ROW = {
  id: WS,
  user_id: 'user-1',
  tracking_platform: 'hotmart',
  tracking_param: 'sck',
  tracking_domain: 'track.loja.com.br',
  meta_pixel_id: '123456789012345',
  meta_capi_token: 'EAAB-token',
  meta_test_event_code: 'TEST123',
  meta_mirror_browser: false,
};

function makeService(results: Record<string, any>) {
  const fake = fakeSupabase({ 'workspaces.select': { data: WORKSPACE_ROW, error: null }, ...results });
  const cache = new Map<string, any>();
  const service = new MetaCapiService(
    { getClient: () => fake.client } as any,
    {
      get: (k: string) => cache.get(k) ?? null,
      set: (k: string, v: any) => cache.set(k, v),
      invalidate: (k: string) => cache.delete(k),
    } as any,
    { decryptIfNeeded: (v: string) => v } as any,
  );
  return { service, calls: fake.calls };
}

describe('MetaCapiService', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ events_received: 1, fbtrace_id: 'TRACE1' }),
    });
    (global as any).fetch = fetchMock;
  });

  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  describe('PageView e InitiateCheckout', () => {
    it('manda os dois numa chamada so, com os dados de navegacao e o codigo de teste', async () => {
      const { service, calls } = makeService({});
      const base = {
        url: 'https://www.loja.com.br/oferta',
        visitorId: VID,
        sessionId: SID,
        ip: '200.1.2.3',
        userAgent: 'Mozilla/5.0',
        fbp: 'fb.1.1711800000000.1234567890',
        fbc: 'fb.1.1711800000000.IwAR0abc',
        city: 'São Paulo',
        region: 'SP',
        country: 'BR',
      };
      await service.sendWebEvents(WS, [
        { ...base, type: 'pageview', eventId: 'e-pv' },
        { ...base, type: 'checkout_click', eventId: 'e-ic' },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/123456789012345\/events$/);
      const body = sentBody();
      expect(body.access_token).toBe('EAAB-token');
      expect(body.test_event_code).toBe('TEST123');
      expect(body.data.map((e: any) => [e.event_name, e.event_id])).toEqual([
        ['PageView', 'e-pv'],
        ['InitiateCheckout', 'e-ic'],
      ]);
      const [pv] = body.data;
      expect(pv.action_source).toBe('website');
      expect(pv.event_source_url).toBe('https://www.loja.com.br/oferta');
      expect(pv.user_data).toMatchObject({
        client_ip_address: '200.1.2.3',
        client_user_agent: 'Mozilla/5.0',
        fbp: base.fbp,
        fbc: base.fbc,
        external_id: [sha256(VID)],
        st: [sha256('sp')],
        country: [sha256('br')],
      });

      const record = calls.find((c) => c.table === 'capi_events' && c.op === 'upsert')!;
      expect(record.args[0].map((r: any) => r.status)).toEqual(['sent', 'sent']);
      expect(record.args[0][0].fbtrace_id).toBe('TRACE1');
      expect(record.args[0][0].pixel_id).toBe('123456789012345'); // o pixel que recebeu
    });

    it('sem a coluna pixel_id (migration ainda nao rodada), grava sem ela', async () => {
      let n = 0;
      const { service, calls } = makeService({
        'capi_events.upsert': () =>
          ++n === 1 ? { data: null, error: { message: "Could not find the 'pixel_id' column of 'capi_events'" } } : { data: null, error: null },
      });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ events_received: 1, fbtrace_id: 'T' }) });
      await service.sendWebEvents(WS, [{ type: 'pageview', eventId: 'e', url: null, visitorId: VID, sessionId: SID, ip: null, userAgent: null, fbp: null, fbc: null, city: null, region: null, country: null }]);
      const upserts = calls.filter((c) => c.table === 'capi_events' && c.op === 'upsert');
      expect(upserts).toHaveLength(2);
      expect(upserts[0].args[0][0].pixel_id).toBe('123456789012345');
      expect(upserts[1].args[0][0]).not.toHaveProperty('pixel_id');
    });

    it('sem pixel ou token configurado, nao manda nada', async () => {
      const { service } = makeService({
        'workspaces.select': { data: { ...WORKSPACE_ROW, meta_capi_token: null }, error: null },
      });
      await service.sendWebEvents(WS, [
        { type: 'pageview', eventId: 'e', url: null, visitorId: VID, sessionId: SID, ip: null, userAgent: null, fbp: null, fbc: null, city: null, region: null, country: null },
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('recusa do Meta fica registrada como falha, com a mensagem', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Invalid parameter', error_user_msg: 'fbc invalido', fbtrace_id: 'TR2' } }),
      });
      const { service, calls } = makeService({});
      await service.sendWebEvents(WS, [
        { type: 'pageview', eventId: 'e', url: null, visitorId: VID, sessionId: SID, ip: null, userAgent: null, fbp: null, fbc: null, city: null, region: null, country: null },
      ]);
      const row = calls.find((c) => c.table === 'capi_events' && c.op === 'upsert')!.args[0][0];
      expect(row.status).toBe('failed');
      expect(row.error).toBe('fbc invalido');
      expect(row.fbtrace_id).toBe('TR2');
    });

    it('Meta fora do ar nao derruba nada', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      const { service } = makeService({});
      await expect(
        service.sendWebEvents(WS, [
          { type: 'pageview', eventId: 'e', url: null, visitorId: VID, sessionId: SID, ip: null, userAgent: null, fbp: null, fbc: null, city: null, region: null, country: null },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe('Purchase', () => {
    const line = (over: Record<string, any>) => ({
      id: 'sale-1',
      workspace_id: WS,
      external_id: 'HP1',
      order_external_id: 'HP1',
      status: 'approved',
      amount: 97,
      currency: 'BRL',
      product_name: 'Curso',
      customer_name: 'Maria Silva',
      customer_email: 'maria@gmail.com',
      customer_phone: '11987654321',
      customer_city: 'Campinas',
      customer_state: 'SP',
      customer_country: 'BR',
      session_id: SID,
      visitor_id: VID,
      sold_at: new Date().toISOString(),
      metadata: { product_id: 555 },
      ...over,
    });

    const SESSION = {
      visitor_id: VID,
      session_id: SID,
      landing_page: 'https://www.loja.com.br/oferta',
      fbp: 'fb.1.1711800000000.1234567890',
      fbc: 'fb.1.1711800000000.IwAR0abc',
      ip_address: '200.1.2.3',
      user_agent: 'Mozilla/5.0 (iPhone)',
      city: 'São Paulo',
      region: 'SP',
      country: 'BR',
    };

    it('um Purchase por pedido, com o valor das linhas somado (order bump) e comprador + navegacao', async () => {
      const { service, calls } = makeService({
        'sales.select': {
          data: [line({}), line({ id: 'sale-2', external_id: 'HP1:bump', amount: 27, product_name: 'Bump', metadata: {} })],
          error: null,
        },
        'tracking_sessions.select': { data: SESSION, error: null },
        'capi_events.insert': { data: { id: 'row-1' }, error: null },
      });

      await service.sendPurchases(['sale-1', 'sale-2']);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [event] = sentBody().data;
      expect(event.event_name).toBe('Purchase');
      expect(event.event_id).toBe('purchase:HP1');
      expect(event.event_source_url).toBe('https://www.loja.com.br/oferta');
      expect(event.custom_data).toMatchObject({ currency: 'BRL', value: 124, order_id: 'HP1', content_name: 'Curso + Bump' });
      expect(event.custom_data).toMatchObject({ product_id: '555', product_name: 'Curso', content_ids: ['555', 'Bump'] });
      expect(event.custom_data.contents).toHaveLength(2);
      expect(event.user_data).toMatchObject({
        em: [sha256('maria@gmail.com')],
        ph: [sha256('5511987654321')],
        fn: [sha256('maria')],
        ln: [sha256('silva')],
        st: [sha256('sp')],
        client_ip_address: '200.1.2.3',
        client_user_agent: 'Mozilla/5.0 (iPhone)',
        fbp: SESSION.fbp,
        fbc: SESSION.fbc,
        external_id: [sha256(VID)],
      });

      const update = calls.find((c) => c.table === 'capi_events' && c.op === 'update')!;
      expect(update.args[0]).toMatchObject({ status: 'sent', attempts: 1, fbtrace_id: 'TRACE1' });
    });

    it('venda sem visita rastreada ainda vai, so com os dados do comprador', async () => {
      const { service } = makeService({
        'sales.select': { data: [line({ session_id: null, visitor_id: null })], error: null },
        'capi_events.insert': { data: { id: 'row-1' }, error: null },
      });
      await service.sendPurchases(['sale-1']);
      const [event] = sentBody().data;
      expect(event.user_data.em).toBeDefined();
      expect(event.user_data.fbp).toBeUndefined();
      expect(event.event_source_url).toBeUndefined();
    });

    it('estado e pais vem da visita (geolocalizacao), nao do endereco do webhook', async () => {
      const { service } = makeService({
        'sales.select': { data: [line({ customer_state: 'RJ', customer_country: 'PT' })], error: null },
        'tracking_sessions.select': { data: SESSION, error: null },
        'capi_events.insert': { data: { id: 'row-1' }, error: null },
      });
      await service.sendPurchases(['sale-1']);
      const [event] = sentBody().data;
      expect(event.user_data.st).toEqual([sha256('sp')]);
      expect(event.user_data.country).toEqual([sha256('br')]);
    });

    it('sem visita casada, estado e pais vem do webhook', async () => {
      const { service } = makeService({
        'sales.select': { data: [line({ session_id: null, visitor_id: null, customer_state: 'RJ' })], error: null },
        'capi_events.insert': { data: { id: 'row-1' }, error: null },
      });
      await service.sendPurchases(['sale-1']);
      const [event] = sentBody().data;
      expect(event.user_data.st).toEqual([sha256('rj')]);
    });

    it('webhook reenviado: a reserva bate na unicidade e nada sai de novo', async () => {
      const { service } = makeService({
        'sales.select': { data: [line({})], error: null },
        'tracking_sessions.select': { data: SESSION, error: null },
        'capi_events.insert': { data: null, error: { message: 'duplicate key value violates unique constraint' } },
      });
      await service.sendPurchases(['sale-1']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('compra paga ha mais de 7 dias vai com a hora do envio', async () => {
      const { service } = makeService({
        'sales.select': { data: [line({ sold_at: new Date(Date.now() - 10 * 86400_000).toISOString() })], error: null },
        'tracking_sessions.select': { data: SESSION, error: null },
        'capi_events.insert': { data: { id: 'row-1' }, error: null },
      });
      await service.sendPurchases(['sale-1']);
      const [event] = sentBody().data;
      expect(Math.abs(event.event_time - Date.now() / 1000)).toBeLessThan(5);
    });
  });

  describe('detalhe de um envio', () => {
    const payload = { event_name: 'PageView', event_id: 'e-pv', user_data: { em: ['hash'] } };

    it('devolve o corpo como foi ao Meta, sem o token, e a resposta', async () => {
      const { service } = makeService({
        'capi_events.select': {
          data: { id: 'row-1', event_name: 'PageView', status: 'sent', payload, response: { events_received: 1 } },
          error: null,
        },
      });
      const detail: any = await service.getEvent('user-1', WS, 'row-1');
      expect(detail.request).toEqual({ data: [payload] });
      expect(detail.response).toEqual({ events_received: 1 });
      expect(JSON.stringify(detail)).not.toContain('EAAB-token');
      expect(detail.payload).toBeUndefined();
    });

    it('envio de outra area nao aparece', async () => {
      const { service } = makeService({ 'capi_events.select': { data: null, error: null } });
      await expect(service.getEvent('user-1', WS, 'row-x')).rejects.toThrow('Envio nao encontrado');
    });
  });
});
