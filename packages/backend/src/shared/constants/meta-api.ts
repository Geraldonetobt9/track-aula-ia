/**
 * Versão da Graph API do Meta, num lugar só: Ads (campanhas, insights, token)
 * e API de Conversões usam a mesma.
 *
 * META_API_VERSION na Vercel sobrepõe o padrão — para testar uma versão nova
 * sem deploy de código, ou voltar a uma anterior se o Meta mudar algo.
 */
export const META_API_VERSION = process.env.META_API_VERSION || 'v25.0';

export const GRAPH_API_URL = `https://graph.facebook.com/${META_API_VERSION}`;
