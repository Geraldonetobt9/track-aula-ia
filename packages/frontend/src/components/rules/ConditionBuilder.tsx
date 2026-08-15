import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X, Check } from 'lucide-react';
import { useState } from 'react';

const METRICS = [
  { value: 'spend', label: 'Gasto' },
  { value: 'cpa', label: 'CPA' },
  { value: 'roi', label: 'ROI' },
  { value: 'roas', label: 'ROAS' },
  { value: 'profit', label: 'Lucro' },
  { value: 'profit_margin', label: 'Margem de Lucro' },
  { value: 'cpc', label: 'CPC' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpm', label: 'CPM' },
  { value: 'impressions', label: 'Impressões' },
  { value: 'clicks', label: 'Cliques' },
  { value: 'conversions', label: 'Conversões' },
];

const OPERATORS = [
  { value: 'gt', label: 'Maior que' },
  { value: 'lt', label: 'Menor que' },
  { value: 'gte', label: 'Maior ou igual a' },
  { value: 'lte', label: 'Menor ou igual a' },
];

export interface ConditionInput {
  metric: string;
  operator: string;
  value: number;
}

interface ConditionBuilderProps {
  conditions: ConditionInput[];
  onChange: (conditions: ConditionInput[]) => void;
}

export function ConditionBuilder({ conditions, onChange }: ConditionBuilderProps) {
  const [draft, setDraft] = useState<{ metric: string; operator: string; value: string }>({ metric: '', operator: '', value: '' });
  const [showDraft, setShowDraft] = useState(false);

  const confirmDraft = () => {
    if (!draft.metric || !draft.operator || !draft.value) return;
    const numValue = parseFloat(draft.value);
    if (isNaN(numValue)) return;
    onChange([...conditions, { metric: draft.metric, operator: draft.operator, value: numValue }]);
    setDraft({ metric: '', operator: '', value: '' });
    setShowDraft(false);
  };

  const removeCondition = (index: number) => onChange(conditions.filter((_, i) => i !== index));
  const getMetricLabel = (value: string) => METRICS.find((m) => m.value === value)?.label || value;
  const getOperatorLabel = (value: string) => OPERATORS.find((o) => o.value === value)?.label || value;

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">Condições <span className="text-xs">(todas devem ser verdadeiras)</span></div>
      {conditions.map((cond, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">{getMetricLabel(cond.metric)}</span>
          <span className="text-muted-foreground">{getOperatorLabel(cond.operator)}</span>
          <span>{cond.value}</span>
          <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => removeCondition(i)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      {showDraft && (
        <div className="flex items-center gap-2">
          <Select value={draft.metric} onValueChange={(v) => setDraft({ ...draft, metric: v })}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Métrica" /></SelectTrigger>
            <SelectContent>{METRICS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}</SelectContent>
          </Select>
          <Select value={draft.operator} onValueChange={(v) => setDraft({ ...draft, operator: v })}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Operador" /></SelectTrigger>
            <SelectContent>{OPERATORS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
          </Select>
          <Input type="number" step="any" placeholder="Valor" className="w-[100px]" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && confirmDraft()} />
          <Button variant="ghost" size="icon" className="h-8 w-8 text-green-500" onClick={confirmDraft}><Check className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setShowDraft(false)}><X className="h-4 w-4" /></Button>
        </div>
      )}
      {!showDraft && (
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowDraft(true)}><Plus className="h-3.5 w-3.5" /> Adicionar condição</Button>
      )}
    </div>
  );
}
