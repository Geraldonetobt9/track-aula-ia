import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Search, Database, Calendar, Clock, Unplug, Megaphone, LayoutGrid, Square, X, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFacebookConnection } from '@/hooks/useFacebookConnection';
import { useCampaigns, CampaignWithMetrics } from '@/hooks/useCampaigns';
import { useAdSets } from '@/hooks/useAdSets';
import { useAds } from '@/hooks/useAds';
import { useTopAds } from '@/hooks/useTopAds';
import { useCampaignsFunnel } from '@/hooks/useCampaignsFunnel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CampaignsTable, MergedCampaignRow } from '@/components/campaigns/CampaignsTable';
import { AdSetsTable, MergedAdSetRow } from '@/components/campaigns/AdSetsTable';
import { AdsTable, MergedAdRow } from '@/components/campaigns/AdsTable';
import { InsightsPanel } from '@/components/campaigns/InsightsPanel';
import { SyncButton } from '@/components/SyncButton';
import { AdAccountFilter } from '@/components/AdAccountFilter';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { Layers } from 'lucide-react';
import { usePrivacyMode } from '@/hooks/usePrivacyMode';

type PeriodOption = 'today' | 'yesterday' | '7d' | '30d' | 'custom';
type TabValue = 'campaigns' | 'adsets' | 'ads';
type AttributionMode = 'lastclick' | 'meta';

function toMergedCampaigns(list: CampaignWithMetrics[]): MergedCampaignRow[] {
  return list.map((c: any) => ({
    ...c,
    meta_sales: c.conversions ?? 0,
    meta_revenue: c.meta_revenue ?? 0,
    meta_roas: c.roas ?? 0,
    meta_cpa: c.cpa_real ?? 0,
  }));
}

function toMergedAdSets(list: any[]): MergedAdSetRow[] {
  return list.map((a) => ({
    ...a,
    meta_sales: a.conversions ?? 0,
    meta_revenue: a.meta_revenue ?? 0,
    meta_roas: a.roas ?? 0,
    meta_cpa: a.cpa_real ?? 0,
  }));
}

function toMergedAds(list: any[]): MergedAdRow[] {
  return list.map((a) => ({
    ...a,
    meta_sales: a.conversions ?? 0,
    meta_revenue: a.meta_revenue ?? 0,
    meta_roas: a.roas ?? 0,
    meta_cpa: a.cpa_real ?? 0,
  }));
}

export default function Campaigns() {
  const { activeWorkspaceId, workspaces } = useWorkspaceContext();
  const hasWorkspace = workspaces.length > 0 && !!activeWorkspaceId;
  const navigate = useNavigate();
  const { isConfigured: hasFacebookConnection, loading: fbLoading } = useFacebookConnection();
  const { isHidden: isPrivacyHidden, toggle: togglePrivacy } = usePrivacyMode();

  // Tab & selection state
  const [activeTab, setActiveTab] = useState<TabValue>('campaigns');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [selectedAdSetIds, setSelectedAdSetIds] = useState<Set<string>>(new Set());
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set());
  const [attributionMode, setAttributionMode] = useState<AttributionMode>('lastclick');

  // Filters
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaignsPage, setCampaignsPage] = useState(1);
  const [adSetsPage, setAdSetsPage] = useState(1);
  const [adsPage, setAdsPage] = useState(1);
  const [periodOption, setPeriodOption] = useState<PeriodOption>('today');
  const [customDateRange, setCustomDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState('');

  const itemsPerPage = 100;

  const prevDateRangeRef = useRef<{ start: Date; end: Date } | null>(null);

  const dateRange = useMemo(() => {
    const now = new Date();
    let next: { start: Date; end: Date } | null = null;
    switch (periodOption) {
      case 'today':
        next = { start: startOfDay(now), end: endOfDay(now) };
        break;
      case 'yesterday':
        next = { start: startOfDay(subDays(now, 1)), end: endOfDay(subDays(now, 1)) };
        break;
      case '7d':
        next = { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
        break;
      case '30d':
        next = { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
        break;
      case 'custom':
        if (customDateRange.from && customDateRange.to) {
          next = { start: startOfDay(customDateRange.from), end: endOfDay(customDateRange.to) };
        }
        break;
      default:
        next = { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
    }

    if (next) {
      prevDateRangeRef.current = next;
      return next;
    }

    // Custom sem datas selecionadas: manter o range anterior
    return prevDateRangeRef.current ?? { start: startOfDay(now), end: endOfDay(now) };
  }, [periodOption, customDateRange.from, customDateRange.to]);

  const connIds = selectedConnectionIds.length > 0 ? selectedConnectionIds : undefined;

  // Derive filter arrays from selections
  const campaignIdsFilter = useMemo(
    () => selectedCampaignIds.size > 0 ? Array.from(selectedCampaignIds) : undefined,
    [selectedCampaignIds],
  );

  const adSetIdsFilter = useMemo(
    () => selectedAdSetIds.size > 0 ? Array.from(selectedAdSetIds) : undefined,
    [selectedAdSetIds],
  );

  // For ads: filter by ad sets if selected, otherwise by campaigns
  const adsCampaignIdsFilter = useMemo(() => {
    if (selectedAdSetIds.size > 0) return undefined;
    if (selectedCampaignIds.size > 0) return Array.from(selectedCampaignIds);
    return undefined;
  }, [selectedAdSetIds, selectedCampaignIds]);

  // Data hooks — on-demand fetching controlled by active tab
  // Campaigns: always fetch
  const { campaigns, loading: campaignsLoading, patchBudget: patchCampaignBudget, patchStatus: patchCampaignStatus } = useCampaigns(dateRange, connIds);

  // Ad sets: only fetch when Conjuntos or Anuncios tab is active
  const { adSets, loading: adSetsLoading, patchBudget: patchAdSetBudget, patchStatus: patchAdSetStatus } = useAdSets(
    activeTab !== 'campaigns' ? dateRange : undefined,
    campaignIdsFilter,
    connIds,
  );

  // Ads: only fetch when Anuncios tab is active
  const { ads, loading: adsLoading } = useAds(
    activeTab === 'ads' ? dateRange : undefined,
    adSetIdsFilter,
    connIds,
    adsCampaignIdsFilter,
  );

  // Reset pagination when filters change
  useEffect(() => { setAdSetsPage(1); }, [selectedCampaignIds.size]);
  useEffect(() => { setAdsPage(1); }, [selectedAdSetIds.size, selectedCampaignIds.size]);

  // Clear downstream selections when upstream changes
  const handleClearCampaignSelection = useCallback(() => {
    setSelectedCampaignIds(new Set());
    setSelectedAdSetIds(new Set());
  }, []);

  const handleClearAdSetSelection = useCallback(() => {
    setSelectedAdSetIds(new Set());
  }, []);

  // Track last update time
  useEffect(() => {
    if (!campaignsLoading && campaigns.length > 0) {
      setLastUpdated(new Date());
    }
  }, [campaignsLoading, campaigns.length]);

  useEffect(() => {
    const formatRelative = () => {
      if (!lastUpdated) return '';
      const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      if (seconds < 10) return 'agora';
      if (seconds < 60) return `ha ${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `ha ${minutes}min`;
      const hours = Math.floor(minutes / 60);
      return `ha ${hours}h`;
    };
    setLastUpdatedText(formatRelative());
    const interval = setInterval(() => setLastUpdatedText(formatRelative()), 30000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  // Map flat responses to merged row format
  const mergedCampaigns = useMemo(() => toMergedCampaigns(campaigns), [campaigns]);
  const mergedAdSets = useMemo(() => toMergedAdSets(adSets), [adSets]);
  const mergedAds = useMemo(() => toMergedAds(ads), [ads]);

  // Top Ads & Funnel
  const { topAds, metaTopAds, loading: topAdsLoading } = useTopAds(dateRange);

  const allCampaignIds = useMemo(() => campaigns.map((c) => c.id), [campaigns]);
  const funnelData = useCampaignsFunnel(dateRange, allCampaignIds);

  const getPeriodLabel = () => {
    switch (periodOption) {
      case 'today': return 'Hoje';
      case 'yesterday': return 'Ontem';
      case '7d': return 'Ultimos 7 dias';
      case '30d': return 'Ultimos 30 dias';
      case 'custom':
        if (customDateRange.from && customDateRange.to) {
          return `${format(customDateRange.from, 'dd/MM/yyyy')} - ${format(customDateRange.to, 'dd/MM/yyyy')}`;
        }
        return 'Periodo personalizado';
      default: return 'Ultimos 30 dias';
    }
  };

  // Tab labels
  const campaignsTabLabel = 'Campanhas';
  const adSetsTabLabel = selectedCampaignIds.size > 0
    ? `Conjuntos para ${selectedCampaignIds.size} Campanha${selectedCampaignIds.size > 1 ? 's' : ''}`
    : 'Conjuntos';
  const adsTabLabel = selectedAdSetIds.size > 0
    ? `Anuncios para ${selectedAdSetIds.size} Conjunto${selectedAdSetIds.size > 1 ? 's' : ''}`
    : selectedCampaignIds.size > 0
      ? `Anuncios para ${selectedCampaignIds.size} Campanha${selectedCampaignIds.size > 1 ? 's' : ''}`
      : 'Anuncios';

  if (!hasWorkspace) {
    return (
      <DashboardLayout>
        <div className="space-y-6 animate-sentinel-in">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Campanhas</h1>
            <p className="text-sm text-muted-foreground/70 mt-1">Gerencie e analise suas campanhas</p>
          </div>
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Layers className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma area criada</h2>
              <p className="text-sm text-muted-foreground/70 max-w-sm">Crie uma area no Dashboard para comecar.</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  if (!fbLoading && !hasFacebookConnection) {
    return (
      <DashboardLayout>
        <div className="space-y-6 animate-sentinel-in">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Campanhas</h1>
            <p className="text-sm text-muted-foreground/70 mt-1">Gerencie e analise suas campanhas</p>
          </div>
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Unplug className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma conta do Facebook conectada</h2>
              <p className="text-sm text-muted-foreground/70 max-w-sm mb-5">
                Para visualizar suas campanhas, conecte sua conta do Facebook na pagina de integracoes.
              </p>
              <Button
                onClick={() => navigate('/integrations')}
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
              >
                Ir para Integracoes
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 animate-sentinel-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-foreground">Gerenciador de Campanhas</h1>
              {!campaignsLoading && mergedCampaigns.length === 0 && (
                <Badge variant="outline" className="text-muted-foreground/70 border-foreground/10 text-xs">
                  <Database className="mr-1 h-3 w-3" />
                  Sem dados
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground/70 mt-0.5">
              Gerencie suas campanhas
              <span className="mx-1.5 text-muted-foreground/30">|</span>
              <span className="text-muted-foreground/50">{getPeriodLabel()}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdatedText && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
                <Clock className="h-3 w-3" />
                Atualizado {lastUpdatedText}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={togglePrivacy}
              aria-label={isPrivacyHidden ? 'Mostrar nome, orçamento e gasto' : 'Ocultar nome, orçamento e gasto'}
              aria-pressed={isPrivacyHidden}
              title={isPrivacyHidden ? 'Mostrar nome, orçamento e gasto' : 'Ocultar nome, orçamento e gasto'}
              className="px-3"
            >
              {isPrivacyHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <SyncButton />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1 block">Buscar</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1 block">Periodo</label>
              <div className="flex gap-1.5">
                <Select value={periodOption} onValueChange={(value: PeriodOption) => setPeriodOption(value)}>
                  <SelectTrigger className="w-[160px] h-9">
                    <Calendar className="mr-2 h-3.5 w-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Hoje</SelectItem>
                    <SelectItem value="yesterday">Ontem</SelectItem>
                    <SelectItem value="7d">Ultimos 7 dias</SelectItem>
                    <SelectItem value="30d">Ultimos 30 dias</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>

                {periodOption === 'custom' && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="min-w-[180px] h-9 justify-start text-left font-normal text-xs">
                        <Calendar className="mr-2 h-3.5 w-3.5" />
                        {customDateRange.from && customDateRange.to ? (
                          <>{format(customDateRange.from, 'dd/MM/yyyy')} - {format(customDateRange.to, 'dd/MM/yyyy')}</>
                        ) : (
                          <span className="text-muted-foreground">Selecione</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        initialFocus
                        mode="range"
                        defaultMonth={customDateRange.from}
                        selected={{ from: customDateRange.from, to: customDateRange.to }}
                        onSelect={(range) => {
                          const hadCompleteRange = !!(customDateRange.from && customDateRange.to);
                          if (hadCompleteRange) {
                            const fromChanged = range?.from && range.from.getTime() !== customDateRange.from!.getTime();
                            const toChanged = range?.to && range.to.getTime() !== customDateRange.to!.getTime();
                            const clickedDate = fromChanged ? range?.from : toChanged ? range?.to : range?.from;
                            setCustomDateRange({ from: clickedDate, to: undefined });
                            return;
                          }
                          setCustomDateRange({ from: range?.from, to: range?.to });
                        }}
                        numberOfMonths={2}
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="paused">Pausados</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1 block">Conta</label>
              <AdAccountFilter
                selectedIds={selectedConnectionIds}
                onSelectionChange={setSelectedConnectionIds}
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          <TabsList className="w-full grid grid-cols-3 h-11">
            <TabsTrigger value="campaigns" className="gap-1.5 text-xs sm:text-sm">
              <Megaphone className="h-4 w-4" />
              <span className="hidden sm:inline">{campaignsTabLabel}</span>
              <span className="sm:hidden">Campanhas</span>
              {selectedCampaignIds.size > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] bg-primary/20 text-accent-readable border-0">
                  {selectedCampaignIds.size}
                  <button
                    className="ml-1 hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); handleClearCampaignSelection(); }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="adsets" className="gap-1.5 text-xs sm:text-sm">
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">{adSetsTabLabel}</span>
              <span className="sm:hidden">Conjuntos</span>
              {selectedAdSetIds.size > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] bg-primary/20 text-accent-readable border-0">
                  {selectedAdSetIds.size}
                  <button
                    className="ml-1 hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); handleClearAdSetSelection(); }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-1.5 text-xs sm:text-sm">
              <Square className="h-4 w-4" />
              <span className="hidden sm:inline">{adsTabLabel}</span>
              <span className="sm:hidden">Anuncios</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns">
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center gap-2 px-4 pt-3">
                  <Tabs value={attributionMode} onValueChange={(v) => setAttributionMode(v as AttributionMode)}>
                    <TabsList className="h-8 bg-foreground/[0.04] border border-foreground/10">
                      <TabsTrigger
                        value="lastclick"
                        className="text-xs px-3 h-7 gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-accent-readable data-[state=active]:shadow-none"
                      >
                        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                        Atribuicao Last Click
                      </TabsTrigger>
                      <TabsTrigger
                        value="meta"
                        className="text-xs px-3 h-7 gap-1.5 data-[state=active]:bg-info/10 data-[state=active]:text-info data-[state=active]:shadow-none"
                      >
                        <span className="inline-block h-2 w-2 rounded-full bg-info" />
                        Vendas na Meta
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <CampaignsTable
                  campaigns={mergedCampaigns}
                  loading={campaignsLoading}
                  search={debouncedSearch}
                  statusFilter={statusFilter}
                  currentPage={campaignsPage}
                  setCurrentPage={setCampaignsPage}
                  itemsPerPage={itemsPerPage}
                  selectedIds={selectedCampaignIds}
                  onSelectedIdsChange={setSelectedCampaignIds}
                  onBudgetUpdated={patchCampaignBudget}
                  onStatusUpdated={patchCampaignStatus}
                  attributionMode={attributionMode}
                  blurValues={isPrivacyHidden}
                />
              </CardContent>
            </Card>

            <div className="mt-6">
              <InsightsPanel
                topAds={topAds}
                metaTopAds={metaTopAds}
                topAdsLoading={topAdsLoading}
                funnelData={funnelData}
                attributionMode={attributionMode}
              />
            </div>
          </TabsContent>

          <TabsContent value="adsets">
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center gap-2 px-4 pt-3">
                  <Tabs value={attributionMode} onValueChange={(v) => setAttributionMode(v as AttributionMode)}>
                    <TabsList className="h-8 bg-foreground/[0.04] border border-foreground/10">
                      <TabsTrigger
                        value="lastclick"
                        className="text-xs px-3 h-7 gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-accent-readable data-[state=active]:shadow-none"
                      >
                        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                        Atribuicao Last Click
                      </TabsTrigger>
                      <TabsTrigger
                        value="meta"
                        className="text-xs px-3 h-7 gap-1.5 data-[state=active]:bg-info/10 data-[state=active]:text-info data-[state=active]:shadow-none"
                      >
                        <span className="inline-block h-2 w-2 rounded-full bg-info" />
                        Vendas na Meta
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <AdSetsTable
                  adSets={mergedAdSets}
                  loading={adSetsLoading}
                  search={debouncedSearch}
                  statusFilter={statusFilter}
                  currentPage={adSetsPage}
                  setCurrentPage={setAdSetsPage}
                  itemsPerPage={itemsPerPage}
                  selectedIds={selectedAdSetIds}
                  onSelectedIdsChange={setSelectedAdSetIds}
                  showCampaignColumn={selectedCampaignIds.size !== 1}
                  onBudgetUpdated={patchAdSetBudget}
                  onStatusUpdated={patchAdSetStatus}
                  attributionMode={attributionMode}
                  blurValues={isPrivacyHidden}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ads">
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center gap-2 px-4 pt-3">
                  <Tabs value={attributionMode} onValueChange={(v) => setAttributionMode(v as AttributionMode)}>
                    <TabsList className="h-8 bg-foreground/[0.04] border border-foreground/10">
                      <TabsTrigger
                        value="lastclick"
                        className="text-xs px-3 h-7 gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-accent-readable data-[state=active]:shadow-none"
                      >
                        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                        Atribuicao Last Click
                      </TabsTrigger>
                      <TabsTrigger
                        value="meta"
                        className="text-xs px-3 h-7 gap-1.5 data-[state=active]:bg-info/10 data-[state=active]:text-info data-[state=active]:shadow-none"
                      >
                        <span className="inline-block h-2 w-2 rounded-full bg-info" />
                        Vendas na Meta
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <AdsTable
                  ads={mergedAds}
                  loading={adsLoading}
                  search={debouncedSearch}
                  statusFilter={statusFilter}
                  currentPage={adsPage}
                  setCurrentPage={setAdsPage}
                  itemsPerPage={itemsPerPage}
                  selectedIds={selectedAdIds}
                  onSelectedIdsChange={setSelectedAdIds}
                  attributionMode={attributionMode}
                  blurValues={isPrivacyHidden}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
