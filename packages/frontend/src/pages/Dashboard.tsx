import { useState, useEffect, memo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DollarSign,
  Target,
  BarChart3,
  Database,
  ShoppingCart,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { useDashboardMetrics, RecentSale } from '@/hooks/useDashboardMetrics';
import { useChartColors } from '@/hooks/useChartColors';
import { usePrivacyMode } from '@/hooks/usePrivacyMode';
import { useAuth } from '@/contexts/AuthContext';
import { SalesGlobe } from '@/components/dashboard/SalesGlobe';
import { SyncButton } from '@/components/SyncButton';
import { DateRangeFilter, DateRange, getDefaultDateRange, getPresetFromRange } from '@/components/DateRangeFilter';
import { AdAccountFilter } from '@/components/AdAccountFilter';
import { ProductFilter } from '@/components/ProductFilter';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  prefix?: string;
  suffix?: string;
  loading?: boolean;
  valueColor?: string;
  subtitle?: React.ReactNode;
  blurValue?: boolean;
}

const BLUR_VALUE_CLASS = 'blur-md select-none transition-[filter] duration-200 ease-out';
const VALUE_TRANSITION_CLASS = 'transition-[filter] duration-200 ease-out';

const MetricCard = memo(function MetricCard({ title, value, icon, prefix, suffix, loading, valueColor, subtitle, blurValue }: MetricCardProps) {
  const blurClass = blurValue ? BLUR_VALUE_CLASS : VALUE_TRANSITION_CLASS;
  return (
    <Card>
      <CardContent className="p-4 pb-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
            <div className="text-muted-foreground/60">
              {icon}
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-9 w-28 bg-foreground/5" />
          ) : (
            <p
              className={cn('metric-number text-foreground', blurClass)}
              style={valueColor ? { color: valueColor } : undefined}
            >
              {prefix}{value}{suffix}
            </p>
          )}
          {!loading && subtitle && (
            <p className={cn('text-xs text-muted-foreground/85 leading-snug pt-0.5', blurClass)}>{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

// Revenue Progress Bar — prominent, thicker, total revenue based
const MILESTONES = [
  { value: 0, label: '0' },
  { value: 10000, label: '10k' },
  { value: 100000, label: '100k' },
  { value: 500000, label: '500k' },
  { value: 1000000, label: '1M' },
];

function RevenueProgressBar({ value, loading, blurValues }: { value: number; loading: boolean; blurValues?: boolean }) {
  // Find current milestone segment and next target
  let currentMilestoneIdx = 0;
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    if (value >= MILESTONES[i].value) {
      currentMilestoneIdx = i;
      break;
    }
  }
  const currentMilestone = MILESTONES[currentMilestoneIdx];
  const nextMilestone = MILESTONES[Math.min(currentMilestoneIdx + 1, MILESTONES.length - 1)];

  // Progress within current segment toward next milestone
  const segmentRange = nextMilestone.value - currentMilestone.value;
  const segmentProgress = segmentRange > 0
    ? ((value - currentMilestone.value) / segmentRange) * 100
    : 100;
  const progress = Math.min(Math.max(segmentProgress, 2), 100);

  if (loading) {
    return (
      <div className="hidden lg:flex items-center gap-3">
        <Skeleton className="h-7 w-64 rounded-full bg-foreground/5" />
      </div>
    );
  }

  const formatRevenue = (val: number) => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
    return Math.round(val).toString();
  };

  const blurClass = blurValues ? BLUR_VALUE_CLASS : VALUE_TRANSITION_CLASS;

  return (
    <div
      className="hidden lg:flex items-center gap-3 rounded-full px-4 py-2 border border-accent-readable/15"
      style={{
        background: 'linear-gradient(135deg, rgba(62,143,216,0.06) 0%, rgba(62,143,216,0.02) 50%, rgba(0,0,0,0.3) 100%)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <span className={cn('text-xs text-accent-readable/80 font-medium tabular-nums whitespace-nowrap', blurClass)}>
        R$ {formatRevenue(value)}
      </span>
      <div className={cn('relative w-48 h-3 rounded-full bg-foreground/5 overflow-hidden', blurClass)}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, rgba(62,143,216,0.3) 0%, #3e8fd8 100%)',
            boxShadow: '0 0 10px rgba(62,143,216,0.3)',
          }}
        />
      </div>
      <span className={cn('text-[10px] text-muted-foreground/70 tabular-nums whitespace-nowrap', blurClass)}>
        {nextMilestone.label}
      </span>
    </div>
  );
}

// iPhone notification-style real-time sales panel — full height
function RealtimeSalesPanel({ recentSales, loading, blurValues }: { recentSales: RecentSale[]; loading: boolean; blurValues?: boolean }) {
  const blurClass = blurValues ? BLUR_VALUE_CLASS : VALUE_TRANSITION_CLASS;
  const formatCurrency = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Card className="flex flex-col h-full" style={{ overflow: 'hidden' }}>
      <CardHeader className="pb-2 pt-4 px-4 shrink-0">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Vendas em tempo real
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2 pt-0 px-3 pb-3 min-h-0" style={{ overflow: 'hidden' }}>
        {/* Notification-style sales list — strict no-overflow */}
        <div className="flex-1 space-y-1.5 min-h-0" style={{ overflow: 'hidden' }}>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-foreground/[0.03] p-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-full bg-foreground/5" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-20 bg-foreground/5" />
                    <Skeleton className="h-3 w-16 bg-foreground/5" />
                  </div>
                  <Skeleton className="h-4 w-16 bg-foreground/5" />
                </div>
              </div>
            ))
          ) : recentSales.length > 0 ? (
            recentSales.map((sale, idx) => (
              <div
                key={sale.id}
                className="rounded-2xl bg-foreground/[0.03] border border-foreground/[0.04] px-3.5 py-2.5 transition-all duration-300"
                style={{
                  animationDelay: `${idx * 80}ms`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  {/* App icon - simulates notification icon */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-accent-readable/70" />
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wider truncate', blurClass)}>
                        {sale.product_name || 'Venda'}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0">
                        {formatTime(sale.sold_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('text-sm font-semibold text-accent-readable tabular-nums', blurClass)}>
                        +{formatCurrency(sale.amount)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
              Sem vendas no período
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Helper to parse date range from URL params
function parseDateRangeFromParams(searchParams: URLSearchParams): DateRange {
  const period = searchParams.get('period');
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const today = new Date();

  if (period === 'custom' && fromParam && toParam) {
    try {
      return {
        from: startOfDay(parseISO(fromParam)),
        to: endOfDay(parseISO(toParam)),
      };
    } catch {
      return getDefaultDateRange();
    }
  }

  switch (period) {
    case 'today':
      return { from: startOfDay(today), to: endOfDay(today) };
    case 'yesterday':
      return { from: startOfDay(subDays(today, 1)), to: endOfDay(subDays(today, 1)) };
    case 'last_7d':
      return { from: startOfDay(subDays(today, 6)), to: endOfDay(today) };
    case 'last_30d':
      return { from: startOfDay(subDays(today, 29)), to: endOfDay(today) };
    case 'this_month':
      return { from: startOfMonth(today), to: endOfDay(today) };
    case 'last_month':
      return { from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) };
    case 'all_time':
      // Dates are placeholders; the flag is what the request acts on.
      return { from: new Date(2015, 0, 1), to: endOfDay(today), allTime: true };
    default:
      return getDefaultDateRange();
  }
}

// Helper to serialize date range to URL params
function serializeDateRangeToParams(dateRange: DateRange): Record<string, string> {
  const preset = getPresetFromRange(dateRange);

  if (preset === 'custom') {
    return {
      period: 'custom',
      from: dateRange.from.toISOString().split('T')[0],
      to: dateRange.to.toISOString().split('T')[0],
    };
  }

  return { period: preset };
}

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeWorkspaceId, workspaces } = useWorkspaceContext();
  const chart = useChartColors();
  const { isHidden: isPrivacyHidden, toggle: togglePrivacy } = usePrivacyMode();

  const hasWorkspace = workspaces.length > 0 && !!activeWorkspaceId;

  // Initialize date range from URL or default
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    parseDateRangeFromParams(searchParams)
  );

  // Ad account filter
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);

  // Product filter — empty means "all products"
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  // Sync URL when date range changes
  useEffect(() => {
    const params = serializeDateRangeToParams(dateRange);
    setSearchParams(params, { replace: true });
  }, [dateRange, setSearchParams]);

  const {
    metrics,
    chartData,
    regions,
    lifetimeRevenue,
    recentSales,
    loading,
  } = useDashboardMetrics(
    dateRange,
    selectedConnectionIds.length > 0 ? selectedConnectionIds : undefined,
    selectedProducts.length > 0 ? selectedProducts : undefined,
  );

  const hasData = metrics.salesCount > 0;

  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        {/* Workspace Switcher */}
        <div className="flex items-center gap-3">
        </div>

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-foreground">Bem vindo, {user?.name?.split(' ')[0] || 'Usuário'}</h1>
              {!hasData && !loading && (
                <Badge variant="outline" className="text-muted-foreground border-foreground/10 text-xs">
                  <Database className="mr-1 h-3 w-3" />
                  Sem dados
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground/80 mt-1">Visão geral das suas campanhas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Revenue Progress Bar — total revenue based */}
            <RevenueProgressBar value={lifetimeRevenue} loading={loading} blurValues={isPrivacyHidden} />
            <AdAccountFilter
              selectedIds={selectedConnectionIds}
              onSelectionChange={setSelectedConnectionIds}
            />
            <ProductFilter
              selectedProducts={selectedProducts}
              onSelectionChange={setSelectedProducts}
            />
            <DateRangeFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={togglePrivacy}
              aria-label={isPrivacyHidden ? 'Mostrar dados' : 'Ocultar dados'}
              aria-pressed={isPrivacyHidden}
              title={isPrivacyHidden ? 'Mostrar dados' : 'Ocultar dados'}
              className="px-3"
            >
              {isPrivacyHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <SyncButton />
          </div>
        </div>

        {/* Empty state: no workspace */}
        {!hasWorkspace && !loading ? (
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Layers className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Crie sua primeira área</h2>
              <p className="text-sm text-muted-foreground/70 max-w-sm mb-5">
                Áreas permitem separar dados de produtos ou negócios diferentes. Use o botão acima para criar uma.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
        {/* Main area: metrics + chart on left, sales panel on right (full height) */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr_0.28fr]">
          {/* Left column: metrics grid + chart */}
          <div className="space-y-4">
            {/* Metrics Grid — 3x2 */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                title="Faturamento Bruto"
                value={formatCurrency(metrics.grossRevenue)}
                prefix="R$ "
                icon={<DollarSign className="h-4 w-4" />}
                loading={loading}
                blurValue={isPrivacyHidden}
              />
              <MetricCard
                title="Gasto com Ads"
                value={formatCurrency(metrics.adSpend + metrics.adSpendTax)}
                prefix="R$ "
                icon={<BarChart3 className="h-4 w-4" />}
                loading={loading}
                blurValue={isPrivacyHidden}
                subtitle={
                  metrics.adSpendTaxPercentage > 0
                    ? `Ads R$ ${formatCurrency(metrics.adSpend)} · Imposto ${metrics.adSpendTaxPercentage}% (R$ ${formatCurrency(metrics.adSpendTax)})`
                    : undefined
                }
              />
              <MetricCard
                title="Lucro"
                value={formatCurrency(metrics.netRevenue)}
                prefix="R$ "
                icon={<DollarSign className="h-4 w-4" />}
                loading={loading}
                blurValue={isPrivacyHidden}
                valueColor={metrics.netRevenue > 0 ? '#22c55e' : metrics.netRevenue < 0 ? '#ef4444' : undefined}
              />
              <MetricCard
                title="Vendas Aprovadas"
                value={metrics.salesCount.toString()}
                icon={<ShoppingCart className="h-4 w-4" />}
                loading={loading}
                blurValue={isPrivacyHidden}
              />
              <MetricCard
                title="ROAS"
                value={metrics.roas.toFixed(2)}
                suffix="x"
                icon={<Target className="h-4 w-4" />}
                loading={loading}
                blurValue={isPrivacyHidden}
                valueColor={metrics.roas > 1 ? '#22c55e' : metrics.roas > 0 && metrics.roas < 1 ? '#ef4444' : undefined}
              />
              <MetricCard
                title="CPA"
                value={formatCurrency(metrics.cpa)}
                prefix="R$ "
                icon={<DollarSign className="h-4 w-4" />}
                loading={loading}
                blurValue={isPrivacyHidden}
              />
            </div>

            {/* Chart + Globe row */}
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-[1fr_1fr_1fr]">
              {/* Line Chart — spans 2 columns */}
              <Card className={cn("lg:col-span-2", loading && "opacity-50")}>
                <CardHeader>
                  <CardTitle>Faturamento vs Gasto</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn('h-[300px]', isPrivacyHidden && 'blur-md select-none pointer-events-none', 'transition-[filter] duration-200 ease-out')}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chart.withAlpha('--foreground', 0.05)} />
                        <XAxis
                          dataKey="date"
                          stroke={chart.withAlpha('--foreground', 0.15)}
                          tick={{ fill: chart.muted, fontSize: 11 }}
                          tickLine={false}
                        />
                        <YAxis
                          stroke={chart.withAlpha('--foreground', 0.15)}
                          tick={{ fill: chart.muted, fontSize: 11 }}
                          tickFormatter={(value) => `R$${(value / 1000).toFixed(0)}k`}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: chart.background,
                            border: `1px solid ${chart.border}`,
                            borderRadius: '10px',
                          }}
                          labelStyle={{ color: chart.muted }}
                          formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']}
                        />
                        <Line
                          type="linear"
                          dataKey="revenue"
                          name="Faturamento"
                          stroke={chart.primary}
                          strokeWidth={1.5}
                          dot={{ r: 2, fill: chart.primary, strokeWidth: 0 }}
                          activeDot={{ r: 4, fill: chart.primary, strokeWidth: 0 }}
                        />
                        <Line
                          type="linear"
                          dataKey="spend"
                          name="Gasto"
                          stroke={chart.muted}
                          strokeWidth={1}
                          dot={{ r: 1.5, fill: chart.muted, strokeWidth: 0 }}
                          activeDot={{ r: 3, fill: chart.muted, strokeWidth: 0 }}
                          strokeDasharray="4 4"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Sales Globe — 1 column, same height as chart */}
              <SalesGlobe loading={loading} regions={regions} blurValues={isPrivacyHidden} />
            </div>
          </div>

          {/* Right column: Sales panel — spans full height, no overflow */}
          <div className="animate-sentinel-in-delay-1 min-h-0" style={{ overflow: 'hidden' }}>
            <RealtimeSalesPanel recentSales={recentSales} loading={loading} blurValues={isPrivacyHidden} />
          </div>
        </div>
          </>
        )}

      </div>
    </DashboardLayout>
  );
}
