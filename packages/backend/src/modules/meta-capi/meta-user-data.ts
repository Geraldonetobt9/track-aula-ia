import { createHash } from 'crypto';

/**
 * Montagem do user_data da Conversions API.
 *
 * O Meta compara hash com hash: o mesmo e-mail escrito com uma maiúscula a
 * mais vira outro SHA-256 e não casa com ninguém. Por isso cada campo passa
 * pela normalização que a documentação pede antes do hash. IP, user agent,
 * fbp e fbc vão em claro — é assim que o Meta os aceita.
 *
 * Cidade não vai: decisão do produto. A geolocalização da visita continua
 * gravada na sessão para os relatórios, só não entra no user_data.
 */

export interface UserDataInput {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
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

interface HashedField {
  key: string;
  label: string;
  raw: string | null;
  normalized: string | null;
}

/** Os campos que vão em SHA-256: o valor de origem e o normalizado. */
function hashedFields(input: UserDataInput): HashedField[] {
  const country = normalizeCountry(input.country);
  const { fn, ln } = splitName(input.fullName);
  const visitor = input.externalId ?? null;
  return [
    { key: 'em', label: 'E-mail', raw: input.email ?? null, normalized: normalizeEmail(input.email) },
    { key: 'ph', label: 'Telefone', raw: input.phone ?? null, normalized: normalizePhone(input.phone, country ?? 'br') },
    { key: 'fn', label: 'Primeiro nome', raw: input.fullName ?? null, normalized: fn },
    { key: 'ln', label: 'Sobrenome', raw: input.fullName ?? null, normalized: ln },
    { key: 'st', label: 'Estado', raw: input.state ?? null, normalized: normalizeState(input.state) },
    { key: 'zp', label: 'CEP', raw: input.zip ?? null, normalized: normalizeZip(input.zip) },
    { key: 'country', label: 'País', raw: input.country ?? null, normalized: country },
    { key: 'external_id', label: 'ID do visitante', raw: visitor, normalized: visitor || null },
  ];
}

export function buildUserData(input: UserDataInput): MetaUserData {
  const out: MetaUserData = {};
  for (const f of hashedFields(input)) {
    if (f.normalized) out[f.key] = [sha256(f.normalized)];
  }

  if (input.ip) out.client_ip_address = input.ip;
  if (input.userAgent) out.client_user_agent = input.userAgent;
  if (input.fbp) out.fbp = input.fbp;
  if (input.fbc) out.fbc = input.fbc;
  return out;
}

export interface UserDataExplanation {
  key: string;
  label: string;
  /** Como o dado está na origem (venda ou visita). */
  original: string | null;
  /** Depois da normalização, antes do hash. Nulo nos campos que vão em claro. */
  normalized: string | null;
  /** O que saiu para o Meta. */
  sent: string | null;
  hashed: boolean;
  /** Veio da visita gravada no banco (e não do webhook ou do navegador). */
  fromDatabase: boolean;
  /**
   * O hash do dado de hoje bate com o que saiu? false quando a origem mudou
   * desde o envio (ou o IP expirou na retenção) — o original mostrado não é
   * prova do que foi enviado.
   */
  matches: boolean;
}

const PLAIN_FIELDS: { key: string; label: string; pick: (i: UserDataInput) => string | null | undefined }[] = [
  { key: 'client_ip_address', label: 'IP', pick: (i) => i.ip },
  { key: 'client_user_agent', label: 'Navegador', pick: (i) => i.userAgent },
  { key: 'fbp', label: 'fbp', pick: (i) => i.fbp },
  { key: 'fbc', label: 'fbc', pick: (i) => i.fbc },
];

/**
 * Lado a lado, para o painel: cada campo do user_data enviado com o dado de
 * origem remontado do banco. Só lê — os originais nunca vão ao Meta.
 */
export function explainUserData(
  input: UserDataInput,
  sentUserData: Record<string, unknown> | null | undefined,
  databaseKeys: ReadonlySet<string> = new Set(),
): UserDataExplanation[] {
  const sent = sentUserData ?? {};
  const first = (v: unknown): string | null => (Array.isArray(v) ? (v[0] ?? null) : typeof v === 'string' ? v : null);
  const out: UserDataExplanation[] = [];

  for (const f of hashedFields(input)) {
    const sentValue = first(sent[f.key]);
    if (!sentValue && !f.normalized) continue;
    out.push({
      key: f.key,
      label: f.label,
      original: f.raw,
      normalized: f.normalized,
      sent: sentValue,
      hashed: true,
      fromDatabase: databaseKeys.has(f.key),
      matches: !!sentValue && !!f.normalized && sha256(f.normalized) === sentValue,
    });
  }
  for (const f of PLAIN_FIELDS) {
    const sentValue = first(sent[f.key]);
    const original = f.pick(input) ?? null;
    if (!sentValue && !original) continue;
    out.push({
      key: f.key,
      label: f.label,
      original,
      normalized: null,
      sent: sentValue,
      hashed: false,
      fromDatabase: databaseKeys.has(f.key),
      matches: !!sentValue && sentValue === original,
    });
  }
  return out;
}
