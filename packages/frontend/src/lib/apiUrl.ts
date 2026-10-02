/**
 * Base da API, resolvida em um lugar so.
 *
 * O fallback antigo era 'http://localhost:3001/api' cru, espalhado por cinco
 * arquivos. Em producao isso foi embutido no bundle e o navegador tentava
 * alcancar a maquina de quem estava acessando — "Failed to fetch", sem
 * nenhuma pista de que a causa era um endereco de desenvolvimento.
 *
 * Em producao o frontend e a API moram na mesma origem (as funcoes da Vercel
 * atendem em /api), entao o caminho relativo e o padrao correto e dispensa
 * configurar VITE_API_URL. Definir a variavel continua funcionando, para o
 * caso do backend passar a morar em outro dominio.
 */
export const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

/**
 * Mesma base, porem sempre absoluta.
 *
 * Use esta quando a URL for SAIR do app — webhook que o cliente cola no painel
 * da plataforma de checkout. Uma URL relativa
 * funciona no fetch do proprio site e e inutil em qualquer lugar fora dele:
 * a Hubla nao tem como resolver "/api/webhooks/hubla".
 */
export function absoluteApiUrl(): string {
  if (/^https?:\/\//i.test(API_URL)) return API_URL;
  if (typeof window === 'undefined') return API_URL;
  return `${window.location.origin}${API_URL.startsWith('/') ? '' : '/'}${API_URL}`;
}
