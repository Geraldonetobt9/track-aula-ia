import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AdWithMetrics } from '@/hooks/useAds';
import { TrendingUp, TrendingDown, ChevronUp, ChevronDown, ChevronsUpDown, Copy, Play, Pause, Loader2 } from 'lucide-react';
import { StatusSelect } from './StatusSelect';
import { DuplicateModal } from './DuplicateModal';
import { useCampaignStatusUpdate } from '@/hooks/useCampaignStatusUpdate';
import { useCampaignActions } from '@/hooks/useCampaignActions';
import { privacyBlurClass } from '@/lib/privacyBlur';

export interface MergedAdRow extends AdWithMetrics {
  meta_sales: number;
  meta_revenue: number;
  meta_roas: number;
  meta_cpa: number;
}

interface AdsTableProps {
  ads: MergedAdRow[];
  loading: boolean;
  search: string;
  statusFilter: string;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  itemsPerPage: number;
  onStatusUpdated?: () => void;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  attributionMode: 'lastclick' | 'meta';
  /** Blurs ad name and spend. */
  blurValues?: boolean;
}

type SortDirection = 'asc' | 'desc';
const COL_COUNT = 14;

export function AdsTable({ ads, loading, search, statusFilter, currentPage, setCurrentPage, itemsPerPage, onStatusUpdated, selectedIds, onSelectedIdsChange, attributionMode, blurValues }: AdsTableProps) {
  const blurClass = privacyBlurClass(blurValues);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  const { updateStatus, updatingId } = useCampaignStatusUpdate({ onStatusUpdated });
  const { bulkDuplicate, bulkUpdateStatus, loading: actionLoading } = useCampaignActions();

  const filtered = ads.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()) && (statusFilter === 'all' || a.status === statusFilter));
  const sorted = useMemo(() => {
    if (!sortColumn) return filtered;
    return [...filtered].sort((a, b) => {
      let va: any = (a as any)[sortColumn] ?? 0; let vb: any = (b as any)[sortColumn] ?? 0;
      if (sortColumn === 'lucro') {
        const getRevenue = (row: MergedAdRow) => attributionMode === 'lastclick' ? (row.revenue ?? 0) : (row.meta_revenue ?? 0);
        va = getRevenue(a) * 0.88 - (a.spend ?? 0);
        vb = getRevenue(b) * 0.88 - (b.spend ?? 0);
      }
      if (sortColumn === 'roas') {
        const getRevenue = (row: MergedAdRow) => attributionMode === 'lastclick' ? (row.revenue ?? 0) : (row.meta_revenue ?? 0);
        va = (a.spend ?? 0) > 0 ? getRevenue(a) / (a.spend ?? 0) : 0;
        vb = (b.spend ?? 0) > 0 ? getRevenue(b) / (b.spend ?? 0) : 0;
      }
      if (sortColumn === 'cpa') {
        const getSales = (row: MergedAdRow) => attributionMode === 'lastclick' ? (row.sales ?? 0) : (row.meta_sales ?? 0);
        va = getSales(a) > 0 ? (a.spend ?? 0) / getSales(a) : 0;
        vb = getSales(b) > 0 ? (b.spend ?? 0) / getSales(b) : 0;
      }
      if (typeof va === 'string') return sortDirection === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDirection === 'asc' ? va - vb : vb - va;
    });
  }, [filtered, sortColumn, sortDirection, attributionMode]);

  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const paginated = sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const fmt = (v: number) => `R$ ${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const handleSort = (col: string) => { if (sortColumn === col) { if (sortDirection === 'desc') setSortDirection('asc'); else { setSortColumn(null); setSortDirection('desc'); } } else { setSortColumn(col); setSortDirection('desc'); } };
  const SortIcon = ({ col }: { col: string }) => { if (sortColumn !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />; return sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />; };
  const Th = ({ col, children, align = 'right', color }: { col: string; children: React.ReactNode; align?: 'left' | 'right'; color?: string }) => (
    <th className={cn('p-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:text-foreground/80 transition-colors', align === 'left' ? 'text-left' : 'text-right', color || 'text-muted-foreground/70')} onClick={() => handleSort(col)}>
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'justify-end')}>{children}<SortIcon col={col} /></span>
    </th>
  );

  const toggleSelect = (id: string) => { const n = new Set(selectedIds); if (n.has(id)) n.delete(id); else n.add(id); onSelectedIdsChange(n); };
  const allPageSelected = paginated.length > 0 && paginated.every((a) => selectedIds.has(a.facebook_ad_id));
  const toggleSelectAll = () => { if (allPageSelected) { const n = new Set(selectedIds); paginated.forEach((a) => n.delete(a.facebook_ad_id)); onSelectedIdsChange(n); } else { const n = new Set(selectedIds); paginated.forEach((a) => n.add(a.facebook_ad_id)); onSelectedIdsChange(n); } };
  const selectedItems = ads.filter((a) => selectedIds.has(a.facebook_ad_id)).map((a: any) => ({ facebookId: a.facebook_ad_id, name: a.name, adAccountId: a.ad_account_id || '' }));

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-muted-foreground/60">
            {attributionMode === 'lastclick' ? 'Vendas reais atribuidas via ad_id' : 'Conversoes reportadas pelo pixel da Meta'}
          </span>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/70">{selectedIds.size} selecionado(s)</span>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowDuplicateModal(true)} disabled={actionLoading}><Copy className="h-3 w-3" /> Duplicar</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { bulkUpdateStatus(selectedItems, 'ad', 'ACTIVE'); onSelectedIdsChange(new Set()); }} disabled={actionLoading}><Play className="h-3 w-3" /> Ativar</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { bulkUpdateStatus(selectedItems, 'ad', 'PAUSED'); onSelectedIdsChange(new Set()); }} disabled={actionLoading}><Pause className="h-3 w-3" /> Pausar</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground/50" onClick={() => onSelectedIdsChange(new Set())}>Limpar</Button>
          </div>
        )}
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-foreground/5">
              <th className="p-3 w-10"><Checkbox checked={allPageSelected} onCheckedChange={toggleSelectAll} className="h-3.5 w-3.5" /></th>
              <Th col="name" align="left">Anuncio</Th>
              <Th col="status" align="left">Status</Th>
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
            {loading ? Array.from({ length: 5 }).map((_, i) => (<tr key={i} className="border-b border-foreground/5">{Array.from({ length: COL_COUNT }).map((_, j) => (<td key={j} className="p-3"><Skeleton className="h-4 w-16 ml-auto" /></td>))}</tr>))
            : paginated.length === 0 ? (<tr><td colSpan={COL_COUNT} className="p-8 text-center text-muted-foreground">Nenhum anuncio teve movimentacoes no periodo selecionado.</td></tr>)
            : paginated.map((ad) => {
              const modeRevenue = attributionMode === 'lastclick' ? (ad.revenue ?? 0) : (ad.meta_revenue ?? 0);
              const modeSales = attributionMode === 'lastclick' ? (ad.sales ?? 0) : (ad.meta_sales ?? 0);
              const lucro = modeRevenue * 0.88 - (ad.spend ?? 0);
              const roas = (ad.spend ?? 0) > 0 ? modeRevenue / (ad.spend ?? 0) : 0;
              const cpa = modeSales > 0 ? (ad.spend ?? 0) / modeSales : 0;
              const isSelected = selectedIds.has(ad.facebook_ad_id);
              return (
                <tr key={ad.id} className={cn('border-b border-foreground/5 hover:bg-foreground/[0.03] transition-colors cursor-pointer', isSelected && 'bg-foreground/[0.05]')} onClick={() => toggleSelect(ad.facebook_ad_id)}>
                  <td className="p-3"><Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(ad.facebook_ad_id)} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="h-3.5 w-3.5" /></td>
                  <td className="p-3"><span className={cn("font-medium inline-block max-w-full", blurClass)}>{ad.name}</span></td>
                  <td className="p-3"><StatusSelect status={ad.status} facebookId={ad.facebook_ad_id} isUpdating={updatingId === ad.facebook_ad_id} onStatusChange={(s) => { if (ad.facebook_ad_id) updateStatus(ad.facebook_ad_id, s, 'ad'); }} /></td>
                  <td className={cn("p-3 text-right whitespace-nowrap", blurClass)}>{fmt(ad.spend)}</td>
                  <td className="p-3 text-right">
                    <span className={cn('font-medium', (attributionMode === 'lastclick' ? ad.sales : ad.meta_sales) > 0 ? 'text-accent-readable' : 'text-muted-foreground')}>
                      {attributionMode === 'lastclick' ? ad.sales : ad.meta_sales}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <span className={(attributionMode === 'lastclick' ? ad.revenue : ad.meta_revenue) > 0 ? 'text-accent-readable font-medium' : ''}>
                      {fmt(attributionMode === 'lastclick' ? ad.revenue : ad.meta_revenue)}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap"><span className={cn('font-medium', lucro >= 0 ? 'text-accent-readable' : 'text-destructive')}>{fmt(lucro)}</span></td>
                  <td className="p-3 text-right whitespace-nowrap"><span className="flex items-center justify-end gap-0.5">{roas >= 1 ? <TrendingUp className="h-3 w-3 text-accent-readable" /> : <TrendingDown className="h-3 w-3 text-destructive" />}<span className={cn('font-medium', roas >= 1 ? 'text-accent-readable' : 'text-destructive')}>{roas.toFixed(2)}x</span></span></td>
                  <td className="p-3 text-right">
                    <span className={cn((ad.initiate_checkouts ?? 0) > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                      {(ad.initiate_checkouts ?? 0).toLocaleString('pt-BR')}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">{cpa > 0 ? fmt(cpa) : '-'}</td>
                  <td className="p-3 text-right whitespace-nowrap">{(ad.impressions ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="p-3 text-right whitespace-nowrap">{fmt(ad.cpm)}</td>
                  <td className="p-3 text-right whitespace-nowrap">{(ad.ctr ?? 0).toFixed(2)}%</td>
                  <td className="p-3 text-right whitespace-nowrap">{fmt(ad.cpc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && sorted.length > 0 && (
        <div className="flex items-center justify-between border-t border-foreground/5 p-4">
          <p className="text-sm text-muted-foreground">Mostrando {(currentPage - 1) * itemsPerPage + 1} a {Math.min(currentPage * itemsPerPage, sorted.length)} de {sorted.length} anuncios</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1}>Anterior</Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages}>Proximo</Button>
          </div>
        </div>
      )}
      <DuplicateModal open={showDuplicateModal} onOpenChange={setShowDuplicateModal} selectedCount={selectedIds.size} onConfirm={(times) => { bulkDuplicate(selectedItems, 'ad', times); onSelectedIdsChange(new Set()); setShowDuplicateModal(false); }} loading={actionLoading} />
    </>
  );
}
