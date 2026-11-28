/** Janela em que um refresh de gasto ainda vale, para não repetir a Meta. */
export const SPEND_FRESH_MS = 15 * 60 * 1000;

/** O pedido ao vivo não puxa anos de histórico: o resto fica no que já está gravado. */
export const SPEND_REFRESH_MAX_DAYS = 92;

export function ymdInSaoPaulo(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Encurta um intervalo longo para os dias mais recentes. `since`/`until` são
 * YYYY-MM-DD. Intervalo já curto volta igual.
 */
export function clampSpendRange(
  since: string,
  until: string,
  maxDays = SPEND_REFRESH_MAX_DAYS,
): { since: string; until: string } {
  const start = new Date(`${since}T12:00:00Z`);
  const end = new Date(`${until}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { since, until };
  }
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (spanDays <= maxDays) return { since, until };
  return { since: addDaysYmd(until, -(maxDays - 1)), until };
}

/**
 * O intervalo está coberto se a linha mais antiga e a mais nova atualizadas
 * dentro do TTL alcançam as duas pontas. O refresh grava o período inteiro
 * de uma vez, então as pontas bastam.
 */
export function spendRangeIsFresh(opts: {
  since: string;
  until: string;
  oldestFreshDate: string | null;
  newestFreshDate: string | null;
}): boolean {
  const { since, until, oldestFreshDate, newestFreshDate } = opts;
  if (!oldestFreshDate || !newestFreshDate) return false;
  return oldestFreshDate <= since && newestFreshDate >= until;
}
