import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { TrackingModule } from '../tracking.module';
import { SharedModule } from '../../../shared/shared.module';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { MetaCapiService } from '../../meta-capi/meta-capi.service';
import { sharedCookieDomain } from '../tracking-collect.controller';

const TID = '11111111-2222-4333-8444-555555555555';
const VID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SID = 'ffffffff-0000-4111-8222-333333333333';
const EID = '99999999-8888-4777-8666-555555555555';
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
const FBP = 'fb.1.1711800000000.1234567890';
const FBC = 'fb.1.1711800000000.IwAR0abc';

/**
 * A pilha HTTP de verdade (Fastify + ValidationPipe global + ThrottlerGuard
 * global, montados como no bootstrap), com Supabase e CAPI trocados por
 * dublês. Pega o que teste de unidade não pega: o corpo text/plain do
 * sendBeacon, o prefixo /api, o guard global, os headers da resposta.
 */
describe('Rotas públicas do rastreio (HTTP)', () => {
  let app: NestFastifyApplication;
  const rpc = jest.fn();
  const maybeSingle = jest.fn();
  const capi = {
    getConfig: jest.fn(),
    sendWebEvents: jest.fn(),
    invalidateConfig: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ ENCRYPTION_KEY: '0'.repeat(64) })],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
        SharedModule,
        TrackingModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(SupabaseService)
      .useValue({
        getClient: () => ({
          rpc,
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
        }),
      })
      .overrideProvider(MetaCapiService)
      .useValue(capi)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app?.close());
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: 1, error: null });
    maybeSingle.mockReset().mockResolvedValue({ data: { id: TID }, error: null });
    capi.getConfig.mockReset().mockResolvedValue({ param: 'xcod', pixelId: '123456789012345' });
    capi.sendWebEvents.mockReset().mockResolvedValue(undefined);
  });

  const collect = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/t/collect',
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': CHROME, ...headers },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });

  describe('tracker.js', () => {
    it('sai com a area, o endpoint da propria requisicao e a configuracao da plataforma', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/t/tracker.js?tid=${TID}`,
        headers: { host: 'track.loja.com.br', 'x-forwarded-proto': 'https' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.body).toContain(JSON.stringify(TID));
      expect(res.body).toContain('"https://track.loja.com.br/api/t/collect"');
      expect(res.body).toContain('PARAM = "xcod"');
      expect(res.body).toContain('PIXEL = "123456789012345"');
    });

    it('area desconhecida recebe um script que nao faz nada, sem 404 no console do cliente', async () => {
      capi.getConfig.mockResolvedValue(null);
      maybeSingle.mockResolvedValue({ data: null, error: null });
      const res = await app.inject({ method: 'GET', url: '/api/t/tracker.js?tid=22222222-2222-4333-8444-555555555555' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('window.sentinel=function(){}');

      const bad = await app.inject({ method: 'GET', url: '/api/t/tracker.js?tid=<script>' });
      expect(bad.body).toContain('window.sentinel=function(){}');
    });

    it('host estranho nao entra no script', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/t/tracker.js?tid=33333333-2222-4333-8444-555555555555',
        headers: { host: 'evil.com"/><script>' },
      });
      expect(res.body).not.toContain('evil.com');
    });
  });

  describe('collect', () => {
    it('grava fbp, fbc e IP na sessao e manda PageView/InitiateCheckout para a CAPI', async () => {
      const res = await collect(
        {
          tid: TID, vid: VID, sid: SID, sr: '390x844', lang: 'pt-BR', fbp: FBP, fbc: FBC,
          events: [
            { type: 'pageview', event_id: EID, url: 'https://www.loja.com.br/oferta?fbclid=x', utm_source: 'facebook' },
            { type: 'page_exit', duration_seconds: 30 },
          ],
        },
        {
          'x-forwarded-for': '2804:14c:5b8::1, 10.0.0.1',
          'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
          'x-vercel-ip-country-region': 'SP',
          'x-vercel-ip-country': 'BR',
        },
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('');
      expect(res.headers['access-control-allow-origin']).toBe('*');

      const [fn, args] = rpc.mock.calls[0];
      expect(fn).toBe('tracking_ingest');
      expect(args.p_ctx).toMatchObject({
        device_type: 'mobile', city: 'São Paulo', region: 'SP', country: 'BR',
        fbp: FBP, fbc: FBC, ip_address: '2804:14c:5b8::1',
      });
      expect(args.p_events[0]).toMatchObject({ type: 'pageview', event_id: EID, url: 'https://www.loja.com.br/oferta' });

      // Só o pageview vai para a CAPI; a saída de página não é evento do Meta.
      expect(capi.sendWebEvents).toHaveBeenCalledWith(TID, [
        expect.objectContaining({
          type: 'pageview', eventId: EID, url: 'https://www.loja.com.br/oferta',
          visitorId: VID, sessionId: SID, ip: '2804:14c:5b8::1', userAgent: CHROME,
          fbp: FBP, fbc: FBC, city: 'São Paulo', region: 'SP', country: 'BR',
        }),
      ]);
    });

    it('fbp e fbc fora do formato do Meta nao passam', async () => {
      await collect({ tid: TID, vid: VID, sid: SID, fbp: 'lixo', fbc: '<script>', events: [{ type: 'pageview', event_id: EID }] });
      expect(rpc.mock.calls[0][1].p_ctx).toMatchObject({ fbp: null, fbc: null });
    });

    it('no subdominio do cliente, regrava os cookies pelo servidor no dominio raiz', async () => {
      const res = await collect(
        { tid: TID, vid: VID, sid: SID, fbp: FBP, fbc: FBC, events: [{ type: 'pageview', event_id: EID }] },
        { host: 'track.loja.com.br', origin: 'https://www.loja.com.br' },
      );
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] as any);
      expect(cookies).toHaveLength(3);
      expect(cookies[0]).toBe(`_stl_vid=${VID}; Max-Age=31536000; Domain=loja.com.br; Path=/; SameSite=Lax; Secure`);
      expect(cookies[1]).toContain(`_fbp=${encodeURIComponent(FBP)}; Max-Age=7776000; Domain=loja.com.br`);
      expect(cookies[2]).toContain('_fbc=');
    });

    it('fora do subdominio do cliente, nao grava cookie', async () => {
      const res = await collect(
        { tid: TID, vid: VID, sid: SID, fbp: FBP, events: [{ type: 'pageview', event_id: EID }] },
        { host: 'painel.vercel.app', origin: 'https://www.loja.com.br' },
      );
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('robo do Facebook e lixo nao chegam ao banco nem ao Meta, e ainda assim respondem 200', async () => {
      const bot = await collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview' }] }, { 'user-agent': 'facebookexternalhit/1.1' });
      const junk = await collect('nao e json');
      expect(bot.statusCode).toBe(200);
      expect(junk.statusCode).toBe(200);
      expect(rpc).not.toHaveBeenCalled();
      expect(capi.sendWebEvents).not.toHaveBeenCalled();
    });

    it('falha do banco nao vira erro para o visitante', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } });
      const res = await collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview' }] });
      expect(res.statusCode).toBe(200);
    });

    it('nao cai no limite global de 60/min, e sim no proprio de 100/min por IP', async () => {
      const send = (ip: string) => collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview' }] }, { 'x-forwarded-for': ip });

      for (let i = 0; i < 100; i++) expect((await send('9.9.9.9')).statusCode).toBe(200);
      expect(rpc).toHaveBeenCalledTimes(100);

      await send('9.9.9.9'); // 101ª: descartada em silêncio
      expect(rpc).toHaveBeenCalledTimes(100);

      await send('8.8.8.8'); // outro IP segue passando
      expect(rpc).toHaveBeenCalledTimes(101);
    });
  });

  it('ping responde para a verificacao do subdominio, de qualquer origem', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/t/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.json()).toEqual({ ok: true, service: 'sentinela-tracking' });
  });

  it('rotas de leitura exigem login', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tracking/stats?workspace_id=${TID}` });
    expect(res.statusCode).toBe(401);
    const capiRes = await app.inject({ method: 'GET', url: `/api/capi/settings?workspace_id=${TID}` });
    expect(capiRes.statusCode).toBe(401);
    const cron = await app.inject({ method: 'GET', url: '/api/capi/retry-cron' });
    expect(cron.statusCode).toBe(401); // sem CRON_SECRET a rota fica fechada
  });
});

describe('sharedCookieDomain', () => {
  it('acha o dominio raiz comum entre o subdominio de rastreio e a pagina', () => {
    expect(sharedCookieDomain('track.loja.com.br', 'www.loja.com.br')).toBe('loja.com.br');
    expect(sharedCookieDomain('track.loja.com.br', 'loja.com.br')).toBe('loja.com.br');
    expect(sharedCookieDomain('t.loja.com', 'oferta.loja.com')).toBe('loja.com');
  });

  it('sem dominio em comum, nada', () => {
    expect(sharedCookieDomain('painel.vercel.app', 'www.loja.com.br')).toBeNull();
    expect(sharedCookieDomain('track.loja.com.br', 'www.outraloja.com.br')).toBeNull();
    expect(sharedCookieDomain('loja.com', 'www.loja.com')).toBeNull(); // nao grava em "com"
    expect(sharedCookieDomain('track.loja.com.br', null)).toBeNull();
  });
});
