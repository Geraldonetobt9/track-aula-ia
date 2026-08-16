import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Landmark, Loader2, Check } from 'lucide-react';

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type SaveState = 'idle' | 'saving' | 'saved';

interface ImpostoValueCardProps {
  /** Sum of the period's tax entries. */
  total: number;
  /** Amount recorded for the editable month; null when none exists yet. */
  monthAmount: number | null;
  /** False on year/total views, where there is no single month to write to. */
  editable: boolean;
  loading: boolean;
  onSave: (amount: number) => Promise<boolean>;
}

/**
 * Manual tax card, sitting next to the Meta Ads one. The two are independent:
 * this amount is typed by the user, not derived from ad spend.
 */
export function ImpostoValueCard({
  total,
  monthAmount,
  editable,
  loading,
  onSave,
}: ImpostoValueCardProps) {
  const [value, setValue] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    setValue(monthAmount != null ? String(monthAmount) : '');
  }, [monthAmount, editable]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = setTimeout(() => setSaveState('idle'), 1500);
    return () => clearTimeout(timer);
  }, [saveState]);

  const commit = async () => {
    const raw = value.trim();
    const parsed = raw === '' ? 0 : parseFloat(raw.replace(',', '.'));

    if (!Number.isFinite(parsed) || parsed < 0) {
      setValue(monthAmount != null ? String(monthAmount) : '');
      return;
    }
    if (parsed === (monthAmount ?? 0)) return;

    setSaveState('saving');
    const saved = await onSave(parsed);
    setSaveState(saved ? 'saved' : 'idle');
  };

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
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
              <Landmark className="h-4 w-4 text-accent-readable" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Imposto
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Valor informado por você
              </p>
            </div>
          </div>
          <SaveIndicator state={saveState} />
        </div>

        {editable ? (
          <div className="flex items-end gap-3 pt-1">
            <span className="pb-3 text-2xl font-semibold text-muted-foreground">R$</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0,00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setValue(monthAmount != null ? String(monthAmount) : '');
                  (e.target as HTMLInputElement).blur();
                }
              }}
              disabled={loading}
              aria-label="Valor do imposto no mês"
              className="w-[160px] rounded-lg border border-foreground/10 bg-foreground/[0.04] px-4 py-2.5 text-3xl font-semibold tabular-nums text-foreground outline-none transition focus:border-primary/40 focus:bg-foreground/[0.06] focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            />
          </div>
        ) : (
          <p className="pt-1 text-xs text-muted-foreground/70">
            Selecione um mês para informar o valor
          </p>
        )}

        <div className="mt-auto space-y-1.5 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Imposto neste período</span>
            <span className="text-sm font-semibold tabular-nums text-accent-readable">
              {loading ? '—' : formatCurrency(total)}
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
