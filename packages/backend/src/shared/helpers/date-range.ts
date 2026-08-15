/**
 * Default IANA timezone for all date-range queries.
 * Users and sales are in Brazil — dates sent as 'YYYY-MM-DD' represent
 * calendar days in this timezone.
 */
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Converts a bare date string (YYYY-MM-DD) to the start-of-day ISO timestamp
 * in the business timezone (America/Sao_Paulo).
 *
 * Example: '2026-04-03' → '2026-04-03T03:00:00.000Z' (midnight BRT = 03:00 UTC)
 *
 * If the string already contains a time component ('T'), it is returned as-is.
 */
export function toStartOfDayUTC(dateStr: string): string {
  if (dateStr.includes('T')) return dateStr;

  return midnightInTimezone(dateStr, DEFAULT_TIMEZONE).toISOString();
}

/**
 * Converts a bare date string (YYYY-MM-DD) to the exclusive upper bound
 * (start of the next day) in the business timezone.
 *
 * Example: '2026-04-03' → '2026-04-04T03:00:00.000Z' (midnight+1 BRT = 03:00 UTC next day)
 *
 * If the string already contains a time component ('T'), it is returned as-is.
 */
export function toExclusiveEndDate(dateStr: string): string {
  if (dateStr.includes('T')) return dateStr;

  const startOfDay = midnightInTimezone(dateStr, DEFAULT_TIMEZONE);
  startOfDay.setUTCDate(startOfDay.getUTCDate() + 1);
  return startOfDay.toISOString();
}

/**
 * Returns a Date representing midnight (00:00) of the given date
 * in the specified IANA timezone, expressed as UTC.
 */
function midnightInTimezone(dateStr: string, timezone: string): Date {
  // Build a formatter that outputs the UTC offset for the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  });

  // Parse the date in UTC first to get the offset for that calendar date
  const probe = new Date(dateStr + 'T12:00:00Z');
  const parts = formatter.formatToParts(probe);
  const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value || '+00:00';

  // offsetStr is like "GMT-03:00" — extract the numeric part
  const match = offsetStr.match(/GMT([+-]\d{2}):(\d{2})/);
  const offsetSign = match ? (match[1].startsWith('-') ? 1 : -1) : 0;
  const offsetHours = match ? parseInt(match[1].replace(/[+-]/, ''), 10) : 0;
  const offsetMinutes = match ? parseInt(match[2], 10) : 0;
  const totalOffsetMs = offsetSign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;

  // Midnight in the target timezone = midnight UTC + offset adjustment
  const midnight = new Date(dateStr + 'T00:00:00Z');
  midnight.setTime(midnight.getTime() + totalOffsetMs);

  return midnight;
}
