import { useState, useMemo, useEffect } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Database, Upload } from 'lucide-react';
import { useSales, type SaleWithDetails, type SalesFilters as SalesFilterArgs } from '@/hooks/useSales';
import { useSalesSummary } from '@/hooks/useSalesSummary';
import { useSalesProducts } from '@/hooks/useSalesProducts';
import { useCampaigns } from '@/hooks/useCampaigns';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { SalesMetricsCards } from '@/components/sales/SalesMetricsCards';
import { SalesFilters, PeriodOption } from '@/components/sales/SalesFilters';
import { SaleDetailsDrawer } from '@/components/sales/SaleDetailsDrawer';
import { ProductSalesChart } from '@/components/sales/ProductSalesChart';
import { UtmContentChart } from '@/components/sales/UtmContentChart';
import { RefundAnalysisSection } from '@/components/sales/RefundAnalysisSection';
import { CHECKOUT_PLATFORMS, CheckoutPlatform } from '@/types/checkout';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { Layers } from 'lucide-react';
import { ImportSalesModal } from '@/components/sales/ImportSalesModal';

const PAGE_SIZE = 25;

export default function Sales() {
  const { activeWorkspaceId, workspaces } = useWorkspaceContext();
  const hasWorkspace = workspaces.length > 0 && !!activeWorkspaceId;
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [checkoutFilter, setCheckoutFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [periodOption, setPeriodOption] = useState<PeriodOption>('today');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const now = new Date();
    return { from: startOfDay(now), to: endOfDay(now) };
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSale, setSelectedSale] = useState<SaleWithDetails | null>(null);
  const [adSpend, setAdSpend] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  // Reset to page 1 whenever a filter that narrows the result set changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [
    debouncedSearch,
    checkoutFilter,
    statusFilter,
    campaignFilter,
    productFilter,
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
  ]);

  // Translate UI filter values into the shape consumed by the hooks.
  const sharedFilters = useMemo<Omit<SalesFilterArgs, 'page' | 'pageSize'>>(() => {
    const dr =
      dateRange && dateRange.from && dateRange.to
        ? { from: dateRange.from, to: dateRange.to }
        : undefined;
    return {
      dateRange: dr,
      statuses: statusFilter === 'all' ? undefined : [statusFilter],
      checkoutIds: checkoutFilter === 'all' || checkoutFilter === 'manual' ? undefined : [checkoutFilter],
      productNames: productFilter === 'all' ? undefined : [productFilter],
      campaignIds:
        campaignFilter === 'all' || campaignFilter === 'organic' ? undefined : [campaignFilter],
      q: debouncedSearch || undefined,
    };
  }, [dateRange, statusFilter, checkoutFilter, productFilter, campaignFilter, debouncedSearch]);

  const { sales, total, loading, refetch, fetchAdSpend } = useSales({
    ...sharedFilters,
    page: currentPage,
    pageSize: PAGE_SIZE,
  });

  const { summary, loading: summaryLoading } = useSalesSummary(sharedFilters);
  const { products: productsList } = useSalesProducts();
  const { campaigns } = useCampaigns();

  // Fetch ad spend when date range changes (for net revenue calc on cards).
  useEffect(() => {
    const loadAdSpend = async () => {
      const fromDate = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : undefined;
      const toDate = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : undefined;
      const spend = await fetchAdSpend(fromDate, toDate);
      setAdSpend(spend);
    };
    loadAdSpend();
  }, [dateRange, fetchAdSpend]);

  // Adapt server-side summary metrics into the shape SalesMetricsCards expects.
  const cardMetrics = useMemo(
    () => ({
      totalSales: summary.metrics.approved_count,
      grossRevenue: summary.metrics.gross_revenue,
      netRevenue: summary.metrics.gross_revenue - adSpend,
      averageTicket: summary.metrics.avg_ticket,
      refundRate: summary.metrics.refund_rate,
      approvedCount: summary.metrics.approved_count,
      pendingCount: 0,
      refundedCount: summary.metrics.refunds_count,
      adSpend,
    }),
    [summary.metrics, adSpend],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(currentPage * PAGE_SIZE, total);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: ptBR });
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-primary text-primary-foreground">Aprovada</Badge>;
      case 'pending':
        return <Badge className="bg-foreground/15 text-muted-foreground/80">Pendente</Badge>;
      case 'refunded':
        return <Badge className="bg-foreground/10">Reembolsada</Badge>;
      default:
        return <Badge variant="secondary">{status || 'N/A'}</Badge>;
    }
  };

  const getPlatformBadge = (platform: string | null) => {
    if (!platform || platform === 'Manual') {
      return <Badge variant="secondary">Manual</Badge>;
    }
    const config = CHECKOUT_PLATFORMS[platform.toLowerCase() as CheckoutPlatform];
    if (!config) return <Badge variant="secondary">{platform}</Badge>;
    return (
      <Badge className={config.color + ' text-foreground'}>
        {config.name}
      </Badge>
    );
  };

  const getTypeBadge = (type: 'paid' | 'organic') => {
    switch (type) {
      case 'paid':
        return <Badge variant="outline" className="border-foreground/20 text-muted-foreground/70">Paga</Badge>;
      case 'organic':
        return <Badge variant="outline" className="border-success text-accent-readable">Orgânica</Badge>;
    }
  };

  const campaignsList = campaigns.map((c) => ({ id: c.id, name: c.name }));

  if (!hasWorkspace) {
    return (
      <DashboardLayout>
        <div className="space-y-6 animate-sentinel-in">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Vendas</h1>
            <p className="text-sm text-muted-foreground/70 mt-1">Acompanhe todas as suas vendas e atribuições</p>
          </div>
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Layers className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma área criada</h2>
              <p className="text-sm text-muted-foreground/70 max-w-sm">Crie uma área no Dashboard para começar.</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const isEmpty = !loading && sales.length === 0;
  const hasActiveFilter =
    !!debouncedSearch ||
    checkoutFilter !== 'all' ||
    statusFilter !== 'all' ||
    campaignFilter !== 'all' ||
    productFilter !== 'all' ||
    !!dateRange;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-foreground">Vendas</h1>
              {!loading && total === 0 && !hasActiveFilter && (
                <Badge variant="outline" className="text-muted-foreground/70 border-foreground/10 text-xs">
                  <Database className="mr-1 h-3 w-3" />
                  Sem dados
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground/70 mt-1">Acompanhe todas as suas vendas e atribuições</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Importar Vendas
            </Button>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Metrics Cards (server-side aggregated) */}
        <SalesMetricsCards metrics={cardMetrics} loading={summaryLoading} />

        {/* Filters */}
        <SalesFilters
          search={search}
          onSearchChange={setSearch}
          checkoutFilter={checkoutFilter}
          onCheckoutFilterChange={setCheckoutFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          campaignFilter={campaignFilter}
          onCampaignFilterChange={setCampaignFilter}
          campaigns={campaignsList}
          productFilter={productFilter}
          onProductFilterChange={setProductFilter}
          products={productsList}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          periodOption={periodOption}
          onPeriodOptionChange={setPeriodOption}
        />

        {/* Charts (server-side aggregated) */}
        <ProductSalesChart data={summary.by_product} loading={summaryLoading} />
        <UtmContentChart data={summary.by_ad} loading={summaryLoading} />
        <RefundAnalysisSection
          metrics={summary.metrics}
          refundsByState={summary.refunds_by_state}
          refundedSample={summary.refunded_sample}
          loading={summaryLoading}
        />

        {/* Sales Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-foreground/5">
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Data</th>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Produto</th>
                    <th className="p-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Email</th>
                    <th className="p-4 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Valor</th>
                    <th className="p-4 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Status</th>
                    <th className="p-4 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Atribuição</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-foreground/5">
                        <td className="p-4"><Skeleton className="h-4 w-32" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-40" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-36" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-24 ml-auto" /></td>
                        <td className="p-4"><Skeleton className="h-6 w-20 mx-auto" /></td>
                        <td className="p-4"><Skeleton className="h-6 w-24 mx-auto" /></td>
                      </tr>
                    ))
                  ) : isEmpty ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground/70">
                        {hasActiveFilter
                          ? 'Nenhuma venda encontrada com os filtros aplicados.'
                          : 'Nenhuma venda registrada. Configure suas integrações de checkout para receber vendas automaticamente.'}
                      </td>
                    </tr>
                  ) : (
                    sales.map((sale) => (
                      <tr
                        key={sale.id}
                        className="border-b border-foreground/5 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                        onClick={() => setSelectedSale(sale)}
                      >
                        <td className="p-4 text-sm">{formatDate(sale.sold_at)}</td>
                        <td className="p-4 text-sm font-medium max-w-[150px] truncate">{sale.product_name || 'Produto'}</td>
                        <td className="p-4 text-sm text-muted-foreground/60 max-w-[180px] truncate" title={sale.customer_email || ''}>{sale.customer_email || '-'}</td>
                        <td className="p-4 text-right text-sm font-medium text-accent-readable">R$ {formatCurrency(sale.amount)}</td>
                        <td className="p-4 text-center">{getStatusBadge(sale.status)}</td>
                        <td className="p-4 text-center">{getTypeBadge(sale.type)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination (server-side) */}
            {!loading && total > 0 && (
              <div className="flex items-center justify-between border-t border-foreground/5 p-4">
                <p className="text-sm text-muted-foreground/70">
                  Mostrando {showingFrom} a {showingTo} de {total} vendas
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    Próximo
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sale Details Drawer */}
        <SaleDetailsDrawer
          sale={selectedSale}
          open={!!selectedSale}
          onOpenChange={(open) => !open && setSelectedSale(null)}
        />

        <ImportSalesModal
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => refetch()}
        />
      </div>
    </DashboardLayout>
  );
}
