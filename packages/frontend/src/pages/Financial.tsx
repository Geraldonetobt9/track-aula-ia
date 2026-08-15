import { useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFinancialEntries } from '@/hooks/useFinancialEntries';
import { useFinancialSummary } from '@/hooks/useFinancialSummary';
import { useCompanyCosts } from '@/hooks/useCompanyCosts';
import { TrendingUp, DollarSign, Receipt, PiggyBank, Megaphone, Download, Landmark } from 'lucide-react';
import {
  ALL_PERIOD,
  buildMonthOptions,
  buildYearOptions,
  parsePeriodMode,
  periodToEntryMonth,
  periodToRange,
} from '@/lib/financialPeriod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
// import { ProfitEvolutionChart } from '@/components/financial/ProfitEvolutionChart';
import { FinancialBreakdownChart } from '@/components/financial/FinancialBreakdownChart';
import { AdSpendTaxCard } from '@/components/financial/AdSpendTaxCard';
import { ImpostoValueCard } from '@/components/financial/ImpostoValueCard';
import { LedgerCard, type RecurringRow } from '@/components/financial/LedgerCard';

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Name given to the tax entry the Imposto card writes. */
const TAX_ENTRY_NAME = 'Imposto';

export default function Financial() {
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const [selectedPeriod, setSelectedPeriod] = useState(monthOptions[0].value);

  const periodMode = parsePeriodMode(selectedPeriod);
  const range = useMemo(() => periodToRange(selectedPeriod), [selectedPeriod]);

  // Importing copies one month into another, and tax is written to a single
  // month — both only make sense on a month view.
  const isMonthView = periodMode === 'month';
  const resolveRefMonth = () => periodToEntryMonth(selectedPeriod);

  const { entries, loading: entriesLoading, addEntry, updateEntry, removeEntry, importFromMonth } = useFinancialEntries(range);
  const {
    grossRevenue,
    adSpend,
    adSpendTax,
    adSpendTaxPercentage,
    loading: summaryLoading,
    refetch: refetchSummary,
  } = useFinancialSummary(range);
  const { costs: companyCosts } = useCompanyCosts();

  // Import modal state
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState('');
  const [importing, setImporting] = useState(false);

  const expenses = entries.filter((e) => e.type === 'expense');
  const revenues = entries.filter((e) => e.type === 'revenue');
  const taxEntries = entries.filter((e) => e.type === 'tax');

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalRevenues = revenues.reduce((s, e) => s + e.amount, 0);
  const totalTax = taxEntries.reduce((s, e) => s + e.amount, 0);

  // Only a month view maps to a single writable entry; year/total just sum.
  const editableTaxEntry = isMonthView ? taxEntries[0] : undefined;

  const handleSaveTax = async (amount: number): Promise<boolean> => {
    if (amount === 0) {
      if (editableTaxEntry) await removeEntry(editableTaxEntry.id);
      return true;
    }
    if (editableTaxEntry) {
      await updateEntry(editableTaxEntry.id, { amount });
      return true;
    }
    await addEntry('tax', TAX_ENTRY_NAME, amount, resolveRefMonth());
    return true;
  };

  const companyCostsTotal = companyCosts.reduce((sum, cost) => {
    if (cost.type === 'percentage') return sum + grossRevenue * (cost.value / 100);
    return sum + cost.value;
  }, 0);

  const recurringExpenseRows = useMemo<RecurringRow[]>(
    () =>
      companyCosts.map((cost) => {
        const computed =
          cost.type === 'percentage' ? grossRevenue * (cost.value / 100) : cost.value;
        return {
          id: cost.id,
          name: cost.name,
          valueText:
            cost.type === 'percentage'
              ? `${cost.value}% · ${formatCurrency(computed)}`
              : formatCurrency(computed),
        };
      }),
    [companyCosts, grossRevenue],
  );

  const profit =
    grossRevenue - adSpend - adSpendTax - totalTax - totalExpenses - companyCostsTotal + totalRevenues;
  const loading = entriesLoading || summaryLoading;

  const handleImport = async () => {
    if (!importSource || !isMonthView) return;
    setImporting(true);
    await importFromMonth(periodToEntryMonth(importSource), resolveRefMonth());
    setImporting(false);
    setImportOpen(false);
    setImportSource('');
  };

  const importableMonths = monthOptions.filter((o) => o.value !== selectedPeriod);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header with filter */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-foreground">Financeiro</h1>
          <div className="flex items-center gap-2">
            {isMonthView && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Download className="h-4 w-4 mr-1.5" />
                Importar de outro mês
              </Button>
            )}
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PERIOD}>Total</SelectItem>

                <SelectGroup>
                  <SelectLabel>Ano</SelectLabel>
                  {yearOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>

                <SelectGroup>
                  <SelectLabel>Mês</SelectLabel>
                  {monthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <SummaryCard icon={DollarSign} label="Faturamento Bruto" value={grossRevenue} loading={loading} />
          <SummaryCard
            icon={Megaphone}
            label="Gasto com Ads"
            value={-(adSpend + adSpendTax)}
            loading={loading}
            negative
            subtitle={
              adSpendTaxPercentage > 0
                ? `Ads ${formatCurrency(adSpend)} · Imposto ${adSpendTaxPercentage}% ${formatCurrency(adSpendTax)}`
                : undefined
            }
          />
          <SummaryCard
            icon={Landmark}
            label="Imposto"
            value={-totalTax}
            loading={loading}
            negative
          />
          <SummaryCard icon={Receipt} label="Outros Gastos" value={-(totalExpenses + companyCostsTotal)} loading={loading} negative />
          <SummaryCard icon={TrendingUp} label="Outras Receitas" value={totalRevenues} loading={loading} />
          <SummaryCard icon={PiggyBank} label="Lucro" value={profit} loading={loading} highlight />
        </div>

        {/* Profit Evolution Chart — comentado para dar lugar ao gráfico de composição */}
        {/* <ProfitEvolutionChart /> */}

        {/* Composição Financeira */}
        <FinancialBreakdownChart
          grossRevenue={grossRevenue}
          adSpend={adSpend + adSpendTax}
          totalExpenses={totalTax + totalExpenses + companyCostsTotal}
          totalRevenues={totalRevenues}
          profit={profit}
          loading={loading}
        />

        {/* Os dois impostos, lado a lado */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AdSpendTaxCard
            adSpend={adSpend}
            adSpendTax={adSpendTax}
            adSpendTaxPercentage={adSpendTaxPercentage}
            loading={loading}
            refetchSummary={refetchSummary}
          />
          <ImpostoValueCard
            total={totalTax}
            monthAmount={editableTaxEntry?.amount ?? null}
            editable={isMonthView}
            loading={loading}
            onSave={handleSaveTax}
          />
        </div>

        {/* Two columns: expenses & revenues */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <LedgerCard
            icon={Receipt}
            title="Outros Gastos"
            variant="expense"
            entries={expenses}
            total={totalExpenses + companyCostsTotal}
            recurring={recurringExpenseRows}
            addNamePlaceholder="Nome do gasto"
            addAmountPlaceholder="Valor"
            onAdd={(name, amount) => addEntry('expense', name, amount, resolveRefMonth())}
            onUpdate={updateEntry}
            onRemove={removeEntry}
          />

          <LedgerCard
            icon={TrendingUp}
            title="Outras Receitas"
            variant="revenue"
            entries={revenues}
            total={totalRevenues}
            addNamePlaceholder="Nome da receita"
            addAmountPlaceholder="Valor"
            onAdd={(name, amount) => addEntry('revenue', name, amount, resolveRefMonth())}
            onUpdate={updateEntry}
            onRemove={removeEntry}
          />
        </div>
      </div>

      {/* Import Modal */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar lançamentos de outro mês</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Os lançamentos (gastos e receitas) do mês selecionado serão copiados para o mês atual.
          </p>
          <Select value={importSource} onValueChange={setImportSource}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o mês de origem" />
            </SelectTrigger>
            <SelectContent>
              {importableMonths.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
            <Button onClick={handleImport} disabled={!importSource || importing}>
              {importing ? 'Importando...' : 'Importar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

/* ── Summary Card ── */
function SummaryCard({
  icon: Icon,
  label,
  value,
  loading,
  negative,
  highlight,
  subtitle,
}: {
  icon: any;
  label: string;
  value: number;
  loading: boolean;
  negative?: boolean;
  highlight?: boolean;
  subtitle?: React.ReactNode;
}) {
  const color = highlight
    ? value >= 0
      ? 'text-success'
      : 'text-destructive'
    : negative
      ? 'text-destructive/80'
      : 'text-foreground';

  return (
    <Card className={highlight ? 'ring-1 ring-primary/30' : ''}>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wider">{label}</span>
        </div>
        {loading ? (
          <div className="h-7 w-24 animate-pulse rounded bg-foreground/5" />
        ) : (
          <span className={`text-xl font-semibold ${color}`}>
            {formatCurrency(Math.abs(value))}
          </span>
        )}
        {!loading && subtitle && (
          <span className="text-xs text-muted-foreground leading-snug pt-0.5">
            {subtitle}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
