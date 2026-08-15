import { useState, useMemo } from 'react';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { DateRange as DayPickerRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';

export interface DateRange {
  from: Date;
  to: Date;
  /**
   * Set by the "Todo período" preset.
   *
   * `from`/`to` still carry usable dates so nothing downstream has to
   * special-case them, but they are placeholders: the real start is resolved on
   * the server, from the first sale and bounded by Facebook's insights
   * retention. Sending a date from here would risk revenue and ad spend landing
   * on different windows.
   */
  allTime?: boolean;
}

export interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
}

type PresetKey =
  | 'today'
  | 'yesterday'
  | 'last_7d'
  | 'last_30d'
  | 'this_month'
  | 'last_month'
  | 'all_time'
  | 'custom';

/** Placeholder start for the all-time preset. Never reaches the API — see DateRange.allTime. */
const ALL_TIME_PLACEHOLDER_START = new Date(2015, 0, 1);

interface Preset {
  key: PresetKey;
  label: string;
  getRange: () => DateRange;
}

const getPresets = (): Preset[] => {
  const today = new Date();

  return [
    {
      key: 'today',
      label: 'Hoje',
      getRange: () => ({ from: startOfDay(today), to: endOfDay(today) }),
    },
    {
      key: 'yesterday',
      label: 'Ontem',
      getRange: () => ({ from: startOfDay(subDays(today, 1)), to: endOfDay(subDays(today, 1)) }),
    },
    {
      key: 'last_7d',
      label: 'Últimos 7 dias',
      getRange: () => ({ from: startOfDay(subDays(today, 6)), to: endOfDay(today) }),
    },
    {
      key: 'last_30d',
      label: 'Últimos 30 dias',
      getRange: () => ({ from: startOfDay(subDays(today, 29)), to: endOfDay(today) }),
    },
    {
      key: 'this_month',
      label: 'Este mês',
      getRange: () => ({ from: startOfMonth(today), to: endOfDay(today) }),
    },
    {
      key: 'last_month',
      label: 'Mês passado',
      getRange: () => ({ from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) }),
    },
    {
      key: 'all_time',
      label: 'Todo período',
      getRange: () => ({
        from: ALL_TIME_PLACEHOLDER_START,
        to: endOfDay(today),
        allTime: true,
      }),
    },
  ];
};

export function getDefaultDateRange(): DateRange {
  const today = new Date();
  return { from: startOfDay(today), to: endOfDay(today) };
}

export function getPresetFromRange(dateRange: DateRange): PresetKey {
  // Checked by flag, not by dates: the all-time dates are placeholders and
  // matching them by value would be a coincidence waiting to happen.
  if (dateRange.allTime) return 'all_time';

  for (const preset of getPresets()) {
    if (preset.key === 'all_time') continue;
    const range = preset.getRange();
    if (isSameDay(dateRange.from, range.from) && isSameDay(dateRange.to, range.to)) {
      return preset.key;
    }
  }
  return 'custom';
}

export function getPresetLabel(key: PresetKey): string {
  if (key === 'custom') return 'Personalizado';
  return getPresets().find(p => p.key === key)?.label ?? 'Personalizado';
}

export function DateRangeFilter({ dateRange, onDateRangeChange }: DateRangeFilterProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [manualCustom, setManualCustom] = useState(false);
  const [customRange, setCustomRange] = useState<DayPickerRange | undefined>({
    from: dateRange.from,
    to: dateRange.to,
  });
  const isMobile = useIsMobile();

  const presets = useMemo(() => getPresets(), []);
  const inferredPreset = useMemo(() => getPresetFromRange(dateRange), [dateRange]);
  const activePreset: PresetKey = manualCustom || inferredPreset === 'custom' ? 'custom' : inferredPreset;

  const handlePresetChange = (key: PresetKey) => {
    if (key === 'custom') {
      setManualCustom(true);
      setCustomRange({ from: dateRange.from, to: dateRange.to });
      setCalendarOpen(true);
      return;
    }

    setManualCustom(false);
    setCalendarOpen(false);
    const preset = presets.find(p => p.key === key);
    if (preset) onDateRangeChange(preset.getRange());
  };

  const handleRangeSelect = (range: DayPickerRange | undefined) => {
    const hadCompleteRange = !!(customRange?.from && customRange?.to);

    if (hadCompleteRange) {
      const fromChanged = range?.from && range.from.getTime() !== customRange!.from!.getTime();
      const toChanged = range?.to && range.to.getTime() !== customRange!.to!.getTime();
      const clickedDate = fromChanged ? range?.from : toChanged ? range?.to : range?.from;
      setCustomRange(clickedDate ? { from: clickedDate, to: undefined } : undefined);
      return;
    }

    if (!range) {
      setCustomRange(undefined);
      return;
    }

    setCustomRange(range);

    if (range.from && range.to) {
      onDateRangeChange({
        from: startOfDay(range.from),
        to: endOfDay(range.to),
      });
      setCalendarOpen(false);
    }
  };

  const formatDateRange = (range: DateRange) =>
    `${format(range.from, 'dd/MM/yyyy')} — ${format(range.to, 'dd/MM/yyyy')}`;

  return (
    <div className="flex items-center gap-1.5">
      <Select value={activePreset} onValueChange={(v) => handlePresetChange(v as PresetKey)}>
        <SelectTrigger className="w-[170px] h-8 text-xs">
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {presets.map((preset) => (
            <SelectItem key={preset.key} value={preset.key}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Personalizado</SelectItem>
        </SelectContent>
      </Select>

      {activePreset === 'custom' && (
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-[200px] justify-start text-left font-normal text-xs"
            >
              <CalendarIcon className="mr-2 h-3.5 w-3.5" />
              <span className="text-muted-foreground">{formatDateRange(dateRange)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-0 max-h-[calc(100vh-6rem)] overflow-y-auto"
            align="end"
          >
            <Calendar
              mode="range"
              selected={customRange}
              onSelect={handleRangeSelect}
              defaultMonth={customRange?.from ?? dateRange.from}
              numberOfMonths={isMobile ? 1 : 2}
              locale={ptBR}
              initialFocus
              className="p-2"
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
