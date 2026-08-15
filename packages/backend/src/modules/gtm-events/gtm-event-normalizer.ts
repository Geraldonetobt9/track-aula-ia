import { createHash } from 'crypto';

/**
 * Fields removed from the payload before anything is stored.
 *
 * Two groups, both stripped for the same reason — this is a diagnostics tool,
 * not a place customer data should accumulate:
 *   - Meta CAPI `user_data` members (already hashed by the browser, still PII)
 *   - the cookies themselves, since `_fbp` is only ever persisted as a salted
 *     hash and `_fbc` carries the click id
 *
 * Matching is case-insensitive and applied at every depth, because sGTM tag
 * templates nest these under varying shapes.
 */
const PII_FIELDS = new Set([
  'user_data',
  'userdata',
  'em',
  'ph',
  'email',
  'phone',
  'phone_number',
  'external_id',
  'externalid',
  'fn',
  'ln',
  'first_name',
  'last_name',
  'ct',
  'st',
  'zp',
  'db',
  'ge',
  'client_ip_address',
  'clientipaddress',
  'ip',
  'ip_address',
  'fbp',
  'fbc',
  '_fbp',
  '_fbc',
]);

/** Guards against a hostile or malformed payload nesting itself into a stack overflow. */
const MAX_STRIP_DEPTH = 8;

/** Unix timestamps in seconds are 10 digits; anything larger is already milliseconds. */
const UNIX_SECONDS_CUTOFF = 1e11;

const MAX_TEXT_LENGTH = 2048;

export interface GtmEventInput {
  event_name?: unknown;
  event_id?: unknown;
  event_time?: unknown;
  value?: unknown;
  currency?: unknown;
  page_url?: unknown;
  fbp?: unknown;
  fbc?: unknown;
  fbclid?: unknown;
  /** The site's own identifier for the logged-in person. Portuguese key, as the tag sends it. */
  id_do_usuario?: unknown;
  [key: string]: unknown;
}

export interface NormalizedGtmEvent {
  workspace_id: string;
  user_id: string;
  event_name: string;
  event_id: string | null;
  event_time: string;
  value: number | null;
  currency: string | null;
  page_url: string | null;
  has_fbp: boolean;
  has_fbc: boolean;
  visitor_hash: string | null;
  external_user_id: string | null;
  fbclid: string | null;
  raw: Record<string, unknown>;
}

/** Recursively drops PII keys. Returns a new structure; the input is untouched. */
export function stripPii(value: unknown, depth = 0): unknown {
  if (depth > MAX_STRIP_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => stripPii(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PII_FIELDS.has(key.toLowerCase())) continue;
    result[key] = stripPii(item, depth + 1);
  }
  return result;
}

/**
 * Stable per-browser identifier derived from `_fbp`.
 *
 * The salt makes the hash useless outside this database: without it, `_fbp` is
 * guessable enough that a leaked hash could be matched back to a cookie. The
 * salt must never change — every existing hash would stop matching, and repeat
 * visitors would silently be recounted as new ones.
 */
export function hashVisitor(fbp: string, salt: string): string {
  return createHash('sha256').update(`${fbp}${salt}`).digest('hex');
}

function toText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * Like toText, but also accepts a number.
 *
 * User ids are frequently numeric, and a tag that sends `"id_do_usuario": 4821`
 * unquoted would otherwise be silently dropped — the worst kind of failure
 * here, since the event still stores fine and only the visit numbering breaks.
 */
function toIdText(value: unknown, maxLength: number): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return toText(value, maxLength);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Accepts what sGTM actually sends: unix seconds (the CAPI convention), unix
 * milliseconds, or an ISO string. Falls back to now() rather than rejecting —
 * an event with a bad timestamp is still worth seeing in the stream.
 */
function toEventTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < UNIX_SECONDS_CUTOFF ? value * 1000 : value;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toEventTime(numeric);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Turns one raw sGTM payload into a row, or null if it carries no event name.
 *
 * Returning null instead of throwing is deliberate: a batch with one malformed
 * item should still store the rest (RN-04).
 */
export function normalizeGtmEvent(
  input: GtmEventInput,
  context: { workspaceId: string; userId: string; visitorSalt: string },
): NormalizedGtmEvent | null {
  if (!input || typeof input !== 'object') return null;

  const eventName = toText(input.event_name, 120);
  if (!eventName) return null;

  const fbp = toText(input.fbp);
  const fbc = toText(input.fbc);

  return {
    workspace_id: context.workspaceId,
    user_id: context.userId,
    event_name: eventName,
    event_id: toText(input.event_id, 200),
    event_time: toEventTime(input.event_time),
    value: toNumber(input.value),
    currency: toText(input.currency, 8),
    page_url: toText(input.page_url),
    has_fbp: !!fbp,
    has_fbc: !!fbc,
    visitor_hash: fbp ? hashVisitor(fbp, context.visitorSalt) : null,
    // Promoted to its own column so visits can be grouped by the person the
    // site knows, not just by the browser. Deliberately not hashed: unlike
    // `_fbp` this is the operator's own identifier for their own user, and it
    // has to stay readable to be useful when debugging a specific person.
    external_user_id: toIdText(input.id_do_usuario, 200),
    fbclid: toText(input.fbclid, 500),
    raw: stripPii(input) as Record<string, unknown>,
  };
}
