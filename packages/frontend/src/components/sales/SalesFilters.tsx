import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Calendar } from 'lucide-react';
import { CheckoutPlatform, CHECKOUT_PLATFORMS } from '@/types/checkout';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { useIsMobile } from '@/hooks/use-mobile';

export type PeriodOption = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

interface SalesFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  checkoutFilter: string;
  onCheckoutFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  campaignFilter: string;
  onCampaignFilterChange: (value: string) => void;
  campaigns: { id: string; name: string }[];
  productFilter: string;
  onProductFilterChange: (value: string) => void;
  products: string[];
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  periodOption: PeriodOption;
  onPeriodOptionChange: (value: PeriodOption) => void;
}

export function SalesFilters({
  search,
  onSearchChange,
  checkoutFilter,
  onCheckoutFilterChange,
  statusFilter,
  onStatusFilterChange,
  campaignFilter,
  onCampaignFilterChange,
  campaigns,
  productFilter,
  onProductFilterChange,
  products,
  dateRange,
  onDateRangeChange,
  periodOption,
  onPeriodOptionChange,
}: SalesFiltersProps) {
  const platforms = Object.keys(CHECKOUT_PLATFORMS) as CheckoutPlatform[];
  const isMobile = useIsMobile();

  // In-progress range while the user is picking dates. Emit to parent only
  // when both dates are set, so an incomplete selection doesn't trigger a
  // half-applied filter.
  const [customSelection, setCustomSelection] = useState<DateRange | undefined>(dateRange);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  const handleDatePopoverOpenChange = (next: boolean) => {
    setDatePopoverOpen(next);
    if (next) {
      setCustomSelection(dateRange);
    }
  };

  const handleRangeSelect = (range: DateRange | undefined) => {
    const hadCompleteRange = !!(customSelection?.from && customSelection?.to);
    if (hadCompleteRange) {
      const fromChanged = range?.from && range.from.getTime() !== customSelection!.from!.getTime();
      const toChanged = range?.to && range.to.getTime() !== customSelection!.to!.getTime();
      const clickedDate = fromChanged ? range?.from : toChanged ? range?.to : range?.from;
      setCustomSelection(clickedDate ? { from: clickedDate, to: undefined } : undefined);
      return;
    }

    setCustomSelection(range);

    if (range?.from && range?.to) {
      onDateRangeChange({
        from: startOfDay(range.from),
        to: endOfDay(range.to),
      });
      setDatePopoverOpen(false);
    }
  };

  const handlePeriodChange = (value: PeriodOption) => {
    onPeriodOptionChange(value);
    const now = new Date();
    
    switch (value) {
      case 'today':
        onDateRangeChange({ from: startOfDay(now), to: endOfDay(now) });
        break;
      case 'yesterday':
        onDateRangeChange({ from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) });
        break;
      case '7d':
        onDateRangeChange({ from: startOfDay(subDays(now, 7)), to: endOfDay(now) });
        break;
      case '30d':
        onDateRangeChange({ from: startOfDay(subDays(now, 30)), to: endOfDay(now) });
        break;
      case 'custom':
        // Keep current range or reset
        break;
    }
  };

  const formatDateRange = () => {
    if (!dateRange?.from) return 'Selecionar período';
    if (!dateRange.to) return format(dateRange.from, 'dd/MM/yyyy', { locale: ptBR });
    return `${format(dateRange.from, 'dd/MM', { locale: ptBR })} - ${format(dateRange.to, 'dd/MM', { locale: ptBR })}`;
  };

  const getPeriodLabel = () => {
    switch (periodOption) {
      case 'today':
        return 'Hoje';
      case 'yesterday':
        return 'Ontem';
      case '7d':
        return 'Últimos 7 dias';
      case '30d':
        return 'Últimos 30 dias';
      case 'custom':
        return 'Personalizado';
      default:
        return 'Últimos 30 dias';
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Search */}
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por email, nome ou produto..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Period Selector */}
          <Select value={periodOption} onValueChange={handlePeriodChange}>
            <SelectTrigger>
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="yesterday">Ontem</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom Date Range - only show when custom is selected */}
          {periodOption === 'custom' && (
            <Popover open={datePopoverOpen} onOpenChange={handleDatePopoverOpenChange}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-start text-left font-normal">
                  <Calendar className="mr-2 h-4 w-4" />
                  {formatDateRange()}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 max-h-[calc(100vh-6rem)] overflow-y-auto" align="start">
                <CalendarComponent
                  initialFocus
                  mode="range"
                  defaultMonth={customSelection?.from ?? dateRange?.from}
                  selected={customSelection}
                  onSelect={handleRangeSelect}
                  numberOfMonths={isMobile ? 1 : 2}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
          )}

          {/* Checkout Filter */}
          <Select value={checkoutFilter} onValueChange={onCheckoutFilterChange}>
            <SelectTrigger>
              <SelectValue placeholder="Checkout" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Checkouts</SelectItem>
              {platforms.map((platform) => (
                <SelectItem key={platform} value={platform}>
                  {CHECKOUT_PLATFORMS[platform].name}
                </SelectItem>
              ))}
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Status</SelectItem>
              <SelectItem value="approved">Aprovada</SelectItem>
              <SelectItem value="refunded">Reembolsada</SelectItem>
            </SelectContent>
          </Select>

          {/* Campaign Filter */}
          <Select value={campaignFilter} onValueChange={onCampaignFilterChange}>
            <SelectTrigger>
              <SelectValue placeholder="Campanha" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas Campanhas</SelectItem>
              <SelectItem value="organic">Orgânicas</SelectItem>
              {campaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Product Filter */}
          <Select value={productFilter} onValueChange={onProductFilterChange}>
            <SelectTrigger>
              <SelectValue placeholder="Produto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Produtos</SelectItem>
              {products.map((product) => (
                <SelectItem key={product} value={product}>
                  {product}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Period indicator */}
        <div className="mt-3 text-xs text-muted-foreground/70">
          Exibindo dados de: <span className="font-medium text-muted-foreground/80">{getPeriodLabel()}</span>
        </div>
      </CardContent>
    </Card>
  );
}
