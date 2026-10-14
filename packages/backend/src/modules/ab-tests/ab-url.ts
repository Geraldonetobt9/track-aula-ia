/**
 * Identidade de uma página para o teste A/B: host sem "www." + caminho sem a
 * barra final. É a mesma conta que o tracker.js faz com location.hostname e
 * location.pathname (hostPath no tracker-script.ts) — as duas precisam dar o
 * mesmo resultado, senão o snippet não reconhece a página do teste.
 *
 * A query string fica de fora de propósito: a mesma página chega com UTMs e
 * fbclid diferentes a cada anúncio.
 */
export function pageKey(host: string, pathname: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  const p = (pathname || '/').replace(/\/+$/, '');
  return h + p;
}

export interface NormalizedPage {
  /** URL como o visitante vai abrir (sem fragmento). */
  url: string;
  /** host + caminho, para comparar com a página atual no snippet. */
  key: string;
  host: string;
}

/** URL digitada no painel → URL limpa e chave. null quando não é http(s). */
export function normalizePageUrl(raw: string | null | undefined): NormalizedPage | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null;
  url.hash = '';
  return {
    url: url.toString().slice(0, 1000),
    key: pageKey(url.hostname, url.pathname),
    host: url.hostname.toLowerCase().replace(/^www\./, ''),
  };
}
