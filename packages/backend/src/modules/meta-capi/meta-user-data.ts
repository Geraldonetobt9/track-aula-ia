import { createHash } from 'crypto';

/**
 * Montagem do user_data da Conversions API.
 *
 * O Meta compara hash com hash: o mesmo e-mail escrito com uma maiúscula a
 * mais vira outro SHA-256 e não casa com ninguém. Por isso cada campo passa
 * pela normalização que a documentação pede antes do hash. IP, user agent,
 * fbp e fbc vão em claro — é assim que o Meta os aceita.
 */

export interface UserDataInput {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  externalId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

export type MetaUserData = Record<string, string | string[]>;

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/**
 * Só dígitos, com o código do país. Telefone brasileiro chega sem o 55 na
 * maioria dos checkouts (o container da Hotmart colava "55" na frente à mão).
 */
export function normalizePhone(value: string | null | undefined, country = 'br'): string | null {
  let digits = (value ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  if (country === 'br' && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Primeiro nome e sobrenome, minúsculos e sem pontuação. */
export function splitName(value: string | null | undefined): { fn: string | null; ln: string | null } {
  const parts = (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { fn: null, ln: null };
  return { fn: parts[0], ln: parts.length > 1 ? parts[parts.length - 1] : null };
}

/** Cidade: minúscula, sem acento, sem espaço ("São Paulo" → "saopaulo"). */
export function normalizeCity(value: string | null | undefined): string | null {
  const v = stripAccents(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return v || null;
}

/** Estado: a sigla, minúscula ("SP" → "sp"). Nome por extenso não casa. */
export function normalizeState(value: string | null | undefined): string | null {
  const v = stripAccents(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return v.length === 2 ? v : null;
}

export function normalizeCountry(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'bra' || v === 'brasil' || v === 'brazil') return 'br';
  return /^[a-z]{2}$/.test(v) ? v : null;
}

export function normalizeZip(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return v || null;
}

/**
 * external_id: o id do visitante (cookie _stl_vid) em hash. É o mesmo valor
 * nos três eventos, então o Meta liga PageView, InitiateCheckout e Purchase
 * à mesma pessoa.
 */
export function hashExternalId(visitorId: string | null | undefined): string | null {
  return visitorId ? sha256(visitorId) : null;
}

export function buildUserData(input: UserDataInput): MetaUserData {
  const out: MetaUserData = {};
  const country = normalizeCountry(input.country);
  const put = (key: string, normalized: string | null) => {
    if (normalized) out[key] = [sha256(normalized)];
  };

  put('em', normalizeEmail(input.email));
  put('ph', normalizePhone(input.phone, country ?? 'br'));
  const { fn, ln } = splitName(input.fullName);
  put('fn', fn);
  put('ln', ln);
  put('ct', normalizeCity(input.city));
  put('st', normalizeState(input.state));
  put('zp', normalizeZip(input.zip));
  put('country', country);

  const externalId = hashExternalId(input.externalId);
  if (externalId) out.external_id = [externalId];

  if (input.ip) out.client_ip_address = input.ip;
  if (input.userAgent) out.client_user_agent = input.userAgent;
  if (input.fbp) out.fbp = input.fbp;
  if (input.fbc) out.fbc = input.fbc;
  return out;
}
