import { format, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type FinancialPeriodMode = 'all' | 'year' | 'month';

/**
 * Serialized period used as the Select value: `all`, `year:2026`,
 * `month:2026-07-01`.
 */
export type FinancialPeriodValue = string;

export interface FinancialRange {
  from?: string;
  to?: string;
}

export const ALL_PERIOD: FinancialPeriodValue = 'all';

const MONTHS_IN_PICKER = 12;
const YEARS_IN_PICKER = 4;

export function parsePeriodMode(period: FinancialPeriodValue): FinancialPeriodMode {
  if (period === ALL_PERIOD) return 'all';
  return period.startsWith('year:') ? 'year' : 'month';
}

/**
 * Converts a period into an inclusive date range. "Total" yields an empty
 * range, which the API reads as unbounded.
 */
export function periodToRange(period: FinancialPeriodValue): FinancialRange {
  const mode = parsePeriodMode(period);

  if (mode === 'all') return {};

  if (mode === 'year') {
    const year = period.slice('year:'.length);
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }

  const monthStart = period.slice('month:'.length);
  const end = new Date(`${monthStart}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);

  return { from: monthStart, to: end.toISOString().slice(0, 10) };
}

/**
 * The month a new entry belongs to. Year and total views have no single month,
 * so entries land in the current one.
 */
export function periodToEntryMonth(period: FinancialPeriodValue): string {
  if (parsePeriodMode(period) === 'month') return period.slice('month:'.length);
  return format(startOfMonth(new Date()), 'yyyy-MM-dd');
}

export interface PeriodOption {
  value: FinancialPeriodValue;
  label: string;
}

export function buildMonthOptions(): PeriodOption[] {
  const now = new Date();
  return Array.from({ length: MONTHS_IN_PICKER }, (_, i) => {
    const date = startOfMonth(subMonths(now, i));
    return {
      value: `month:${format(date, 'yyyy-MM-dd')}`,
      label: format(date, "MMMM 'de' yyyy", { locale: ptBR }),
    };
  });
}

export function buildYearOptions(): PeriodOption[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: YEARS_IN_PICKER }, (_, i) => {
    const year = currentYear - i;
    return { value: `year:${year}`, label: String(year) };
  });
}

export function periodLabel(period: FinancialPeriodValue): string {
  if (period === ALL_PERIOD) return 'Total';
  const found = [...buildYearOptions(), ...buildMonthOptions()].find((o) => o.value === period);
  return found?.label ?? 'Total';
}
