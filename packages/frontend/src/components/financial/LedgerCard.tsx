import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Trash2, Check, X, Repeat, Inbox } from 'lucide-react';
import type { FinancialEntry } from '@/hooks/useFinancialEntries';

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface RecurringRow {
  id: string;
  name: string;
  valueText: string;
}

type Variant = 'expense' | 'revenue';

interface LedgerCardProps {
  icon: LucideIcon;
  title: string;
  variant: Variant;
  entries: FinancialEntry[];
  total: number;
  recurring?: RecurringRow[];
  recurringHint?: string;
  addNamePlaceholder: string;
  addAmountPlaceholder: string;
  onAdd: (name: string, amount: number) => void;
  onUpdate: (id: string, updates: { name?: string; amount?: number }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const PALETTE: Record<Variant, {
  iconBg: string;
  iconRing: string;
  iconColor: string;
  totalColor: string;
  addBtn: string;
}> = {
  expense: {
    iconBg: 'bg-destructive/10',
    iconRing: 'ring-destructive/20',
    iconColor: 'text-destructive',
    totalColor: 'text-destructive',
    addBtn:
      'bg-destructive/15 hover:bg-destructive/25 text-destructive hover:text-destructive border-destructive/20',
  },
  revenue: {
    iconBg: 'bg-success/10',
    iconRing: 'ring-success/20',
    iconColor: 'text-success',
    totalColor: 'text-success',
    addBtn:
      'bg-success/15 hover:bg-success/25 text-success hover:text-success border-success/20',
  },
};

export function LedgerCard({
  icon: Icon,
  title,
  variant,
  entries,
  total,
  recurring,
  recurringHint,
  addNamePlaceholder,
  addAmountPlaceholder,
  onAdd,
  onUpdate,
  onRemove,
}: LedgerCardProps) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const palette = PALETTE[variant];

  const handleAdd = () => {
    const parsed = parseFloat(amount.replace(',', '.'));
    if (!name.trim() || !Number.isFinite(parsed) || parsed <= 0) return;
    onAdd(name.trim(), parsed);
    setName('');
    setAmount('');
  };

  const itemCount = entries.length + (recurring?.length ?? 0);
  const isEmpty = itemCount === 0;

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${palette.iconBg} ${palette.iconRing}`}
          >
            <Icon className={`h-5 w-5 ${palette.iconColor}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">{title}</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {itemCount} {itemCount === 1 ? 'lançamento' : 'lançamentos'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p
            className={`text-xl font-semibold tabular-nums leading-none ${palette.totalColor}`}
          >
            {formatCurrency(total)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-1">
            Total
          </p>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col gap-4 px-5 pb-5 pt-0">
        <div className="flex-1 space-y-4 overflow-y-auto pr-1 max-h-[400px] scrollbar-thin">
          {recurring && recurring.length > 0 && (
            <Section
              title="Recorrentes"
              count={recurring.length}
              hint={recurringHint ?? 'Configurações > Custos'}
            >
              {recurring.map((row) => (
                <RecurringRowItem key={row.id} row={row} />
              ))}
            </Section>
          )}

          {entries.length > 0 && (
            <Section title="Deste período" count={entries.length}>
              {entries.map((e) => (
                <EditableEntryRow
                  key={e.id}
                  entry={e}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                />
              ))}
            </Section>
          )}

          {isEmpty && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.03] ring-1 ring-foreground/5">
                <Inbox className="h-5 w-5 text-muted-foreground/60" />
              </div>
              <p className="text-sm text-muted-foreground">Nenhum lançamento ainda</p>
              <p className="text-xs text-muted-foreground/60 max-w-[220px]">
                Adicione abaixo para acompanhar no resumo do período.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-2.5">
          <div className="flex items-center gap-2">
            <Input
              placeholder={addNamePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="flex-1 h-9 border-foreground/[0.06] bg-transparent placeholder:text-muted-foreground/50 focus-visible:border-foreground/15"
            />
            <Input
              placeholder={addAmountPlaceholder}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="w-28 h-9 border-foreground/[0.06] bg-transparent tabular-nums placeholder:text-muted-foreground/50 focus-visible:border-foreground/15"
              inputMode="decimal"
            />
            <Button
              size="icon"
              onClick={handleAdd}
              disabled={!name.trim() || !amount.trim()}
              className={`h-9 w-9 shrink-0 border ${palette.addBtn} disabled:opacity-40`}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {title}
          </span>
          <span className="text-[10px] text-muted-foreground/40">·</span>
          <span className="text-[10px] font-medium text-muted-foreground/70 tabular-nums">
            {count}
          </span>
        </div>
        {hint && (
          <span className="text-[10px] text-muted-foreground/50">{hint}</span>
        )}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RecurringRowItem({ row }: { row: RecurringRow }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-foreground/[0.025] px-3 py-2 transition hover:bg-foreground/[0.04]">
      <div className="flex items-center gap-2.5 min-w-0">
        <Repeat className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-sm text-foreground/90 truncate">{row.name}</span>
      </div>
      <span className="text-sm font-medium tabular-nums text-foreground shrink-0 ml-3">
        {row.valueText}
      </span>
    </div>
  );
}

function EditableEntryRow({
  entry,
  onUpdate,
  onRemove,
}: {
  entry: FinancialEntry;
  onUpdate: (id: string, updates: { name?: string; amount?: number }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [editAmount, setEditAmount] = useState(String(entry.amount));

  const handleSave = () => {
    const a = parseFloat(editAmount.replace(',', '.'));
    const updates: { name?: string; amount?: number } = {};
    if (editName.trim() !== entry.name) updates.name = editName.trim();
    if (Number.isFinite(a) && a > 0 && a !== entry.amount) updates.amount = a;
    if (Object.keys(updates).length > 0) onUpdate(entry.id, updates);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditName(entry.name);
    setEditAmount(String(entry.amount));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.04] px-2 py-1.5 ring-1 ring-foreground/10">
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          className="flex-1 h-7 text-sm"
          autoFocus
        />
        <Input
          value={editAmount}
          onChange={(e) => setEditAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          className="w-24 h-7 text-sm tabular-nums"
          inputMode="decimal"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-success hover:text-success"
          onClick={handleSave}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={handleCancel}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between rounded-lg bg-foreground/[0.025] px-3 py-2 transition hover:bg-foreground/[0.04]">
      <span className="text-sm text-foreground truncate min-w-0">{entry.name}</span>
      <div className="flex items-center gap-1 shrink-0 ml-3">
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatCurrency(entry.amount)}
        </span>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(entry.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
