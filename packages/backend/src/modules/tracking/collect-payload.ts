/**
 * Validação do lote que o tracker.js manda para /api/t/collect.
 *
 * Não usa class-validator: o endpoint é público, recebe texto (sendBeacon
 * manda text/plain, que não dispara preflight de CORS) e precisa descartar
 * item ruim sem recusar o lote inteiro. Uma função pura faz isso com menos
 * cerimônia e testa sem subir o Nest.
 *
 * Tudo que sai daqui já tem tamanho limitado e tipo certo; o RPC
 * tracking_ingest confia nesse formato.
 */

export const EVENT_TYPES = ['pageview', 'checkout_click', 'page_exit', 'custom'] as const;
export type TrackingEventType = (typeof EVENT_TYPES)[number];

/** Um lote é o que o tracker acumula em 2 segundos; 50 já é folga. */
export const MAX_EVENTS_PER_BATCH = 50;
const MAX_PROPS_JSON = 2000;
const MAX_DURATION_SECONDS = 86_400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_ID = /^[0-9a-f]{8}$/;
const SCREEN = /^\d{2,5}x\d{2,5}$/;
const LANGUAGE = /^[A-Za-z0-9-]{2,35}$/;

export interface CollectEvent {
  type: TrackingEventType;
  name: string | null;
  url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  gclid: string | null;
  ad_id: string | null;
  duration_seconds: number | null;
  page_id: string | null;
  /** Id do evento, compartilhado com o pixel do navegador para o Meta deduplicar. */
  event_id: string | null;
  props: Record<string, unknown> | null;
}

export interface CollectBatch {
  workspaceId: string;
  visitorId: string;
  sessionId: string;
  screenResolution: string | null;
  language: string | null;
  /** Cookies do Meta: _fbp identifica o navegador, _fbc o clique no anúncio. */
  fbp: string | null;
  fbc: string | null;
  events: CollectEvent[];
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function uuid(value: unknown): string | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID.test(v) ? v : null;
}

/**
 * URL sem query nem fragmento. As UTMs já chegam em campos próprios, e a
 * query costuma carregar fbclid de 200 caracteres e, às vezes, dado pessoal
 * (e-mail em link de campanha de e-mail). Sem ela, a mesma página agrupa
 * numa linha só no relatório.
 */
export function cleanUrl(value: unknown): string | null {
  const raw = text(value, 4000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return null;
  }
}

/**
 * _fbp e _fbc no formato do Meta: fb.<subdomínio>.<timestamp>.<valor>.
 * Fora dele o Meta recusa o parâmetro, então nem vale guardar.
 */
const META_COOKIE = /^fb\.\d\.\d{10,13}\.[\w.-]{1,450}$/;

function metaCookie(value: unknown): string | null {
  const v = text(value, 500);
  return v && META_COOKIE.test(v) ? v : null;
}

function props(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const json = JSON.stringify(value);
    return json.length <= MAX_PROPS_JSON ? (JSON.parse(json) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeEvent(raw: unknown): CollectEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;

  const type = e.type as TrackingEventType;
  if (!EVENT_TYPES.includes(type)) return null;

  const name = type === 'custom' ? text(e.name, 100) : null;
  if (type === 'custom' && !name) return null;

  const duration = Number(e.duration_seconds);
  const isPageview = type === 'pageview';

  return {
    type,
    name,
    url: cleanUrl(e.url),
    referrer: isPageview ? cleanUrl(e.referrer) : null,
    utm_source: isPageview ? text(e.utm_source, 300) : null,
    utm_medium: isPageview ? text(e.utm_medium, 300) : null,
    utm_campaign: isPageview ? text(e.utm_campaign, 300) : null,
    utm_content: isPageview ? text(e.utm_content, 300) : null,
    utm_term: isPageview ? text(e.utm_term, 300) : null,
    fbclid: isPageview ? text(e.fbclid, 500) : null,
    gclid: isPageview ? text(e.gclid, 500) : null,
    ad_id: isPageview ? text(e.ad_id, 100) : null,
    duration_seconds:
      type === 'page_exit' && Number.isFinite(duration)
        ? Math.min(MAX_DURATION_SECONDS, Math.max(0, Math.round(duration)))
        : null,
    page_id: typeof e.page_id === 'string' && PAGE_ID.test(e.page_id) ? e.page_id : null,
    event_id: uuid(e.event_id),
    props: type === 'custom' || type === 'checkout_click' ? props(e.props) : null,
  };
}

/**
 * O corpo como chegou (string do sendBeacon ou objeto já parseado) → lote
 * válido, ou null quando não há o que gravar.
 */
export function parseCollectBody(body: unknown): CollectBatch | null {
  let data: unknown = body;
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const b = data as Record<string, unknown>;

  const workspaceId = uuid(b.tid);
  const visitorId = uuid(b.vid);
  const sessionId = uuid(b.sid);
  if (!workspaceId || !visitorId || !sessionId || !Array.isArray(b.events)) return null;

  const events = b.events
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(normalizeEvent)
    .filter((e): e is CollectEvent => e !== null);
  if (events.length === 0) return null;

  const screen = text(b.sr, 11);
  const language = text(b.lang, 35);

  return {
    workspaceId,
    visitorId,
    sessionId,
    screenResolution: screen && SCREEN.test(screen) ? screen : null,
    language: language && LANGUAGE.test(language) ? language : null,
    fbp: metaCookie(b.fbp),
    fbc: metaCookie(b.fbc),
    events,
  };
}

/**
 * Robôs visitam página de anúncio o tempo todo — o facebookexternalhit
 * abre cada link que roda no Meta. Contá-los inflaria visitante e derrubaria
 * a conversão.
 */
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|facebookcatalog|preview|monitor|pingdom|curl|wget|python-requests/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT_UA.test(userAgent);
}

export function deviceType(userAgent: string | null): string | null {
  if (!userAgent) return null;
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(userAgent)) return 'mobile';
  return 'desktop';
}
