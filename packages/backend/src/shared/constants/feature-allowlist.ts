/**
 * E-mails allowed to use operator-only features.
 *
 * Mirrored on the frontend in `src/lib/featureAccess.ts`. The frontend copy
 * only hides menu items; this one is the actual gate, because the GTM events
 * API returns data and hiding a route would leave it reachable by any
 * authenticated user.
 *
 * Comparison is case-insensitive — Supabase preserves the casing the user
 * typed at signup, so an exact match is not safe to rely on.
 */
const OPERATOR_EMAILS = new Set(['allanss.ads@gmail.com']);

export function isOperatorEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return OPERATOR_EMAILS.has(email.trim().toLowerCase());
}
