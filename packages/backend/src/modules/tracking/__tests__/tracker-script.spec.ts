import { buildTrackerScript } from '../tracker-script';

// O jsdom já está no monorepo (via testes do frontend), mas sem @types:
// require evita trazer uma dependência só para tipar o teste.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');
type JSDOM = any;

const TID = '11111111-2222-4333-8444-555555555555';
const ENDPOINT = 'https://track.loja.com.br/api/t/collect';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const opened: JSDOM[] = [];

interface Page {
  dom: JSDOM;
  w: any;
  openMock: jest.Mock;
  beacons: any[];
  hide: () => void;
}

interface LoadOptions {
  dnt?: boolean;
  queued?: unknown[][];
  param?: string;
  cookies?: string[];
  fbq?: jest.Mock;
  pixel?: string;
  xcodUtm?: boolean;
}

/**
 * Carrega o tracker numa página de vendas de mentira, com o snippet de
 * instalação já tendo enfileirado chamadas (como acontece quando o
 * sentinel() é chamado antes de o tracker.js terminar de baixar).
 */
function loadPage(url: string, html = '', opts: LoadOptions = {}): Page {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
    referrer: 'https://l.facebook.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  opened.push(dom);
  const w = dom.window as any;
  const beacons: any[] = [];

  for (const c of opts.cookies ?? []) w.document.cookie = `${c}; path=/`;
  Object.defineProperty(w.navigator, 'sendBeacon', {
    value: (endpoint: string, body: string) => {
      expect(endpoint).toBe(ENDPOINT);
      beacons.push(JSON.parse(body));
      return true;
    },
  });
  if (opts.dnt) Object.defineProperty(w.navigator, 'doNotTrack', { value: '1' });
  if (opts.fbq) w.fbq = opts.fbq;
  // jsdom não implementa window.open nem navegação.
  const openMock = jest.fn();
  w.open = openMock;
  w.document.addEventListener('click', (e: Event) => e.preventDefault());
  w.document.addEventListener('submit', (e: Event) => e.preventDefault());

  // O loader do snippet: guarda as chamadas até o script chegar.
  w.sentinel = function () {
    (w.sentinel.q = w.sentinel.q || []).push(arguments);
  };
  for (const args of opts.queued ?? []) w.sentinel(...args);

  w.eval(
    buildTrackerScript(TID, ENDPOINT, { param: opts.param ?? 'sck', pixelId: opts.pixel, xcodUtm: opts.xcodUtm }),
  );

  return {
    dom,
    w,
    openMock,
    beacons,
    hide: () => {
      Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
      w.document.dispatchEvent(new w.Event('visibilitychange'));
    },
  };
}

function events(page: Page) {
  return page.beacons.flatMap((b) => b.events);
}

/** O pageview e a decoração dos links acontecem no DOMContentLoaded. */
function ready(page: Page): Promise<void> {
  const doc = page.dom.window.document;
  if (doc.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => doc.addEventListener('DOMContentLoaded', () => resolve()));
}

function sidOf(page: Page) {
  return page.dom.window.document.cookie.match(/_stl_sid=([^;]+)/)![1];
}

describe('tracker.js', () => {
  // Fecha as janelas: o timer do lote de 2s seguraria o jest aberto.
  afterEach(() => opened.splice(0).forEach((dom) => dom.window.close()));

  describe('PageView', () => {
    it('sai quando o DOM carrega, na hora, com UTMs, fbp, fbc e event_id', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta?utm_source=facebook&utm_campaign=camp|123&utm_content=ad|120245519580910309&fbclid=IwAR0abc',
      );
      expect(page.beacons).toHaveLength(0); // DOM ainda carregando
      await ready(page);

      expect(page.beacons).toHaveLength(1);
      const [batch] = page.beacons;
      expect(batch.tid).toBe(TID);
      expect(batch.vid).toMatch(UUID);
      expect(batch.sid).toMatch(UUID);
      expect(batch.fbp).toMatch(/^fb\.1\.\d{13}\.\d{10}$/);
      expect(batch.fbc).toMatch(/^fb\.1\.\d{13}\.IwAR0abc$/);

      const [pv] = batch.events;
      expect(pv).toMatchObject({
        type: 'pageview',
        utm_source: 'facebook',
        utm_campaign: 'camp|123',
        utm_content: 'ad|120245519580910309',
        fbclid: 'IwAR0abc',
        referrer: 'https://l.facebook.com/',
      });
      expect(pv.event_id).toMatch(UUID);
    });

    it('usa o _fbp e o _fbc que o pixel do Meta ja gravou', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '', {
        cookies: ['_fbp=fb.1.1711800000000.1234567890', '_fbc=fb.1.1711800000000.IwAR_antigo'],
      });
      await ready(page);
      expect(page.beacons[0].fbp).toBe('fb.1.1711800000000.1234567890');
      expect(page.beacons[0].fbc).toBe('fb.1.1711800000000.IwAR_antigo');
    });

    it('clique novo no anuncio troca o _fbc', async () => {
      const page = loadPage('https://www.loja.com.br/oferta?fbclid=IwAR_novo', '', {
        cookies: ['_fbc=fb.1.1711800000000.IwAR_antigo'],
      });
      await ready(page);
      expect(page.beacons[0].fbc).toMatch(/\.IwAR_novo$/);
      expect(page.dom.window.document.cookie).toContain('IwAR_novo');
    });

    it('com o pixel configurado, carrega o pixel sozinho e dispara com o event_id da CAPI', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '', { pixel: '123456789012345' });
      await ready(page);
      const doc = page.dom.window.document;
      const script = doc.querySelector('script[src*="connect.facebook.net"]');
      expect(script).not.toBeNull();
      const calls = page.w.fbq.queue.map((a: any) => Array.from(a));
      const id = events(page)[0].event_id;
      expect(calls[0]).toEqual(['init', '123456789012345', { external_id: page.beacons[0].vid }]);
      expect(calls[1]).toEqual(['trackSingle', '123456789012345', 'PageView', {}, { eventID: id }]);
    });

    it('pagina que ja tem fbq: usa o dela, sem carregar outro, e dispara so no pixel da area', async () => {
      const fbq = jest.fn();
      const page = loadPage('https://www.loja.com.br/oferta', '', { fbq, pixel: '123456789012345' });
      await ready(page);
      const id = events(page)[0].event_id;
      expect(page.dom.window.document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
      expect(fbq).toHaveBeenCalledWith('init', '123456789012345', expect.any(Object));
      expect(fbq).toHaveBeenCalledWith('trackSingle', '123456789012345', 'PageView', {}, { eventID: id });
    });

    it('sem pixel configurado nao toca em fbq nenhum', async () => {
      const fbq = jest.fn();
      const page = loadPage('https://www.loja.com.br/oferta', '', { fbq });
      await ready(page);
      expect(fbq).not.toHaveBeenCalled();
      expect(page.dom.window.document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
    });
  });

  describe('Indexador', () => {
    it('vai na URL da pagina, no parametro da plataforma', async () => {
      const page = loadPage('https://www.loja.com.br/oferta?utm_source=facebook#topo', '', { param: 'src' });
      await ready(page);
      const url = new URL(page.dom.window.location.href);
      expect(url.searchParams.get('src')).toBe(`stl_${sidOf(page)}`);
      expect(url.searchParams.get('utm_source')).toBe('facebook');
      expect(url.hash).toBe('#topo');
    });

    it('vai no link do checkout, com as UTMs da chegada que o link nao tem', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta?utm_source=facebook&utm_campaign=camp&utm_content=ad|123456',
        `<a id="buy" href="https://pay.hotmart.com/X123?off=abc&utm_campaign=fixa#pagar">Comprar</a>
         <a id="blog" href="https://www.loja.com.br/blog">Blog</a>`,
      );
      await ready(page);
      const doc = page.dom.window.document;
      const buy = new URL((doc.getElementById('buy') as HTMLAnchorElement).href);

      expect(buy.searchParams.get('sck')).toBe(`stl_${sidOf(page)}`);
      expect(buy.searchParams.get('utm_source')).toBe('facebook');
      expect(buy.searchParams.get('utm_content')).toBe('ad|123456');
      expect(buy.searchParams.get('utm_campaign')).toBe('fixa');
      expect(buy.searchParams.get('off')).toBe('abc');
      expect(buy.hash).toBe('#pagar');
      expect((doc.getElementById('blog') as HTMLAnchorElement).href).toBe('https://www.loja.com.br/blog');
    });

    it('xcod para Greenn/PagTrust/Assiny', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '<a id="buy" href="https://payment.greenn.com.br/123">C</a>', {
        param: 'xcod',
      });
      await ready(page);
      const href = (page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href;
      expect(new URL(href).searchParams.get('xcod')).toBe(`stl_${sidOf(page)}`);
      expect(new URL(href).searchParams.get('sck')).toBeNull();
    });

    it('utm_term (Yampi, Wiapy, Doppus) substitui o utm_term que ja existe, porque e a unica chave', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta?utm_source=facebook&utm_term=feed',
        '<a id="buy" href="https://seguro.loja.yampi.com.br/r/ABC?utm_term=feed">C</a>',
        { param: 'utm_term' },
      );
      await ready(page);
      const href = (page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href;
      expect(new URL(href).searchParams.getAll('utm_term')).toEqual([`stl_${sidOf(page)}`]);
      // A UTM original foi lida antes, e chega ao servidor no pageview.
      expect(events(page)[0].utm_term).toBe('feed');
    });

    it('substitui um sck que ja estava no link: sem o indexador a venda nao casa com a visita', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta',
        '<a id="buy" href="https://pay.kiwify.com.br/abc?sck=meu-codigo">Comprar</a>',
      );
      await ready(page);
      const href = (page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href;
      expect(new URL(href).searchParams.getAll('sck')).toEqual([`stl_${sidOf(page)}`]);
    });

    it('leva todos os parametros da chegada, nao so as UTMs', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta?utm_source=fb&src=anuncio7&xcod=abc&fbclid=IwAR0&cupom=PROMO',
        '<a id="buy" href="https://pay.hotmart.com/X123?off=1">C</a>',
      );
      await ready(page);
      const url = new URL((page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href);
      expect(url.searchParams.get('sck')).toBe(`stl_${sidOf(page)}`);
      expect(url.searchParams.get('utm_source')).toBe('fb');
      expect(url.searchParams.get('src')).toBe('anuncio7');
      expect(url.searchParams.get('xcod')).toBe('abc');
      expect(url.searchParams.get('fbclid')).toBe('IwAR0');
      expect(url.searchParams.get('cupom')).toBe('PROMO');
      expect(url.searchParams.get('off')).toBe('1');
    });

    it('parametros da chegada seguem numa segunda pagina sem query', async () => {
      const first = loadPage('https://www.loja.com.br/oferta?utm_source=fb&cupom=PROMO');
      await ready(first);
      const cookies = first.dom.window.document.cookie.split('; ');
      const page = loadPage('https://www.loja.com.br/oferta-2', '<a id="buy" href="https://pay.hotmart.com/X">C</a>', {
        cookies,
      });
      await ready(page);
      const url = new URL((page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href);
      expect(url.searchParams.get('cupom')).toBe('PROMO');
      expect(url.searchParams.get('utm_source')).toBe('fb');
    });

    it('decora o botao que aparece depois do carregamento (CTA atrasado do video)', async () => {
      const page = loadPage('https://www.loja.com.br/oferta?utm_source=fb');
      await ready(page);
      const doc = page.dom.window.document;
      const a = doc.createElement('a');
      a.id = 'late';
      a.href = 'https://pay.kiwify.com.br/abc';
      doc.body.appendChild(a);
      await new Promise((r) => setTimeout(r, 120));
      const url = new URL(a.href);
      expect(url.searchParams.get('sck')).toBe(`stl_${sidOf(page)}`);
      expect(url.searchParams.get('utm_source')).toBe('fb');
    });

    it('checkout em subdominio pay./seguro. de dominio proprio conta', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '<a id="buy" href="https://seguro.minhaloja.com.br/c/1">C</a>');
      await ready(page);
      const href = (page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href;
      expect(new URL(href).searchParams.get('sck')).toBe(`stl_${sidOf(page)}`);
    });

    it('Hotmart: as UTMs da chegada vao no xcod, no formato que o parseXcod le', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta?utm_source=FB&utm_campaign=Camp|111111&utm_medium=Conj|222222&utm_content=Ad|333333&utm_term=feed',
        '<a id="buy" href="https://pay.hotmart.com/X123">C</a>',
        { xcodUtm: true },
      );
      await ready(page);
      const buy = new URL((page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href);
      expect(buy.searchParams.get('sck')).toBe(`stl_${sidOf(page)}`);
      expect(buy.searchParams.get('xcod')).toBe('FB|Conj|222222|Camp|111111|Ad|333333|feed');
      expect(buy.searchParams.getAll('xcod')).toHaveLength(1);
    });

    it('Hotmart: sem UTM na chegada, nao inventa xcod', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '<a id="buy" href="https://pay.hotmart.com/X123">C</a>', {
        xcodUtm: true,
      });
      await ready(page);
      const buy = new URL((page.dom.window.document.getElementById('buy') as HTMLAnchorElement).href);
      expect(buy.searchParams.get('xcod')).toBeNull();
    });

    it('Hotmart: o formulario de checkout leva o xcod com as UTMs', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta?utm_source=FB&utm_campaign=Camp|111111&utm_medium=Conj|222222&utm_content=Ad|333333',
        '<form id="f" action="https://pay.hotmart.com/X123" method="get"><button id="b">Comprar</button></form>',
        { xcodUtm: true },
      );
      await ready(page);
      const form = page.dom.window.document.getElementById('f') as HTMLFormElement;
      form.dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
      const input = form.querySelector('input[name="xcod"]') as HTMLInputElement;
      expect(input.value).toBe('FB|Conj|222222|Camp|111111|Ad|333333|');
    });

    it('vai no formulario de checkout como campo escondido', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta',
        '<form id="f" action="https://pay.hotmart.com/X123" method="get"><button id="b">Comprar</button></form>',
      );
      await ready(page);
      const form = page.dom.window.document.getElementById('f') as HTMLFormElement;
      form.dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
      const input = form.querySelector('input[name="sck"]') as HTMLInputElement;
      expect(input.value).toBe(`stl_${sidOf(page)}`);
      expect(events(page).some((e) => e.type === 'checkout_click')).toBe(true);
    });
  });

  describe('InitiateCheckout', () => {
    it('clique no link do checkout sai na hora, com event_id', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta',
        '<a href="https://pay.kiwify.com.br/abc"><span id="inner">Comprar agora</span></a>',
      );
      await ready(page);
      (page.dom.window.document.getElementById('inner') as HTMLElement).click();

      const click = events(page).find((e) => e.type === 'checkout_click');
      expect(click.props).toEqual({ href: 'https://pay.kiwify.com.br/abc' });
      expect(click.event_id).toMatch(UUID);
    });

    it('redirecionamento por window.open conta e leva o indexador', async () => {
      const page = loadPage('https://www.loja.com.br/oferta');
      await ready(page);
      page.w.open('https://pay.hotmart.com/X123?off=1', '_blank');
      expect(events(page).some((e) => e.type === 'checkout_click')).toBe(true);
      const [url, target] = page.openMock.mock.calls[0];
      expect(new URL(url).searchParams.get('sck')).toBe(`stl_${sidOf(page)}`);
      expect(new URL(url).searchParams.get('off')).toBe('1');
      expect(target).toBe('_blank');
    });

    it('um por pagina: clique repetido nao manda dois', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '<a id="buy" href="https://pay.kiwify.com.br/abc">C</a>');
      await ready(page);
      const a = page.dom.window.document.getElementById('buy') as HTMLElement;
      a.click();
      a.click();
      expect(events(page).filter((e) => e.type === 'checkout_click')).toHaveLength(1);
    });

    it('dispara no pixel com o mesmo event_id da CAPI', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '<a id="buy" href="https://pay.kiwify.com.br/abc">C</a>', {
        pixel: '123456789012345',
      });
      await ready(page);
      (page.dom.window.document.getElementById('buy') as HTMLElement).click();
      const click = events(page).find((e) => e.type === 'checkout_click');
      const calls = page.w.fbq.queue.map((a: any) => Array.from(a));
      expect(calls).toContainEqual(['trackSingle', '123456789012345', 'InitiateCheckout', {}, { eventID: click.event_id }]);
    });

    it('link marcado com data-sentinel-checkout conta mesmo fora da lista de plataformas', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta',
        '<a id="buy" data-sentinel-checkout href="https://minhaloja.exemplo/pagar">Comprar</a>',
      );
      await ready(page);
      (page.dom.window.document.getElementById('buy') as HTMLElement).click();
      expect(events(page).some((e) => e.type === 'checkout_click')).toBe(true);
    });

    it('botao que redireciona pelo onclick: conta e leva o indexador', async () => {
      const page = loadPage(
        'https://www.loja.com.br/oferta?utm_source=fb',
        `<div><button id="b" onclick="window.location.href='https://pay.hotmart.com/X123?off=1'"><span id="t">Comprar</span></button></div>`,
      );
      await ready(page);
      (page.dom.window.document.getElementById('t') as HTMLElement).click();
      expect(events(page).some((e) => e.type === 'checkout_click')).toBe(true);
      const onclick = page.dom.window.document.getElementById('b')!.getAttribute('onclick')!;
      const url = new URL(onclick.match(/'([^']+)'/)![1]);
      expect(url.searchParams.get('sck')).toBe(`stl_${sidOf(page)}`);
      expect(url.searchParams.get('utm_source')).toBe('fb');
      expect(url.searchParams.get('off')).toBe('1');
    });

    it('botao comum, sem checkout, nao conta', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', `<button id="b" onclick="abrirModal()">Saiba mais</button>`);
      await ready(page);
      (page.dom.window.document.getElementById('b') as HTMLElement).click();
      expect(events(page).some((e) => e.type === 'checkout_click')).toBe(false);
    });

    it('sentinel("checkout", url) conta e redireciona com o indexador', async () => {
      const page = loadPage('https://www.loja.com.br/oferta?utm_source=fb');
      await ready(page);
      // jsdom não navega; basta ver que tentou, com a URL decorada.
      const errors: string[] = [];
      page.dom.virtualConsole.on('jsdomError', (e: Error) => errors.push(e.message));
      page.w.sentinel('checkout', 'https://pay.hotmart.com/X123');
      expect(events(page).some((e) => e.type === 'checkout_click')).toBe(true);
      const click = events(page).find((e) => e.type === 'checkout_click');
      expect(new URL(click.url).hostname).toBe('www.loja.com.br');
      expect(errors.join()).toMatch(/navigation/i);
    });

    it('sentinel("track", "checkout_click") manual', async () => {
      const page = loadPage('https://www.loja.com.br/oferta');
      await ready(page);
      page.w.sentinel('track', 'checkout_click');
      expect(events(page).some((e) => e.type === 'checkout_click')).toBe(true);
    });
  });

  describe('Sessao, saida e eventos proprios', () => {
    it('guarda visitante, sessao e UTMs em cookies do dominio raiz', () => {
      const page = loadPage('https://www.loja.com.br/oferta?utm_source=facebook');
      const cookie = page.dom.window.document.cookie;
      expect(cookie).toMatch(/_stl_vid=[0-9a-f-]{36}/);
      expect(cookie).toMatch(/_stl_sid=[0-9a-f-]{36}/);
      expect(cookie).toContain('_stl_utm=');
    });

    it('page_exit ao sair, com o tempo na pagina', async () => {
      const page = loadPage('https://www.loja.com.br/oferta');
      await ready(page);
      page.hide();
      const exit = events(page).find((e) => e.type === 'page_exit');
      expect(typeof exit.duration_seconds).toBe('number');
    });

    it('evento proprio espera o lote de 2 segundos', async () => {
      const page = loadPage('https://www.loja.com.br/oferta');
      await ready(page);
      page.w.sentinel('track', 'video_play', { pct: 25 });
      expect(events(page).some((e) => e.type === 'custom')).toBe(false);
      await new Promise((r) => setTimeout(r, 2300));
      expect(events(page)).toContainEqual(expect.objectContaining({ type: 'custom', name: 'video_play', props: { pct: 25 } }));
    });

    it('processa as chamadas feitas antes de o script carregar', async () => {
      const page = loadPage('https://www.loja.com.br/oferta', '', { queued: [['track', 'video_play', { pct: 25 }]] });
      await ready(page);
      page.hide();
      expect(events(page)).toContainEqual(expect.objectContaining({ type: 'custom', name: 'video_play' }));
    });

    it('respeita o Do Not Track: nada de cookie, nada de envio', async () => {
      const page = loadPage('https://www.loja.com.br/oferta?utm_source=facebook', '', { dnt: true });
      await ready(page);
      page.hide();
      expect(page.beacons).toHaveLength(0);
      expect(page.dom.window.document.cookie).toBe('');
      expect(() => page.w.sentinel('track', 'x')).not.toThrow();
    });
  });

  describe('Montagem do script', () => {
    it('valor vindo da requisicao nao escapa da string do script', () => {
      const script = buildTrackerScript(TID, 'https://x.com/"+alert(1)+"$&');
      expect(script).toContain(JSON.stringify('https://x.com/"+alert(1)+"$&'));
      expect(() => new Function(script)).not.toThrow();
    });

    it('parametro fora da lista cai no sck', () => {
      const script = buildTrackerScript(TID, ENDPOINT, { param: '"+alert(1)+"' });
      expect(script).toContain('PARAM = "sck"');
    });

    it('fica abaixo de 5 KB comprimido', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { gzipSync } = require('zlib');
      expect(gzipSync(buildTrackerScript(TID, ENDPOINT)).length).toBeLessThan(5 * 1024);
    });
  });
});
