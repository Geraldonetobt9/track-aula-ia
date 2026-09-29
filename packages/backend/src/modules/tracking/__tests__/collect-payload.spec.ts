import { cleanUrl, deviceType, isBot, MAX_EVENTS_PER_BATCH, parseCollectBody } from '../collect-payload';

const TID = '11111111-2222-4333-8444-555555555555';
const VID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SID = 'ffffffff-0000-4111-8222-333333333333';

function body(events: unknown[], extra: Record<string, unknown> = {}) {
  return { tid: TID, vid: VID, sid: SID, sr: '1920x1080', lang: 'pt-BR', events, ...extra };
}

describe('parseCollectBody', () => {
  it('aceita o texto que o sendBeacon manda', () => {
    const batch = parseCollectBody(JSON.stringify(body([{ type: 'pageview', url: 'https://loja.com/a' }])));
    expect(batch).toMatchObject({
      workspaceId: TID,
      visitorId: VID,
      sessionId: SID,
      screenResolution: '1920x1080',
      language: 'pt-BR',
    });
    expect(batch!.events).toHaveLength(1);
  });

  it('recusa lote sem ids validos', () => {
    expect(parseCollectBody(body([{ type: 'pageview' }], { tid: 'nao-e-uuid' }))).toBeNull();
    expect(parseCollectBody(body([{ type: 'pageview' }], { sid: undefined }))).toBeNull();
    expect(parseCollectBody('{quebrado')).toBeNull();
    expect(parseCollectBody(null)).toBeNull();
  });

  it('descarta item invalido sem derrubar o lote', () => {
    const batch = parseCollectBody(body([
      { type: 'pageview', url: 'https://loja.com/a' },
      { type: 'hack' },
      { type: 'custom' }, // custom sem nome
      'texto solto',
    ]));
    expect(batch!.events.map((e) => e.type)).toEqual(['pageview']);
  });

  it('limita o tamanho do lote', () => {
    const many = Array.from({ length: MAX_EVENTS_PER_BATCH + 10 }, () => ({ type: 'pageview' }));
    expect(parseCollectBody(body(many))!.events).toHaveLength(MAX_EVENTS_PER_BATCH);
  });

  it('guarda UTMs so no pageview e duracao so no page_exit', () => {
    const batch = parseCollectBody(body([
      { type: 'pageview', utm_source: ' facebook ', utm_content: 'ad|120245519580910309', duration_seconds: 99 },
      { type: 'page_exit', utm_source: 'x', duration_seconds: 192.6 },
      { type: 'page_exit', duration_seconds: 10 ** 9 },
    ]));
    const [pv, exit, longExit] = batch!.events;
    expect(pv.utm_source).toBe('facebook');
    expect(pv.utm_content).toBe('ad|120245519580910309');
    expect(pv.duration_seconds).toBeNull();
    expect(exit.utm_source).toBeNull();
    expect(exit.duration_seconds).toBe(193);
    expect(longExit.duration_seconds).toBe(86_400);
  });

  it('aceita props pequenas de evento custom e recusa as grandes', () => {
    const batch = parseCollectBody(body([
      { type: 'custom', name: 'video_play', props: { pct: 50 } },
      { type: 'custom', name: 'grande', props: { x: 'a'.repeat(5000) } },
      { type: 'pageview', props: { nao: 'vale' } },
    ]));
    expect(batch!.events.map((e) => e.props)).toEqual([{ pct: 50 }, null, null]);
  });

  it('recusa tela e idioma fora do formato', () => {
    const batch = parseCollectBody(body([{ type: 'pageview' }], { sr: '<script>', lang: 'pt BR; drop' }));
    expect(batch!.screenResolution).toBeNull();
    expect(batch!.language).toBeNull();
  });
});

describe('cleanUrl', () => {
  it('tira query e fragmento', () => {
    expect(cleanUrl('https://loja.com/oferta?fbclid=abc&email=a@b.com#topo')).toBe('https://loja.com/oferta');
  });

  it('recusa o que nao e http', () => {
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('nao e url')).toBeNull();
  });
});

describe('isBot / deviceType', () => {
  it('reconhece o robo do Facebook que abre o link do anuncio', () => {
    expect(isBot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe(false);
  });

  it('classifica o aparelho', () => {
    expect(deviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceType('Mozilla/5.0 (Linux; Android 14; SM-S918B) Mobile Safari/537.36')).toBe('mobile');
    expect(deviceType('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari/537.36')).toBe('tablet');
    expect(deviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0')).toBe('desktop');
  });
});
