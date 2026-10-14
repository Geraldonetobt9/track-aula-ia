/**
 * O tracker.js que roda na página de vendas do cliente.
 *
 * Fica numa string, e não num arquivo .js ao lado: a API roda como função da
 * Vercel a partir do dist compilado pelo tsc, e um asset solto não é copiado
 * pelo nest build nem garantidamente empacotado na função. Uma constante vai
 * junto com o código, sempre.
 *
 * ES5 de propósito — sem arrow, sem let/const, sem template string. O script
 * roda em qualquer navegador que abrir a página do cliente, e um erro de
 * sintaxe num navegador velho derruba só o rastreio, mas derruba em silêncio.
 *
 * O que ele faz:
 *   - _stl_vid (1 ano) identifica o navegador; _stl_sid (30 min, renovado a
 *     cada evento) identifica a visita; _stl_utm guarda as UTMs da chegada.
 *   - _fbp e _fbc: lê os do pixel do Meta, ou cria no mesmo formato quando não
 *     existem (fbc a partir do fbclid da URL).
 *   - O indexador stl_<sessão> vai no parâmetro da plataforma (sck, src, xcod,
 *     trk ou utm_term): na URL da página, nos links e nos formulários de
 *     checkout. A plataforma o devolve no webhook, e é ele que liga a compra à
 *     visita — o papel do Stape Store nos containers do sGTM. No link do
 *     checkout ele sempre vence um valor que já estava lá: sem ele a venda não
 *     casa com a visita.
 *   - Todos os parâmetros da URL de chegada (_stl_qs, 7 dias) seguem para o
 *     checkout, não só as UTMs. Links que aparecem depois do carregamento (o
 *     botão que o VTurb solta no meio do vídeo) são decorados por um
 *     MutationObserver.
 *   - pageview quando o DOM carrega; checkout_click (InitiateCheckout) quando a
 *     página vai para o checkout: link, formulário, window.open, botão com a
 *     URL no onclick/data-href, redirecionamento por script (Navigation API,
 *     que também troca o destino pelo decorado) ou sentinel('checkout', url).
 *     Os dois com event_id, que o servidor usa na CAPI.
 *   - Com PIXEL configurado, o próprio snippet carrega o pixel do Meta e
 *     dispara PageView e InitiateCheckout no navegador com o mesmo event_id
 *     da CAPI: o Meta deduplica pelo event_id. Sem PIXEL não há CAPI, e o
 *     snippet não toca em fbq nenhum.
 *   - Hotmart (XCOD_UTM): as UTMs da chegada vão também no xcod, no formato
 *     source|conjunto|id|campanha|id|anúncio|id|posicionamento — a Hotmart não
 *     devolve utm_* no webhook, só o xcod, e é dele que o processador tira o
 *     anúncio (parseXcod). O indexador continua no sck.
 *   - page_exit ao sair, com o tempo na página.
 *   - Teste A/B (AB, os testes rodando na área): na página de um teste, o
 *     visitante cai numa variante por um sorteio fixo pelo _stl_vid — volta
 *     sempre à mesma. Modo redirect: se a variante é outra página, vai para
 *     ela antes de qualquer pageview, com a query string da chegada, e o
 *     referrer original segue no cookie _stl_abref (60s). Modo elements: o
 *     snippet esconde os blocos data-stl-ab de outras variantes e tira o
 *     hidden dos da sorteada. O sorteio vai no primeiro envio (campo ab); a
 *     venda chega à variante pelo indexador: venda → sessão → visitante.
 *     Sem cookie gravável não há sorteio: sem _stl_vid estável o visitante
 *     trocaria de variante a cada página.
 *   - sentinel('ab', fn) entrega { id do teste: letra } da página.
 *   - sentinel('track', 'nome', {props}) para eventos manuais.
 *   - Do Not Track ligado: não faz nada.
 */

const SOURCE = `(function (w, d) {
  'use strict';
  var TID = __TID__, ENDPOINT = __ENDPOINT__, PARAM = __PARAM__, PIXEL = __PIXEL__, XCOD_UTM = __XCOD_UTM__;
  var n = w.navigator || {};
  var pending = (w.sentinel && w.sentinel.q) || [];
  if (n.doNotTrack == '1' || n.doNotTrack == 'yes' || w.doNotTrack == '1' || n.msDoNotTrack == '1') {
    w.sentinel = function () {};
    return;
  }
  if (w.__stlLoaded) return;
  w.__stlLoaded = 1;

  var YEAR = 31536000, SESSION = 1800, UTM_TTL = 604800, FB_TTL = 7776000;
  var PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ad_id'];
  var CHECKOUT = /(hotmart|kiwify|kirvano|perfectpay|payt|cakto|hub\\.la|hubla|ticto|cartpanda|ggcheckout|lastlink|eduzz|mundpay|monetizze|greenn|clkdmg|digitalmanager|assiny|doppus|frendz|herospark|kavoo|pagtrust|wiapy|wiven|yampi|checkout)/i;
  var CHECKOUT_SUB = /^(pay|payment|seguro|secure|checkout|compra|comprar|pagamento)\\./i;
  var URL_IN_TEXT = /https?:\\/\\/[^\\s'"<>()]+/g;
  var URL_ATTRS = ['onclick', 'data-href', 'data-url', 'data-link', 'formaction'];
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  function uuid() {
    var c = w.crypto, h = '', i, b;
    if (c && c.getRandomValues) {
      b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      for (i = 0; i < 16; i++) {
        h += (b[i] + 256).toString(16).slice(1);
        if (i == 3 || i == 5 || i == 7 || i == 9) h += '-';
      }
      return h;
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch == 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function getCookie(k) {
    var m = d.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)'));
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }

  var cookieDomain;
  function setCookie(k, v, maxAge) {
    var base = k + '=' + encodeURIComponent(v) + '; max-age=' + maxAge + '; path=/; SameSite=Lax' +
      (location.protocol == 'https:' ? '; Secure' : '');
    var parts, i, dom;
    if (cookieDomain === undefined) {
      cookieDomain = '';
      parts = location.hostname.split('.');
      for (i = parts.length - 2; i >= 0; i--) {
        dom = parts.slice(i).join('.');
        d.cookie = base + '; domain=' + dom;
        if (getCookie(k) === v) { cookieDomain = dom; return; }
      }
    }
    d.cookie = base + (cookieDomain ? '; domain=' + cookieDomain : '');
  }

  function urlParam(s, k) {
    var m = s.match(new RegExp('[?&]' + k + '=([^&#]*)'));
    if (!m || !m[1]) return null;
    try { return decodeURIComponent(m[1].replace(/\\+/g, ' ')); } catch (e) { return m[1]; }
  }

  function readParams() {
    var out = {}, found = false, i, v;
    for (i = 0; i < PARAMS.length; i++) {
      v = urlParam(location.search, PARAMS[i]);
      if (v && v.indexOf('stl_') !== 0) { out[PARAMS[i]] = v; found = true; }
    }
    if (found) {
      setCookie('_stl_utm', JSON.stringify(out), UTM_TTL);
      return out;
    }
    try { return JSON.parse(getCookie('_stl_utm') || '{}') || {}; } catch (e) { return {}; }
  }

  function readQuery() {
    var pairs = location.search.replace(/^\\?/, '').split('&'), keep = [], i, k;
    for (i = 0; i < pairs.length; i++) {
      k = pairs[i].split('=')[0];
      if (k && pairs[i].indexOf('=stl_') < 0) keep.push(pairs[i]);
    }
    if (keep.length) {
      var qs = keep.join('&').slice(0, 1500);
      setCookie('_stl_qs', qs, UTM_TTL);
      return qs;
    }
    return getCookie('_stl_qs') || '';
  }

  var queue = [], timer = null, sid = null;
  var vid = getCookie('_stl_vid');
  if (!UUID.test(vid || '')) vid = uuid();
  setCookie('_stl_vid', vid, YEAR);
  var utm = readParams();
  var arrival = readQuery();

  var abSend = null, abMap = {}, abRef = null, abReveal = function () {};
  __AB_BLOCK__

  // Nome e ID sempre em dois pedaços, para o parseXcod achar cada um no lugar.
  function pair(v) {
    v = v || '';
    return v.indexOf('|') >= 0 ? v : v + '|';
  }

  function utmXcod() {
    if (!XCOD_UTM || !(utm.utm_source || utm.utm_campaign || utm.utm_medium || utm.utm_content)) return null;
    return [utm.utm_source || '', pair(utm.utm_medium), pair(utm.utm_campaign), pair(utm.utm_content), utm.utm_term || ''].join('|');
  }

  var now0 = new Date().getTime();
  var fbp = getCookie('_fbp');
  if (!/^fb\\.\\d\\.\\d+\\.\\d+$/.test(fbp || '')) {
    fbp = 'fb.1.' + now0 + '.' + Math.floor(1000000000 + Math.random() * 8999999999);
    setCookie('_fbp', fbp, FB_TTL);
  }
  var fbc = getCookie('_fbc');
  var fbclid = urlParam(location.search, 'fbclid');
  if (fbclid && (!fbc || fbc.slice(-fbclid.length - 1) !== '.' + fbclid)) {
    fbc = 'fb.1.' + now0 + '.' + fbclid;
    setCookie('_fbc', fbc, FB_TTL);
  }

  function send(body) {
    try { if (n.sendBeacon && n.sendBeacon(ENDPOINT, body)) return; } catch (e) {}
    try {
      if (w.fetch) {
        w.fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', credentials: 'include',
          headers: { 'Content-Type': 'text/plain' } })['catch'](function () {});
        return;
      }
    } catch (e) {}
    try {
      var x = new XMLHttpRequest();
      x.open('POST', ENDPOINT, true);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'text/plain');
      x.send(body);
    } catch (e) {}
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var batch = queue, body = {
      tid: TID, vid: vid, sid: sid, fbp: fbp, fbc: fbc || null,
      sr: (w.screen ? w.screen.width + 'x' + w.screen.height : null),
      lang: n.language || null,
      events: batch
    };
    queue = [];
    if (abSend) { body.ab = abSend; abSend = null; }
    send(JSON.stringify(body));
  }

  function setParam(href, value, force) {
    var hash = '', h = href.indexOf('#'), re = new RegExp('([?&])' + PARAM + '=([^&#]*)'), m;
    if (h >= 0) { hash = href.slice(h); href = href.slice(0, h); }
    m = href.match(re);
    if (m) {
      if (force || m[2].indexOf('stl_') === 0) href = href.replace(re, '$1' + PARAM + '=' + value);
    } else {
      href += (href.indexOf('?') >= 0 ? '&' : '?') + PARAM + '=' + value;
    }
    return href + hash;
  }

  function markPage() {
    if (!w.history || !history.replaceState) return;
    var next = setParam(location.href, 'stl_' + sid, PARAM === 'utm_term');
    if (next !== location.href) {
      try { history.replaceState(history.state, '', next); } catch (e) {}
    }
  }

  function touchSession() {
    var cur = getCookie('_stl_sid');
    if (!UUID.test(cur || '')) {
      if (queue.length) flush();
      cur = uuid();
    }
    var changed = cur !== sid;
    sid = cur;
    setCookie('_stl_sid', sid, SESSION);
    if (changed) {
      markPage();
      if (ready) scheduleDecorate();
    }
  }

  function enqueue(ev, now) {
    touchSession();
    queue.push(ev);
    if (now || queue.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 2000);
  }

  var pageId = uuid().slice(0, 8), start = now0, exited = false, icSent = false, ready = false, decorateTimer = null;

  function event(type, extra) {
    var e = { type: type, url: location.href, page_id: pageId }, k;
    for (k in extra) if (extra.hasOwnProperty(k)) e[k] = extra[k];
    return e;
  }

  var pixelOn = false;
  function loadPixel() {
    if (pixelOn) return;
    pixelOn = true;
    if (typeof w.fbq !== 'function') {
      var f = w.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
      if (!w._fbq) w._fbq = f;
      f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
      var s = d.createElement('script'), first = d.getElementsByTagName('script')[0];
      s.async = true;
      s.src = 'https://connect.facebook.net/en_US/fbevents.js';
      if (first && first.parentNode) first.parentNode.insertBefore(s, first);
      else (d.head || d.documentElement).appendChild(s);
    }
    try { w.fbq('init', PIXEL, { external_id: vid }); } catch (e) {}
  }

  function mirror(name, id) {
    if (!PIXEL) return;
    try {
      loadPixel();
      w.fbq('trackSingle', PIXEL, name, {}, { eventID: id });
    } catch (e) {}
  }

  function exit() {
    if (exited) return;
    exited = true;
    enqueue(event('page_exit', { duration_seconds: Math.round((new Date().getTime() - start) / 1000) }), true);
  }

  function linkFor(url) {
    var a = d.createElement('a');
    a.href = url;
    return a;
  }

  function isCheckout(a, marked) {
    if (!a || !a.href || String(a.protocol).indexOf('http') !== 0) return false;
    if (marked) return true;
    return a.hostname !== location.hostname && (CHECKOUT.test(a.hostname) || CHECKOUT_SUB.test(a.hostname));
  }

  function hasKey(href, k) {
    var p = (href.split('#')[0].split('?')[1] || '').split('&'), i;
    for (i = 0; i < p.length; i++) if (p[i].split('=')[0] === k) return true;
    return false;
  }

  function decorateUrl(href) {
    var add = [], pairs = arrival ? arrival.split('&') : [], i, k, xc = utmXcod();
    href = setParam(href, 'stl_' + sid, true);
    if (xc && !hasKey(href, 'xcod')) add.push('xcod=' + encodeURIComponent(xc));
    for (i = 0; i < pairs.length; i++) {
      k = pairs[i].split('=')[0];
      if (k !== PARAM && !hasKey(href, k) && !(xc && k === 'xcod')) add.push(pairs[i]);
    }
    if (!add.length) return href;
    var hash = '', h = href.indexOf('#');
    if (h >= 0) { hash = href.slice(h); href = href.slice(0, h); }
    return href + (href.indexOf('?') >= 0 ? '&' : '?') + add.join('&') + hash;
  }

  function decorate(a) {
    var next = decorateUrl(a.href);
    if (next !== a.href) a.href = next;
  }

  function checkout(url) {
    if (icSent) return;
    icSent = true;
    var id = uuid();
    enqueue(event('checkout_click', { event_id: id, props: { href: String(url).split('?')[0] } }), true);
    mirror('InitiateCheckout', id);
  }

  function decorateAll() {
    decorateTimer = null;
    var links = d.getElementsByTagName('a'), i;
    for (i = 0; i < links.length; i++) {
      if (isCheckout(links[i], links[i].hasAttribute && links[i].hasAttribute('data-sentinel-checkout'))) decorate(links[i]);
    }
  }

  function scheduleDecorate() {
    if (!decorateTimer) decorateTimer = setTimeout(decorateAll, 50);
  }

  function checkoutInAttrs(el) {
    var i, v, urls, j, found = null;
    if (!el.getAttribute) return null;
    for (i = 0; i < URL_ATTRS.length; i++) {
      v = el.getAttribute(URL_ATTRS[i]);
      urls = v && v.match(URL_IN_TEXT);
      for (j = 0; urls && j < urls.length; j++) {
        if (!isCheckout(linkFor(urls[j]), el.hasAttribute('data-sentinel-checkout'))) continue;
        found = found || urls[j];
        v = v.split(urls[j]).join(decorateUrl(urls[j]));
        el.setAttribute(URL_ATTRS[i], v);
      }
    }
    return found;
  }

  function onClick(ev) {
    var a = ev.target, el = ev.target, url;
    while (a && a.nodeName !== 'A') a = a.parentNode;
    if (isCheckout(a, a && a.hasAttribute && a.hasAttribute('data-sentinel-checkout'))) {
      touchSession();
      decorate(a);
      checkout(a.href);
      return;
    }
    touchSession();
    for (; el && el !== d; el = el.parentNode) {
      url = checkoutInAttrs(el);
      if (url) { checkout(url); return; }
    }
  }

  function goCheckout(url) {
    if (!url) return;
    touchSession();
    var next = decorateUrl(linkFor(url).href);
    checkout(next);
    location.href = next;
  }

  function onSubmit(ev) {
    var f = ev.target, action, input;
    if (!f || f.nodeName !== 'FORM') return;
    action = linkFor(f.getAttribute('action') || location.href);
    if (!isCheckout(action, f.hasAttribute('data-sentinel-checkout'))) return;
    touchSession();
    input = f.querySelector ? f.querySelector('input[name="' + PARAM + '"]') : null;
    if (!input) {
      input = d.createElement('input');
      input.type = 'hidden';
      input.name = PARAM;
      f.appendChild(input);
    }
    if (!input.value || input.value.indexOf('stl_') === 0 || PARAM === 'utm_term') input.value = 'stl_' + sid;
    var xc = utmXcod();
    if (xc && !(f.querySelector && f.querySelector('input[name="xcod"]'))) {
      input = d.createElement('input');
      input.type = 'hidden';
      input.name = 'xcod';
      input.value = xc;
      f.appendChild(input);
    }
    checkout(action.href);
  }

  function track(name, props) {
    if (!name) return;
    if (name === 'checkout_click') { checkout(location.href); return; }
    enqueue(event('custom', { name: String(name), props: props || null }));
  }

  function api(cmd) {
    if (cmd === 'track') track(arguments[1], arguments[2]);
    else if (cmd === 'checkout') goCheckout(arguments[1]);
    else if (cmd === 'ab' && typeof arguments[1] === 'function') {
      try { arguments[1](abMap); } catch (e) {}
    }
  }

  function pageview() {
    var ref = abRef !== null ? (abRef || null) : (d.referrer || null);
    var id = uuid(), pv = event('pageview', { referrer: ref, event_id: id }), i;
    abReveal();
    for (i = 0; i < PARAMS.length; i++) if (utm[PARAMS[i]]) pv[PARAMS[i]] = utm[PARAMS[i]];
    enqueue(pv, true);
    mirror('PageView', id);
    ready = true;
    decorateAll();
    if (w.MutationObserver) {
      new w.MutationObserver(scheduleDecorate).observe(d.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['href']
      });
    }
  }

  touchSession();

  if (typeof w.open === 'function') {
    var open = w.open;
    w.open = function (url) {
      if (url && isCheckout(linkFor(url))) {
        touchSession();
        arguments[0] = decorateUrl(linkFor(url).href);
        checkout(arguments[0]);
      }
      return open.apply(this, arguments);
    };
  }
  if (w.navigation && w.navigation.addEventListener) {
    w.navigation.addEventListener('navigate', function (e) {
      var url = e.destination && e.destination.url, next;
      if (!url || !isCheckout(linkFor(url))) return;
      touchSession();
      checkout(url);
      next = decorateUrl(linkFor(url).href);
      if (next !== url && e.cancelable && !e.formData && !e.hashChange && e.navigationType !== 'traverse') {
        e.preventDefault();
        setTimeout(function () { location.href = next; }, 0);
      }
    });
  }

  d.addEventListener('visibilitychange', function () {
    if (d.visibilityState === 'hidden') exit();
    else exited = false;
  });
  w.addEventListener('pagehide', exit);
  w.addEventListener('beforeunload', exit);
  w.addEventListener('pageshow', function (e) { if (e.persisted) { exited = false; icSent = false; } });
  d.addEventListener('click', onClick, true);
  d.addEventListener('submit', onSubmit, true);
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', pageview);
  else pageview();

  w.sentinel = api;
  for (var q = 0; q < pending.length; q++) api.apply(null, pending[q]);
})(window, document);
`;

/**
 * Bloco do teste A/B. Entra no lugar de __AB_BLOCK__ só quando a área tem
 * teste rodando: quem não testa nada recebe o script do mesmo tamanho de
 * antes. Sem ele, abSend, abMap, abRef e abReveal ficam nos valores neutros
 * declarados no SOURCE.
 */
const AB_SOURCE = `  var AB = __AB__, abCookies = getCookie('_stl_vid') === vid, abKey = null;
  abRef = getCookie('_stl_abref');
  if (abRef !== null) {
    setCookie('_stl_abref', '', 0);
    d.cookie = '_stl_abref=; max-age=0; path=/';
  }

  function hostPath(host, path) {
    var h = String(host || '').toLowerCase().replace(/^www\\./, '');
    return h + String(path || '/').replace(/\\/+$/, '');
  }

  function abHash(s) {
    var h = 2166136261, i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0) / 4294967296;
  }

  function abPick(t) {
    var total = 0, acc = 0, i, r;
    for (i = 0; i < t.v.length; i++) total += t.v[i].w;
    r = abHash(vid + ':' + t.id) * total;
    for (i = 0; i < t.v.length; i++) {
      acc += t.v[i].w;
      if (r < acc) return t.v[i];
    }
    return t.v[t.v.length - 1];
  }

  function abTarget(u) {
    var hash = '', h = u.indexOf('#'), pairs = location.search.replace(/^\\?/, '').split('&'), add = [], i, k;
    if (h >= 0) { hash = u.slice(h); u = u.slice(0, h); }
    for (i = 0; i < pairs.length; i++) {
      k = pairs[i].split('=')[0];
      if (k && pairs[i].indexOf('=stl_') < 0 && !hasKey(u, k)) add.push(pairs[i]);
    }
    if (add.length) u += (u.indexOf('?') >= 0 ? '&' : '?') + add.join('&');
    return u + (hash || location.hash || '');
  }

  abReveal = function () {
    if (!abKey || !d.querySelectorAll) return;
    var els = d.querySelectorAll('[data-stl-ab~="' + abKey + '"][hidden]'), i;
    for (i = 0; i < els.length; i++) els[i].removeAttribute('hidden');
  };

  function abShow(k) {
    var s = d.createElement('style');
    s.appendChild(d.createTextNode('[data-stl-ab]:not([data-stl-ab~="' + k + '"]){display:none!important}'));
    (d.head || d.documentElement).appendChild(s);
    d.documentElement.className += ' stl-ab-' + k.toLowerCase();
    abKey = k;
    abReveal();
  }

  function abRun() {
    var here = hostPath(location.hostname, location.pathname), i, j, t, on, pick;
    if (!abCookies || !AB) return false;
    for (i = 0; i < AB.length; i++) {
      t = AB[i];
      on = t.m === 'elements' && t.p === here;
      for (j = 0; t.m === 'redirect' && j < t.v.length; j++) if (t.v[j].p === here) on = true;
      if (!on) continue;
      pick = abPick(t);
      if (t.m === 'redirect' && pick.p !== here) {
        setCookie('_stl_abref', (d.referrer || '').slice(0, 500), 60);
        try { location.replace(abTarget(pick.u)); return true; } catch (e) { continue; }
      }
      abMap[t.id] = pick.k;
      (abSend = abSend || {})[t.id] = pick.id;
      if (t.m === 'elements') abShow(pick.k);
    }
    return false;
  }

  if (abRun()) return;
`;

/**
 * Compactação mínima: tira indentação e linhas vazias. Não há comentário
 * dentro do SOURCE, então não é preciso entender a sintaxe do JS para isso —
 * e nenhum minificador de verdade vira dependência de produção.
 */
function compact(source: string): string {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

const COMPACT = compact(SOURCE);
const COMPACT_AB = compact(AB_SOURCE);

/** Variante de um teste A/B, no formato curto que vai dentro do script. */
export interface TrackerAbVariant {
  id: string;
  /** Letra: A (controle), B, C... */
  k: string;
  /** Peso do sorteio. */
  w: number;
  /** Modo redirect: a URL da variante e a chave host+caminho dela. */
  u: string | null;
  p: string | null;
}

/** Teste A/B rodando, como o snippet precisa dele. */
export interface TrackerAbTest {
  id: string;
  m: 'redirect' | 'elements';
  /** Chave host+caminho da página do teste (ver pageKey em ab-tests/ab-url.ts). */
  p: string;
  v: TrackerAbVariant[];
}

export interface TrackerOptions {
  /** Parâmetro que a plataforma devolve no webhook. */
  param: string;
  /** O snippet carrega e inicia este pixel, e dispara nele com o event_id da CAPI. */
  pixelId?: string | null;
  /** Hotmart: manda as UTMs da chegada no xcod, que é o que ela devolve no webhook. */
  xcodUtm?: boolean;
  /** Testes A/B rodando na área. */
  abTests?: TrackerAbTest[];
}

const SAFE_PIXEL = /^\d{5,20}$/;

const SAFE_PARAM = /^(sck|src|xcod|trk|utm_term)$/;

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_KEY = /^[A-E]$/;

/**
 * Só o que tem o formato esperado entra no script. Os testes vêm do banco,
 * gravados pelo dono da área, mas o script roda na página dos visitantes
 * dele: um valor torto aqui não pode virar erro de sintaxe lá.
 */
function safeAbTests(tests: TrackerAbTest[] | undefined): TrackerAbTest[] {
  const out: TrackerAbTest[] = [];
  for (const t of tests ?? []) {
    if (!SAFE_ID.test(t.id) || (t.m !== 'redirect' && t.m !== 'elements') || typeof t.p !== 'string') continue;
    const variants = t.v.filter(
      (v) =>
        SAFE_ID.test(v.id) &&
        SAFE_KEY.test(v.k) &&
        Number.isFinite(v.w) &&
        v.w > 0 &&
        (t.m === 'elements' || (typeof v.u === 'string' && /^https?:\/\//.test(v.u) && typeof v.p === 'string')),
    );
    if (variants.length >= 2) out.push({ id: t.id, m: t.m, p: t.p, v: variants });
  }
  return out;
}

/** JSON dentro de JS: U+2028/2029 são quebra de linha para navegador antigo. */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

function jsJson(value: unknown): string {
  return JSON.stringify(value).split(LS).join('\\u2028').split(PS).join('\\u2029');
}

/**
 * O script pronto para uma área. Os valores entram via JSON.stringify, então
 * nada que venha da requisição consegue fechar a string e virar código. A
 * substituição usa função, e não string, porque numa string de reposição o
 * replace interpreta `$&` e afins.
 */
export function buildTrackerScript(
  workspaceId: string,
  endpoint: string,
  options: TrackerOptions = { param: 'sck' },
): string {
  const param = SAFE_PARAM.test(options.param) ? options.param : 'sck';
  const pixel = options.pixelId && SAFE_PIXEL.test(options.pixelId) ? options.pixelId : null;
  const abTests = safeAbTests(options.abTests);
  // O bloco A/B entra por último: as URLs das variantes vêm do usuário, e
  // nenhuma substituição seguinte pode encostar nelas.
  const ab = abTests.length ? COMPACT_AB.replace('__AB__', () => jsJson(abTests)) : '';
  return COMPACT.replace('__TID__', () => JSON.stringify(workspaceId))
    .replace('__ENDPOINT__', () => JSON.stringify(endpoint))
    .replace('__PARAM__', () => JSON.stringify(param))
    .replace('__PIXEL__', () => JSON.stringify(pixel))
    .replace('__XCOD_UTM__', () => JSON.stringify(!!options.xcodUtm))
    .replace('__AB_BLOCK__', () => ab);
}

/** Resposta para área desconhecida: define sentinel() e não faz nada. */
export const NOOP_TRACKER_SCRIPT =
  '/* Sentinela: area desconhecida, rastreio desligado */\n' +
  'window.sentinel=function(){};\n';
