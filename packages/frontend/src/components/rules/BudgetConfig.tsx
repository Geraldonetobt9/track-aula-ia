import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface BudgetAdjustmentInput {
  mode: 'percentage' | 'fixed';
  value: string;
  budget_type: 'daily' | 'lifetime';
  min_budget: string;
  max_budget: string;
}

interface BudgetConfigProps {
  value: BudgetAdjustmentInput;
  onChange: (value: BudgetAdjustmentInput) => void;
}

export function BudgetConfig({ value, onChange }: BudgetConfigProps) {
  const update = (partial: Partial<BudgetAdjustmentInput>) => onChange({ ...value, ...partial });

  return (
    <div className="rounded-lg border border-dashed p-4 space-y-3">
      <div className="text-sm font-medium text-muted-foreground">Configuração de Orçamento</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Modo</Label>
          <Select value={value.mode} onValueChange={(v) => update({ mode: v as 'percentage' | 'fixed' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Porcentagem</SelectItem>
              <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Valor {value.mode === 'percentage' ? '(%)' : '(R$)'}</Label>
          <Input type="number" step="any" min="0" placeholder={value.mode === 'percentage' ? '20' : '500.00'} value={value.value} onChange={(e) => update({ value: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo de orçamento</Label>
          <Select value={value.budget_type} onValueChange={(v) => update({ budget_type: v as 'daily' | 'lifetime' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Diário</SelectItem>
              <SelectItem value="lifetime">Vitalício</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div />
        <div className="space-y-1.5">
          <Label className="text-xs">Orçamento mínimo (R$)</Label>
          <Input type="number" step="any" min="0" placeholder="Sem limite" value={value.min_budget} onChange={(e) => update({ min_budget: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Orçamento máximo (R$)</Label>
          <Input type="number" step="any" min="0" placeholder="Sem limite" value={value.max_budget} onChange={(e) => update({ max_budget: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
