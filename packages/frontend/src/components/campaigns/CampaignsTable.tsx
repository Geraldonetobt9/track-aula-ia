import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CampaignWithMetrics } from '@/hooks/useCampaigns';
import { TrendingUp, TrendingDown, Pencil, ChevronUp, ChevronDown, ChevronsUpDown, Copy, Play, Pause, DollarSign, Loader2 } from 'lucide-react';
import { BudgetEditModal } from './BudgetEditModal';
import { DuplicateModal } from './DuplicateModal';
import { StatusSelect } from './StatusSelect';
import { useCampaignStatusUpdate } from '@/hooks/useCampaignStatusUpdate';
import { useCampaignActions } from '@/hooks/useCampaignActions';
import { privacyBlurClass } from '@/lib/privacyBlur';

export interface MergedCampaignRow extends CampaignWithMetrics {
  meta_sales: number;
  meta_revenue: number;
  meta_roas: number;
  meta_cpa: number;
}

interface CampaignsTableProps {
  campaigns: MergedCampaignRow[];
  loading: boolean;
  search: string;
  statusFilter: string;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  itemsPerPage: number;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onBudgetUpdated?: (facebookId: string, budgetType: 'daily' | 'lifetime', amountCents: number) => void;
  onStatusUpdated?: (facebookId: string, newStatus: string) => void;
  attributionMode: 'lastclick' | 'meta';
  /** Blurs campaign name, budget and spend. */
  blurValues?: boolean;
}

interface BudgetEditState {
  open: boolean;
  facebookId: string;
  name: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
}

type SortDirection = 'asc' | 'desc';

function formatBudgetDisplay(dailyBudget: number | null, lifetimeBudget: number | null) {
  if (dailyBudget && dailyBudget > 0) return { value: `R$ ${dailyBudget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/dia`, hasBudget: true };
  if (lifetimeBudget && lifetimeBudget > 0) return { value: `R$ ${lifetimeBudget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} vitalicio`, hasBudget: true };
  return { value: '', hasBudget: false };
}

const COL_COUNT = 15; // 14 data + 1 checkbox

export function CampaignsTable({
  campaigns, loading, search, statusFilter, currentPage, setCurrentPage, itemsPerPage, selectedIds, onSelectedIdsChange, onBudgetUpdated, onStatusUpdated, attributionMode, blurValues,
}: CampaignsTableProps) {
  const blurClass = privacyBlurClass(blurValues);
  const [budgetEdit, setBudgetEdit] = useState<BudgetEditState>({ open: false, facebookId: '', name: '', dailyBudget: null, lifetimeBudget: null });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [bulkBudgetType, setBulkBudgetType] = useState<'daily' | 'lifetime'>('daily');
  const [bulkBudgetAmount, setBulkBudgetAmount] = useState('');
  const [showBulkBudget, setShowBulkBudget] = useState(false);

  const { updateStatus, updatingId } = useCampaignStatusUpdate({ onStatusUpdated });
  const { bulkDuplicate, bulkUpdateStatus, bulkUpdateBudget, loading: actionLoading } = useCampaignActions();

  const filteredCampaigns = campaigns.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sortedCampaigns = useMemo(() => {
    if (!sortColumn) return filteredCampaigns;
    return [...filteredCampaigns].sort((a, b) => {
      let va: any = (a as any)[sortColumn] ?? 0;
      let vb: any = (b as any)[sortColumn] ?? 0;
      if (sortColumn === 'lucro') {
        const getRevenue = (row: MergedCampaignRow) => attributionMode === 'lastclick' ? (row.revenue ?? 0) : (row.meta_revenue ?? 0);
        va = getRevenue(a) * 0.88 - (a.spend ?? 0);
        vb = getRevenue(b) * 0.88 - (b.spend ?? 0);
      }
      if (sortColumn === 'roas') {
        const getRevenue = (row: MergedCampaignRow) => attributionMode === 'lastclick' ? (row.revenue ?? 0) : (row.meta_revenue ?? 0);
        va = (a.spend ?? 0) > 0 ? getRevenue(a) / (a.spend ?? 0) : 0;
        vb = (b.spend ?? 0) > 0 ? getRevenue(b) / (b.spend ?? 0) : 0;
      }
      if (sortColumn === 'cpa') {
        const getSales = (row: MergedCampaignRow) => attributionMode === 'lastclick' ? (row.sales ?? 0) : (row.meta_sales ?? 0);
        va = getSales(a) > 0 ? (a.spend ?? 0) / getSales(a) : 0;
        vb = getSales(b) > 0 ? (b.spend ?? 0) / getSales(b) : 0;
      }
      if (typeof va === 'string') return sortDirection === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDirection === 'asc' ? va - vb : vb - va;
    });
  }, [filteredCampaigns, sortColumn, sortDirection, attributionMode]);

  const totalPages = Math.ceil(sortedCampaigns.length / itemsPerPage);
  const paginatedCampaigns = sortedCampaigns.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const fmt = (v: number) => `R$ ${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totals = useMemo(() => {
    const count = filteredCampaigns.length;
    if (count === 0) return null;
    const totalSpend = filteredCampaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
    const totalSales = filteredCampaigns.reduce((s, c) => s + (attributionMode === 'lastclick' ? (c.sales ?? 0) : (c.meta_sales ?? 0)), 0);
    const totalRevenue = filteredCampaigns.reduce((s, c) => s + (attributionMode === 'lastclick' ? (c.revenue ?? 0) : (c.meta_revenue ?? 0)), 0);
    const totalLucro = totalRevenue * 0.88 - totalSpend;
    const totalImpressions = filteredCampaigns.reduce((s, c) => s + (c.impressions ?? 0), 0);
    const totalClicks = filteredCampaigns.reduce((s, c) => s + (c.clicks ?? 0), 0);
    const totalInitiateCheckouts = filteredCampaigns.reduce((s, c) => s + (c.initiate_checkouts ?? 0), 0);
    return {
      count, totalSpend, totalSales, totalRevenue, totalLucro, totalImpressions, totalInitiateCheckouts,
      roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
      cpa: totalSales > 0 ? totalSpend / totalSales : 0,
      cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    };
  }, [filteredCampaigns, attributionMode]);

  const handleSort = (col: string) => {
    if (sortColumn === col) { if (sortDirection === 'desc') setSortDirection('asc'); else { setSortColumn(null); setSortDirection('desc'); } } else { setSortColumn(col); setSortDirection('desc'); }
  };
  const SortIcon = ({ col }: { col: string }) => { if (sortColumn !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />; return sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />; };
  const Th = ({ col, children, align = 'right', color }: { col: string; children: React.ReactNode; align?: 'left' | 'right'; color?: string }) => (
    <th className={cn('p-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:text-foreground/80 transition-colors', align === 'left' ? 'text-left' : 'text-right', color || 'text-muted-foreground/70')} onClick={() => handleSort(col)}>
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'justify-end')}>{children}<SortIcon col={col} /></span>
    </th>
  );

  // Selection
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds); if (next.has(id)) next.delete(id); else next.add(id); onSelectedIdsChange(next);
  };
  const allPageSelected = paginatedCampaigns.length > 0 && paginatedCampaigns.every((c) => selectedIds.has(c.facebook_campaign_id));
  const toggleSelectAll = () => {
    if (allPageSelected) {
      const next = new Set(selectedIds); paginatedCampaigns.forEach((c) => next.delete(c.facebook_campaign_id)); onSelectedIdsChange(next);
    } else {
      const next = new Set(selectedIds); paginatedCampaigns.forEach((c) => next.add(c.facebook_campaign_id)); onSelectedIdsChange(next);
    }
  };

  const selectedItems = campaigns.filter((c) => selectedIds.has(c.facebook_campaign_id)).map((c: any) => ({ facebookId: c.facebook_campaign_id, name: c.name, adAccountId: c.ad_account_id || '' }));

  const handleBulkDuplicate = (times: number) => {
    bulkDuplicate(selectedItems, 'campaign', times);
    onSelectedIdsChange(new Set());
    setShowDuplicateModal(false);
  };
  const handleBulkStatus = (status: 'ACTIVE' | 'PAUSED') => {
    bulkUpdateStatus(selectedItems, 'campaign', status, onStatusUpdated);
    onSelectedIdsChange(new Set());
  };
  const handleBulkBudget = () => {
    const cents = Math.round(parseFloat(bulkBudgetAmount) * 100);
    if (cents < 100) return;
    bulkUpdateBudget(selectedItems, 'campaign', bulkBudgetType, cents, onBudgetUpdated);
    onSelectedIdsChange(new Set());
    setShowBulkBudget(false);
    setBulkBudgetAmount('');
  };

  return (
    <>
      {/* Legend + Bulk Actions */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-muted-foreground/60">
            {attributionMode === 'lastclick' ? 'Vendas reais atribuidas via ad_id' : 'Conversoes reportadas pelo pixel da Meta'}
          </span>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/70">{selectedIds.size} selecionada(s)</span>

            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowDuplicateModal(true)} disabled={actionLoading}>
              <Copy className="h-3 w-3" /> Duplicar
            </Button>

            {/* Status */}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleBulkStatus('ACTIVE')} disabled={actionLoading}>
              <Play className="h-3 w-3" /> Ativar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleBulkStatus('PAUSED')} disabled={actionLoading}>
              <Pause className="h-3 w-3" /> Pausar
            </Button>

            {/* Budget */}
            {showBulkBudget ? (
              <div className="flex items-center gap-1">
                <Select value={bulkBudgetType} onValueChange={(v: any) => setBulkBudgetType(v)}>
                  <SelectTrigger className="h-7 w-[90px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Diario</SelectItem>
                    <SelectItem value="lifetime">Vitalicio</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-7 w-24 text-xs" placeholder="R$ 0,00" value={bulkBudgetAmount} onChange={(e) => setBulkBudgetAmount(e.target.value)} />
                <Button size="sm" className="h-7 text-xs" onClick={handleBulkBudget} disabled={actionLoading || !bulkBudgetAmount}>OK</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowBulkBudget(false)}>X</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowBulkBudget(true)} disabled={actionLoading}>
                <DollarSign className="h-3 w-3" /> Orcamento
              </Button>
            )}

            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground/50" onClick={() => onSelectedIdsChange(new Set())}>Limpar</Button>
          </div>
        )}
      </div>

      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-foreground/5">
              <th className="p-3 w-10">
                <Checkbox checked={allPageSelected} onCheckedChange={toggleSelectAll} className="h-3.5 w-3.5" />
              </th>
              <Th col="name" align="left">Campanha</Th>
              <Th col="status" align="left">Status</Th>
              <th className="p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                <TooltipProvider><Tooltip><TooltipTrigger>Orcamento</TooltipTrigger><TooltipContent>Clique no valor para editar</TooltipContent></Tooltip></TooltipProvider>
              </th>
              <Th col="spend">Gasto</Th>
              <Th col={attributionMode === 'lastclick' ? 'sales' : 'meta_sales'}>Vendas</Th>
              <Th col={attributionMode === 'lastclick' ? 'revenue' : 'meta_revenue'}>Faturamento</Th>
              <Th col="lucro">Lucro</Th>
              <Th col="roas">ROAS</Th>
              <th
                className="p-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:text-foreground/80 transition-colors text-right text-muted-foreground/70"
                onClick={() => handleSort('initiate_checkouts')}
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 justify-end">
                        Checkouts
                        <SortIcon col="initiate_checkouts" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Finalizacoes de compra iniciadas</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </th>
              <Th col="cpa">CPA</Th>
              <Th col="impressions">Impressoes</Th>
              <Th col="cpm">CPM</Th>
              <Th col="ctr">CTR</Th>
              <Th col="cpc">CPC</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-foreground/5">
                  {Array.from({ length: COL_COUNT }).map((_, j) => (
                    <td key={j} className="p-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  ))}
                </tr>
              ))
            ) : paginatedCampaigns.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="p-8 text-center text-muted-foreground">
                  {search || statusFilter !== 'all' ? 'Nenhuma campanha encontrada com os filtros aplicados.' : 'Nenhuma campanha teve movimentacoes no periodo selecionado. Tente alterar o filtro de data.'}
                </td>
              </tr>
            ) : (
              paginatedCampaigns.map((c) => {
                const budgetInfo = formatBudgetDisplay(c.daily_budget, c.lifetime_budget);
                const modeRevenue = attributionMode === 'lastclick' ? (c.revenue ?? 0) : (c.meta_revenue ?? 0);
                const lucro = modeRevenue * 0.88 - (c.spend ?? 0);
                const modeSales = attributionMode === 'lastclick' ? (c.sales ?? 0) : (c.meta_sales ?? 0);
                const roas = (c.spend ?? 0) > 0 ? modeRevenue / (c.spend ?? 0) : 0;
                const cpa = modeSales > 0 ? (c.spend ?? 0) / modeSales : 0;
                const isSelected = selectedIds.has(c.facebook_campaign_id);

                return (
                  <tr key={c.id} className={cn('border-b border-foreground/5 hover:bg-foreground/[0.03] transition-colors cursor-pointer', isSelected && 'bg-foreground/[0.05]')} onClick={() => toggleSelect(c.facebook_campaign_id)}>
                    <td className="p-3">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(c.facebook_campaign_id)} onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5" />
                    </td>
                    <td className="p-3"><span className={cn('font-medium inline-block max-w-full', blurClass)}>{c.name}</span></td>
                    <td className="p-3">
                      <StatusSelect status={c.status} facebookId={c.facebook_campaign_id} isUpdating={updatingId === c.facebook_campaign_id} onStatusChange={(s) => { if (c.facebook_campaign_id) updateStatus(c.facebook_campaign_id, s, 'campaign'); }} />
                    </td>
                    <td className="p-3">
                      {budgetInfo.hasBudget ? (
                        <TooltipProvider><Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-auto py-1 px-2 gap-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/5" onClick={(e) => { e.stopPropagation(); if (c.facebook_campaign_id) setBudgetEdit({ open: true, facebookId: c.facebook_campaign_id, name: c.name, dailyBudget: c.daily_budget, lifetimeBudget: c.lifetime_budget }); }} disabled={!c.facebook_campaign_id}>
                            <span className={cn('text-sm', blurClass)}>{budgetInfo.value}</span><Pencil className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger><TooltipContent>Clique para editar</TooltipContent></Tooltip></TooltipProvider>
                      ) : <span className="text-sm text-muted-foreground italic">A nivel de conjunto</span>}
                    </td>
                    <td className={cn('p-3 text-right whitespace-nowrap', blurClass)}>{fmt(c.spend)}</td>
                    <td className="p-3 text-right">
                      <span className={cn('font-medium', modeSales > 0 ? 'text-accent-readable' : 'text-muted-foreground')}>
                        {modeSales}
                      </span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <span className={modeRevenue > 0 ? 'text-accent-readable font-medium' : ''}>
                        {fmt(modeRevenue)}
                      </span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap"><span className={cn('font-medium', lucro >= 0 ? 'text-accent-readable' : 'text-destructive')}>{fmt(lucro)}</span></td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <span className="flex items-center justify-end gap-0.5">
                        {roas >= 1 ? <TrendingUp className="h-3 w-3 text-accent-readable" /> : <TrendingDown className="h-3 w-3 text-destructive" />}
                        <span className={cn('font-medium', roas >= 1 ? 'text-accent-readable' : 'text-destructive')}>{roas.toFixed(2)}x</span>
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <span className={cn((c.initiate_checkouts ?? 0) > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                        {(c.initiate_checkouts ?? 0).toLocaleString('pt-BR')}
                      </span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">{cpa > 0 ? fmt(cpa) : '-'}</td>
                    <td className="p-3 text-right whitespace-nowrap">{(c.impressions ?? 0).toLocaleString('pt-BR')}</td>
                    <td className="p-3 text-right whitespace-nowrap">{fmt(c.cpm)}</td>
                    <td className="p-3 text-right whitespace-nowrap">{(c.ctr ?? 0).toFixed(2)}%</td>
                    <td className="p-3 text-right whitespace-nowrap">{fmt(c.cpc)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && totals && (
            <tfoot className="sticky bottom-0 z-10 bg-card">
              <tr className="border-t border-foreground/10 bg-foreground/[0.03]">
                <td className="p-3" />
                <td className="p-3 font-semibold text-sm text-foreground">Total ({totals.count})</td>
                <td className="p-3" />
                <td className="p-3" />
                <td className={cn('p-3 text-right whitespace-nowrap font-semibold', blurClass)}>{fmt(totals.totalSpend)}</td>
                <td className="p-3 text-right font-semibold text-accent-readable">{totals.totalSales}</td>
                <td className="p-3 text-right whitespace-nowrap font-semibold text-accent-readable">{fmt(totals.totalRevenue)}</td>
                <td className="p-3 text-right whitespace-nowrap font-semibold"><span className={totals.totalLucro >= 0 ? 'text-accent-readable' : 'text-destructive'}>{fmt(totals.totalLucro)}</span></td>
                <td className="p-3 text-right whitespace-nowrap font-semibold"><span className={totals.roas >= 1 ? 'text-accent-readable' : 'text-destructive'}>{totals.roas.toFixed(2)}x</span></td>
                <td className="p-3 text-right font-semibold">{totals.totalInitiateCheckouts.toLocaleString('pt-BR')}</td>
                <td className="p-3 text-right whitespace-nowrap font-semibold">{totals.cpa > 0 ? fmt(totals.cpa) : '-'}</td>
                <td className="p-3 text-right whitespace-nowrap font-semibold">{totals.totalImpressions.toLocaleString('pt-BR')}</td>
                <td className="p-3 text-right whitespace-nowrap font-semibold">{fmt(totals.cpm)}</td>
                <td className="p-3 text-right whitespace-nowrap font-semibold">{totals.ctr.toFixed(2)}%</td>
                <td className="p-3 text-right whitespace-nowrap font-semibold">{fmt(totals.cpc)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!loading && sortedCampaigns.length > 0 && (
        <div className="flex items-center justify-between border-t border-foreground/5 p-4">
          <p className="text-sm text-muted-foreground">
            Mostrando {(currentPage - 1) * itemsPerPage + 1} a {Math.min(currentPage * itemsPerPage, sortedCampaigns.length)} de {sortedCampaigns.length} campanhas
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1}>Anterior</Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages}>Proximo</Button>
          </div>
        </div>
      )}

      <BudgetEditModal open={budgetEdit.open} onOpenChange={(open) => setBudgetEdit((p) => ({ ...p, open }))} type="campaign" facebookId={budgetEdit.facebookId} name={budgetEdit.name} currentDailyBudget={budgetEdit.dailyBudget} currentLifetimeBudget={budgetEdit.lifetimeBudget} onSuccess={(fbId, budgetType, amountCents) => onBudgetUpdated?.(fbId, budgetType, amountCents)} />
      <DuplicateModal open={showDuplicateModal} onOpenChange={setShowDuplicateModal} selectedCount={selectedIds.size} onConfirm={handleBulkDuplicate} loading={actionLoading} />
    </>
  );
}
