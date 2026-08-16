import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Receipt, Loader2, Check } from 'lucide-react';
import { useUpdateAdSpendTax } from '@/hooks/useUpdateAdSpendTax';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useRefetch } from '@/contexts/RefetchContext';

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface AdSpendTaxCardProps {
  adSpend: number;
  adSpendTax: number;
  adSpendTaxPercentage: number;
  loading: boolean;
  refetchSummary: () => Promise<void> | void;
}

type SaveState = 'idle' | 'saving' | 'saved';

export function AdSpendTaxCard({
  adSpend,
  adSpendTax,
  adSpendTaxPercentage,
  loading,
  refetchSummary,
}: AdSpendTaxCardProps) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const { triggerRefetch } = useRefetch();
  const { saveTax } = useUpdateAdSpendTax();

  const [value, setValue] = useState(String(adSpendTaxPercentage ?? 0));
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    setValue(String(adSpendTaxPercentage ?? 0));
  }, [adSpendTaxPercentage, activeWorkspaceId]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = setTimeout(() => setSaveState('idle'), 1500);
    return () => clearTimeout(t);
  }, [saveState]);

  const commit = async () => {
    if (!activeWorkspaceId) return;
    const parsed = parseFloat(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setValue(String(adSpendTaxPercentage ?? 0));
      return;
    }
    if (parsed === adSpendTaxPercentage) return;
    setSaveState('saving');
    const ok = await saveTax(activeWorkspaceId, parsed);
    if (ok) {
      await refetchSummary();
      triggerRefetch();
      setSaveState('saved');
    } else {
      setSaveState('idle');
    }
  };

  const disabled = !activeWorkspaceId || loading;
  const livePercentage = parseFloat(value.replace(',', '.'));
  const previewTax =
    Number.isFinite(livePercentage) && livePercentage >= 0 && livePercentage <= 100
      ? adSpend * (livePercentage / 100)
      : adSpendTax;

  return (
    <Card className="relative overflow-hidden h-full">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at top right, rgba(62,143,216,0.10) 0%, transparent 55%)',
        }}
      />
      <CardContent className="relative flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
              <Receipt className="h-4 w-4 text-accent-readable" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Imposto sobre Anúncios
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Aplicado em todo o gasto com Meta Ads
              </p>
            </div>
          </div>
          <SaveIndicator state={saveState} />
        </div>

        <div className="flex items-end gap-3 pt-1">
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setValue(String(adSpendTaxPercentage ?? 0));
                  (e.target as HTMLInputElement).blur();
                }
              }}
              disabled={disabled}
              className="w-[120px] rounded-lg border border-foreground/10 bg-foreground/[0.04] px-4 py-2.5 text-3xl font-semibold tabular-nums text-foreground outline-none transition focus:border-primary/40 focus:bg-foreground/[0.06] focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            />
          </div>
          <span className="pb-3 text-2xl font-semibold text-muted-foreground">%</span>
        </div>

        <div className="mt-auto space-y-1.5 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Sobre o gasto com ads</span>
            <span className="text-xs font-medium tabular-nums text-foreground">
              {loading ? '—' : formatCurrency(adSpend)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-foreground/5 pt-1.5">
            <span className="text-xs text-muted-foreground">Imposto neste período</span>
            <span className="text-sm font-semibold tabular-nums text-accent-readable">
              {loading ? '—' : formatCurrency(previewTax)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <Loader2 className="h-3 w-3 animate-spin" />
        Salvando
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-accent-readable">
        <Check className="h-3 w-3" />
        Salvo
      </span>
    );
  }
  return null;
}
