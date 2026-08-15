# Attribution Tabs - Campaigns Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the two-tab attribution layout (Last Click vs Meta) in the campaigns/adsets/ads tables, replacing the current merged dual-column layout.

**Architecture:** Add an `attributionMode` state (`'lastclick' | 'meta'`) to `Campaigns.tsx` with a `TabsList` toggle above each table. Each table component receives a single `mode` prop that determines which data fields to show. The data fetching stays exactly as-is (both LC and Meta data are always present in `MergedCampaignRow`); only the **displayed columns** change based on the selected tab.

**Tech Stack:** React, shadcn/ui Tabs, TypeScript, existing `MergedCampaignRow`/`MergedAdSetRow`/`MergedAdRow` interfaces (unchanged).

---

## Current State vs Target State

**Current:** Tables show 16 columns including `Vendas LC`, `Vendas Meta`, `Fat. LC`, `Fat. Meta` side-by-side with color coding. A legend shows colored dots.

**Target:** A toggle (two small tabs) above the table lets user switch between "Atribuicao Last Click" and "Vendas na Meta". Each mode shows:
- `Vendas` — shows `sales` (LC mode) or `meta_sales` (Meta mode)
- `Faturamento` — shows `revenue` (LC mode) or `meta_revenue` (Meta mode)
- `Lucro` — calculated from `revenue` (LC) or `meta_revenue` (Meta) minus spend
- `ROAS` — calculated from `revenue/spend` (LC) or `meta_revenue/spend` (Meta)
- `CPA` — calculated from `spend/sales` (LC) or `spend/meta_sales` (Meta)

All other columns (Name, Status, Budget, Spend, Impressions, CPM, CTR, CPC) are identical in both modes.

The footer totals also switch to show the correct aggregates per mode.

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/frontend/src/pages/Campaigns.tsx` | Modify | Add `attributionMode` state + toggle UI, pass `mode` to tables and InsightsPanel |
| `packages/frontend/src/components/campaigns/CampaignsTable.tsx` | Modify | Accept `mode` prop, show single Vendas/Fat columns based on mode, adapt footer |
| `packages/frontend/src/components/campaigns/AdSetsTable.tsx` | Modify | Accept `mode` prop, show single Vendas/Fat columns based on mode |
| `packages/frontend/src/components/campaigns/AdsTable.tsx` | Modify | Accept `mode` prop, show single Vendas/Fat columns based on mode |
| `packages/frontend/src/components/campaigns/InsightsPanel.tsx` | Modify | Accept `mode` prop, pass correct topAds data to TopAdsChart |

---

### Task 1: Add `attributionMode` state and toggle to `Campaigns.tsx`

**Files:**
- Modify: `packages/frontend/src/pages/Campaigns.tsx`

- [ ] **Step 1: Add the `AttributionMode` type and state**

At the top of `Campaigns.tsx`, after the existing type declarations (line 33):

```tsx
type AttributionMode = 'lastclick' | 'meta';
```

Inside the `Campaigns` component, after line 75 (`selectedAdIds` state):

```tsx
const [attributionMode, setAttributionMode] = useState<AttributionMode>('lastclick');
```

- [ ] **Step 2: Add the attribution toggle UI above the TabsContent for campaigns**

Replace the current `<TabsContent value="campaigns">` block (lines 454-479) with:

```tsx
<TabsContent value="campaigns">
  <Card>
    <CardContent className="p-0">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Tabs value={attributionMode} onValueChange={(v) => setAttributionMode(v as AttributionMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="lastclick" className="text-xs px-3 h-7">
              Atribuicao Last Click
            </TabsTrigger>
            <TabsTrigger value="meta" className="text-xs px-3 h-7">
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
      />
    </CardContent>
  </Card>

  <InsightsPanel
    topAds={topAds}
    metaTopAds={metaTopAds}
    topAdsLoading={topAdsLoading}
    funnelData={funnelData}
    attributionMode={attributionMode}
  />
</TabsContent>
```

- [ ] **Step 3: Update the AdSets and Ads TabsContent similarly**

Replace `<TabsContent value="adsets">` (lines 481-499):

```tsx
<TabsContent value="adsets">
  <Card>
    <CardContent className="p-0">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Tabs value={attributionMode} onValueChange={(v) => setAttributionMode(v as AttributionMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="lastclick" className="text-xs px-3 h-7">
              Atribuicao Last Click
            </TabsTrigger>
            <TabsTrigger value="meta" className="text-xs px-3 h-7">
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
      />
    </CardContent>
  </Card>
</TabsContent>
```

Replace `<TabsContent value="ads">` (lines 502-518):

```tsx
<TabsContent value="ads">
  <Card>
    <CardContent className="p-0">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Tabs value={attributionMode} onValueChange={(v) => setAttributionMode(v as AttributionMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="lastclick" className="text-xs px-3 h-7">
              Atribuicao Last Click
            </TabsTrigger>
            <TabsTrigger value="meta" className="text-xs px-3 h-7">
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
      />
    </CardContent>
  </Card>
</TabsContent>
```

- [ ] **Step 4: Verify it compiles (will have TS errors for missing props — expected)**

Run: `cd packages/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: errors about `attributionMode` not existing on table props (fixed in Tasks 2-5)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/Campaigns.tsx
git commit -m "feat: add attributionMode state and toggle UI to campaigns page"
```

---

### Task 2: Update `CampaignsTable` to use attribution mode

**Files:**
- Modify: `packages/frontend/src/components/campaigns/CampaignsTable.tsx`

- [ ] **Step 1: Add `attributionMode` to the props interface**

Add to `CampaignsTableProps` (after line 35):

```tsx
attributionMode: 'lastclick' | 'meta';
```

Update the destructured props in the function signature (line 57) to include `attributionMode`:

```tsx
export function CampaignsTable({
  campaigns, loading, search, statusFilter, currentPage, setCurrentPage, itemsPerPage, selectedIds, onSelectedIdsChange, onBudgetUpdated, onStatusUpdated, attributionMode,
}: CampaignsTableProps) {
```

- [ ] **Step 2: Update COL_COUNT and add helper variables**

Replace `const COL_COUNT = 16;` (line 54) with:

```tsx
const COL_COUNT = 14; // checkbox + name + status + budget + spend + vendas + fat + lucro + roas + cpa + impressoes + cpm + ctr + cpc
```

- [ ] **Step 3: Replace the legend with an attribution mode indicator**

Replace the legend div (lines 158-162):

```tsx
{/* Current mode indicator */}
<div className="flex items-center gap-4">
  <span className="text-[10px] text-[#a1a4a5]/60">
    {attributionMode === 'lastclick' ? 'Vendas reais atribuidas via ad_id' : 'Conversoes reportadas pelo pixel da Meta'}
  </span>
</div>
```

- [ ] **Step 4: Replace the dual columns with single mode-aware columns in thead**

Replace the header columns `Vendas LC`, `Vendas Meta`, `Fat. LC`, `Fat. Meta` (lines 218-221) with:

```tsx
<Th col={attributionMode === 'lastclick' ? 'sales' : 'meta_sales'}>Vendas</Th>
<Th col={attributionMode === 'lastclick' ? 'revenue' : 'meta_revenue'}>Faturamento</Th>
```

- [ ] **Step 5: Update the row cells to show mode-aware values**

Replace the four cells for Vendas LC, Vendas Meta, Fat. LC, Fat. Meta (lines 272-275) with:

```tsx
<td className="p-3 text-right">
  <span className={cn('font-medium', (attributionMode === 'lastclick' ? c.sales : c.meta_sales) > 0 ? 'text-[#d1fe17]' : 'text-muted-foreground')}>
    {attributionMode === 'lastclick' ? c.sales : c.meta_sales}
  </span>
</td>
<td className="p-3 text-right whitespace-nowrap">
  <span className={(attributionMode === 'lastclick' ? c.revenue : c.meta_revenue) > 0 ? 'text-[#d1fe17] font-medium' : ''}>
    {fmt(attributionMode === 'lastclick' ? c.revenue : c.meta_revenue)}
  </span>
</td>
```

- [ ] **Step 6: Update Lucro, ROAS, CPA cells to be mode-aware**

Replace the Lucro cell (line 276):

```tsx
<td className="p-3 text-right whitespace-nowrap">
  <span className={cn('font-medium', lucro >= 0 ? 'text-[#d1fe17]' : 'text-red-500')}>{fmt(lucro)}</span>
</td>
```

The `lucro` variable (line 249) needs to be updated:

```tsx
const modeRevenue = attributionMode === 'lastclick' ? (c.revenue ?? 0) : (c.meta_revenue ?? 0);
const lucro = modeRevenue * 0.88 - (c.spend ?? 0);
const modeSales = attributionMode === 'lastclick' ? (c.sales ?? 0) : (c.meta_sales ?? 0);
const roas = (c.spend ?? 0) > 0 ? modeRevenue / (c.spend ?? 0) : 0;
const cpa = modeSales > 0 ? (c.spend ?? 0) / modeSales : 0;
```

Replace the ROAS cell (lines 277-281):

```tsx
<td className="p-3 text-right whitespace-nowrap">
  <span className="flex items-center justify-end gap-0.5">
    {roas >= 1 ? <TrendingUp className="h-3 w-3 text-[#d1fe17]" /> : <TrendingDown className="h-3 w-3 text-red-500" />}
    <span className={cn('font-medium', roas >= 1 ? 'text-[#d1fe17]' : 'text-red-500')}>{roas.toFixed(2)}x</span>
  </span>
</td>
```

Replace the CPA cell (line 283):

```tsx
<td className="p-3 text-right whitespace-nowrap">{cpa > 0 ? fmt(cpa) : '-'}</td>
```

- [ ] **Step 7: Update the footer totals to be mode-aware**

Replace the totals `useMemo` (lines 91-110) with:

```tsx
const totals = useMemo(() => {
  const count = filteredCampaigns.length;
  if (count === 0) return null;
  const totalSpend = filteredCampaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
  const totalSales = filteredCampaigns.reduce((s, c) => s + (attributionMode === 'lastclick' ? (c.sales ?? 0) : (c.meta_sales ?? 0)), 0);
  const totalRevenue = filteredCampaigns.reduce((s, c) => s + (attributionMode === 'lastclick' ? (c.revenue ?? 0) : (c.meta_revenue ?? 0)), 0);
  const totalLucro = totalRevenue * 0.88 - totalSpend;
  const totalImpressions = filteredCampaigns.reduce((s, c) => s + (c.impressions ?? 0), 0);
  const totalClicks = filteredCampaigns.reduce((s, c) => s + (c.clicks ?? 0), 0);
  return {
    count, totalSpend, totalSales, totalRevenue, totalLucro, totalImpressions,
    roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
    cpa: totalSales > 0 ? totalSpend / totalSales : 0,
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
  };
}, [filteredCampaigns, attributionMode]);
```

Replace the footer row cells (lines 296-316). The key changes — replace the 4 cells (Vendas LC, Vendas Meta, Fat. LC, Fat. Meta) with 2:

```tsx
<tfoot className="sticky bottom-0 z-10 bg-card">
  <tr className="border-t border-white/10 bg-white/[0.03]">
    <td className="p-3" />
    <td className="p-3 font-semibold text-sm text-white">Total ({totals.count})</td>
    <td className="p-3" />
    <td className="p-3" />
    <td className="p-3 text-right whitespace-nowrap font-semibold">{fmt(totals.totalSpend)}</td>
    <td className="p-3 text-right font-semibold text-[#d1fe17]">{totals.totalSales}</td>
    <td className="p-3 text-right whitespace-nowrap font-semibold text-[#d1fe17]">{fmt(totals.totalRevenue)}</td>
    <td className="p-3 text-right whitespace-nowrap font-semibold"><span className={totals.totalLucro >= 0 ? 'text-[#d1fe17]' : 'text-red-500'}>{fmt(totals.totalLucro)}</span></td>
    <td className="p-3 text-right whitespace-nowrap font-semibold"><span className={totals.roas >= 1 ? 'text-[#d1fe17]' : 'text-red-500'}>{totals.roas.toFixed(2)}x</span></td>
    <td className="p-3 text-right whitespace-nowrap font-semibold">{totals.cpa > 0 ? fmt(totals.cpa) : '-'}</td>
    <td className="p-3 text-right whitespace-nowrap font-semibold">{totals.totalImpressions.toLocaleString('pt-BR')}</td>
    <td className="p-3 text-right whitespace-nowrap font-semibold">{fmt(totals.cpm)}</td>
    <td className="p-3 text-right whitespace-nowrap font-semibold">{totals.ctr.toFixed(2)}%</td>
    <td className="p-3 text-right whitespace-nowrap font-semibold">{fmt(totals.cpc)}</td>
  </tr>
</tfoot>
```

- [ ] **Step 8: Update the sort for `lucro` column**

In the `sortedCampaigns` useMemo (line 81), update the lucro sort to be mode-aware:

```tsx
if (sortColumn === 'lucro') {
  const getRevenue = (row: MergedCampaignRow) => attributionMode === 'lastclick' ? (row.revenue ?? 0) : (row.meta_revenue ?? 0);
  va = getRevenue(a) * 0.88 - (a.spend ?? 0);
  vb = getRevenue(b) * 0.88 - (b.spend ?? 0);
}
```

Add `attributionMode` to the dependency array of `sortedCampaigns`.

- [ ] **Step 9: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to CampaignsTable (may still have errors for AdSetsTable/AdsTable — fixed in Tasks 3-4)

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/src/components/campaigns/CampaignsTable.tsx
git commit -m "feat: update CampaignsTable to single-column mode-aware layout"
```

---

### Task 3: Update `AdSetsTable` to use attribution mode

**Files:**
- Modify: `packages/frontend/src/components/campaigns/AdSetsTable.tsx`

- [ ] **Step 1: Add `attributionMode` to props**

Add to `AdSetsTableProps` (after `onStatusUpdated` line 36):

```tsx
attributionMode: 'lastclick' | 'meta';
```

Update the destructured props to include `attributionMode`:

```tsx
export function AdSetsTable({ adSets, loading, search, statusFilter, currentPage, setCurrentPage, itemsPerPage, selectedIds, onSelectedIdsChange, showCampaignColumn = true, onBudgetUpdated, onStatusUpdated, attributionMode }: AdSetsTableProps) {
```

- [ ] **Step 2: Update column count**

Replace `const baseCols = 16;` (line 59) with:

```tsx
const baseCols = 14;
```

- [ ] **Step 3: Replace the legend with mode indicator**

Replace the legend div (lines 93-96):

```tsx
<div className="flex items-center gap-4">
  <span className="text-[10px] text-[#a1a4a5]/60">
    {attributionMode === 'lastclick' ? 'Vendas reais atribuidas via ad_id' : 'Conversoes reportadas pelo pixel da Meta'}
  </span>
</div>
```

- [ ] **Step 4: Replace dual header columns with single mode-aware columns**

Replace `Vendas LC`, `Vendas Meta`, `Fat. LC`, `Fat. Meta` headers (lines 127-130):

```tsx
<Th col={attributionMode === 'lastclick' ? 'sales' : 'meta_sales'}>Vendas</Th>
<Th col={attributionMode === 'lastclick' ? 'revenue' : 'meta_revenue'}>Faturamento</Th>
```

- [ ] **Step 5: Update row cells**

Replace the four cells for Vendas LC/Meta, Fat. LC/Meta (lines 155-158) with:

```tsx
<td className="p-3 text-right">
  <span className={cn('font-medium', (attributionMode === 'lastclick' ? as.sales : as.meta_sales) > 0 ? 'text-[#d1fe17]' : 'text-muted-foreground')}>
    {attributionMode === 'lastclick' ? as.sales : as.meta_sales}
  </span>
</td>
<td className="p-3 text-right whitespace-nowrap">
  <span className={(attributionMode === 'lastclick' ? as.revenue : as.meta_revenue) > 0 ? 'text-[#d1fe17] font-medium' : ''}>
    {fmt(attributionMode === 'lastclick' ? as.revenue : as.meta_revenue)}
  </span>
</td>
```

- [ ] **Step 6: Update Lucro, ROAS, CPA cells**

Replace the `lucro` and `roas` variables (lines 144-145):

```tsx
const modeRevenue = attributionMode === 'lastclick' ? (as.revenue ?? 0) : (as.meta_revenue ?? 0);
const modeSales = attributionMode === 'lastclick' ? (as.sales ?? 0) : (as.meta_sales ?? 0);
const lucro = modeRevenue * 0.88 - (as.spend ?? 0);
const roas = (as.spend ?? 0) > 0 ? modeRevenue / (as.spend ?? 0) : 0;
const cpa = modeSales > 0 ? (as.spend ?? 0) / modeSales : 0;
```

Replace the CPA cell (line 162):

```tsx
<td className="p-3 text-right whitespace-nowrap">{cpa > 0 ? fmt(cpa) : '-'}</td>
```

- [ ] **Step 7: Update the lucro sort to be mode-aware**

In the sort useMemo (line 67):

```tsx
if (sortColumn === 'lucro') {
  const getRevenue = (row: MergedAdSetRow) => attributionMode === 'lastclick' ? (row.revenue ?? 0) : (row.meta_revenue ?? 0);
  va = getRevenue(a) * 0.88 - (a.spend ?? 0);
  vb = getRevenue(b) * 0.88 - (b.spend ?? 0);
}
```

Add `attributionMode` to the dependency array.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/campaigns/AdSetsTable.tsx
git commit -m "feat: update AdSetsTable to single-column mode-aware layout"
```

---

### Task 4: Update `AdsTable` to use attribution mode

**Files:**
- Modify: `packages/frontend/src/components/campaigns/AdsTable.tsx`

- [ ] **Step 1: Add `attributionMode` to props**

Add to `AdsTableProps` (after `onSelectedIdsChange` line 31):

```tsx
attributionMode: 'lastclick' | 'meta';
```

Update the destructured props:

```tsx
export function AdsTable({ ads, loading, search, statusFilter, currentPage, setCurrentPage, itemsPerPage, onStatusUpdated, selectedIds, onSelectedIdsChange, attributionMode }: AdsTableProps) {
```

- [ ] **Step 2: Update column count**

Replace `const COL_COUNT = 15;` (line 35) with:

```tsx
const COL_COUNT = 13; // checkbox + name + status + spend + vendas + fat + lucro + roas + cpa + impressoes + cpm + ctr + cpc
```

- [ ] **Step 3: Replace legend with mode indicator**

Replace the legend div (lines 76-79):

```tsx
<div className="flex items-center gap-4">
  <span className="text-[10px] text-[#a1a4a5]/60">
    {attributionMode === 'lastclick' ? 'Vendas reais atribuidas via ad_id' : 'Conversoes reportadas pelo pixel da Meta'}
  </span>
</div>
```

- [ ] **Step 4: Replace dual header columns**

Replace `Vendas LC`, `Vendas Meta`, `Fat. LC`, `Fat. Meta` headers (lines 98-101):

```tsx
<Th col={attributionMode === 'lastclick' ? 'sales' : 'meta_sales'}>Vendas</Th>
<Th col={attributionMode === 'lastclick' ? 'revenue' : 'meta_revenue'}>Faturamento</Th>
```

- [ ] **Step 5: Update row cells**

Replace the four cells (lines 124-127) with:

```tsx
<td className="p-3 text-right">
  <span className={cn('font-medium', (attributionMode === 'lastclick' ? ad.sales : ad.meta_sales) > 0 ? 'text-[#d1fe17]' : 'text-muted-foreground')}>
    {attributionMode === 'lastclick' ? ad.sales : ad.meta_sales}
  </span>
</td>
<td className="p-3 text-right whitespace-nowrap">
  <span className={(attributionMode === 'lastclick' ? ad.revenue : ad.meta_revenue) > 0 ? 'text-[#d1fe17] font-medium' : ''}>
    {fmt(attributionMode === 'lastclick' ? ad.revenue : ad.meta_revenue)}
  </span>
</td>
```

- [ ] **Step 6: Update Lucro, ROAS, CPA variables**

Replace `lucro` and `roas` variables (lines 115-116):

```tsx
const modeRevenue = attributionMode === 'lastclick' ? (ad.revenue ?? 0) : (ad.meta_revenue ?? 0);
const modeSales = attributionMode === 'lastclick' ? (ad.sales ?? 0) : (ad.meta_sales ?? 0);
const lucro = modeRevenue * 0.88 - (ad.spend ?? 0);
const roas = (ad.spend ?? 0) > 0 ? modeRevenue / (ad.spend ?? 0) : 0;
const cpa = modeSales > 0 ? (ad.spend ?? 0) / modeSales : 0;
```

Replace ROAS cell (line 129):

```tsx
<td className="p-3 text-right whitespace-nowrap">
  <span className="flex items-center justify-end gap-0.5">
    {roas >= 1 ? <TrendingUp className="h-3 w-3 text-[#d1fe17]" /> : <TrendingDown className="h-3 w-3 text-red-500" />}
    <span className={cn('font-medium', roas >= 1 ? 'text-[#d1fe17]' : 'text-red-500')}>{roas.toFixed(2)}x</span>
  </span>
</td>
```

Replace CPA cell (line 130):

```tsx
<td className="p-3 text-right whitespace-nowrap">{cpa > 0 ? fmt(cpa) : '-'}</td>
```

- [ ] **Step 7: Update the lucro sort**

In the sort useMemo (line 50):

```tsx
if (sortColumn === 'lucro') {
  const getRevenue = (row: MergedAdRow) => attributionMode === 'lastclick' ? (row.revenue ?? 0) : (row.meta_revenue ?? 0);
  va = getRevenue(a) * 0.88 - (a.spend ?? 0);
  vb = getRevenue(b) * 0.88 - (b.spend ?? 0);
}
```

Add `attributionMode` to the dependency array.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/campaigns/AdsTable.tsx
git commit -m "feat: update AdsTable to single-column mode-aware layout"
```

---

### Task 5: Update `InsightsPanel` to use attribution mode

**Files:**
- Modify: `packages/frontend/src/components/campaigns/InsightsPanel.tsx`

- [ ] **Step 1: Add `attributionMode` to props and pass correct data**

Replace the full `InsightsPanel` component:

```tsx
interface InsightsPanelProps {
  topAds: TopAdData[];
  metaTopAds: TopAdData[];
  topAdsLoading: boolean;
  funnelData: FunnelData;
  attributionMode: 'lastclick' | 'meta';
}

export function InsightsPanel({ topAds, metaTopAds, topAdsLoading, funnelData, attributionMode }: InsightsPanelProps) {
  const displayTopAds = attributionMode === 'lastclick' ? topAds : metaTopAds;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <TopAdsChart
            topAds={displayTopAds}
            metaTopAds={[]}
            loading={topAdsLoading}
            title={`Top 5 Anuncios (${attributionMode === 'lastclick' ? 'Last Click' : 'Meta'})`}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <ConversionFunnel
            linkClicks={funnelData.linkClicks}
            landingPageViews={funnelData.landingPageViews}
            initiateCheckouts={funnelData.initiateCheckouts}
            sales={funnelData.sales}
            loading={funnelData.loading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/campaigns/InsightsPanel.tsx
git commit -m "feat: update InsightsPanel to show data based on attribution mode"
```

---

### Task 6: Full build verification and final commit

**Files:**
- All modified files from Tasks 1-5

- [ ] **Step 1: Run TypeScript compilation**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `cd packages/frontend && npm run lint`
Expected: No errors

- [ ] **Step 3: Run dev server and verify visually**

Run: `cd packages/frontend && npm run dev`
Expected: Dev server starts on :5173, campaigns page shows the attribution toggle tabs above each table

- [ ] **Step 4: Verify both modes work**

Manual verification:
1. Navigate to Campanhas page
2. Default tab should be "Atribuicao Last Click"
3. Table shows: Campanha, Status, Orcamento, Gasto, Vendas, Faturamento, Lucro, ROAS, CPA, Impressoes, CPM, CTR, CPC (13 data columns)
4. Click "Vendas na Meta" — same columns but values switch to Meta attribution data
5. Switch between Campanhas/Conjuntos/Anuncios tabs — attribution toggle persists
6. Footer totals update when switching attribution mode
7. Sorting by Vendas, Faturamento, Lucro, ROAS, CPA respects current mode
