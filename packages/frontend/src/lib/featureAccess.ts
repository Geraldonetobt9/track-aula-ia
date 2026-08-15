/**
 * E-mails allowed to use operator-only features.
 *
 * This copy only decides what to render. The real gate is
 * `packages/backend/src/shared/constants/feature-allowlist.ts` — anything here
 * is reachable by editing the bundle, so the list must stay in sync but must
 * never be the only check on a route that returns data.
 */
const OPERATOR_EMAILS = new Set(['allanss.ads@gmail.com']);

export function isOperatorEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return OPERATOR_EMAILS.has(email.trim().toLowerCase());
}
