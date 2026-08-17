/**
 * Extracts the authentication token from the request.
 * Each platform sends the token differently (headers or body fields).
 * This function checks headers first, then body fields.
 *
 * NOTE: Query parameters are NOT accepted as a token source — they appear in
 * server access logs and can be cached by proxies, making them a security risk.
 */
export function extractWebhookToken(
  req: { headers: Record<string, string | string[] | undefined> },
  payload: any,
  platform: string,
): string | null {
  // Platform-specific headers first
  switch (platform) {
    case 'hotmart':
      if (req.headers['x-hotmart-hottok']) return req.headers['x-hotmart-hottok'] as string;
      if (req.headers['x-hottok']) return req.headers['x-hottok'] as string;
      break;
    case 'kirvano':
      if (req.headers['x-kirvano-token']) return req.headers['x-kirvano-token'] as string;
      break;
    case 'guru':
      if (payload?.api_token) return payload.api_token;
      if (payload?.payload?.api_token) return payload.payload.api_token;
      break;
    case 'eduzz':
      // Eduzz sends either an HMAC-SHA256 of the raw body in x-signature, or
      // the access key directly in x-eduzz-token. Either is valid; the
      // processor disambiguates and validates.
      if (req.headers['x-signature']) return req.headers['x-signature'] as string;
      if (req.headers['x-eduzz-token']) return req.headers['x-eduzz-token'] as string;
      break;
    case 'hubla':
      // A Hubla assina cada evento com o token dela neste header. Ela nao poe
      // token nenhum no corpo, entao sem este case a requisicao chegava sem
      // autenticacao e era descartada — com HTTP 200, o que fazia a Hubla
      // marcar a entrega como bem-sucedida enquanto a venda se perdia.
      if (req.headers['x-hubla-token']) return req.headers['x-hubla-token'] as string;
      break;
    case 'monetizze':
      if (req.headers['x-monetizze-token']) return req.headers['x-monetizze-token'] as string;
      if (req.headers['monetizze-token']) return req.headers['monetizze-token'] as string;
      break;
  }

  // Generic header checks
  const genericHeaders = ['x-webhook-token', 'x-api-token', 'authorization-token'];
  for (const header of genericHeaders) {
    const value = req.headers[header];
    if (value) return value as string;
  }

  // Body token fields
  if (payload?.token) return payload.token;
  if (payload?.signature) return payload.signature;
  if (payload?.hottok) return payload.hottok;
  if (payload?.api_token) return payload.api_token;

  return null;
}
