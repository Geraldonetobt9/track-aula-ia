import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BudgetConfig, BudgetAdjustmentInput } from './BudgetConfig';
import { ConditionBuilder, ConditionInput } from './ConditionBuilder';
import type { AutomationRule } from '@/hooks/useAutomationRules';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_OPTIONS = [
  { value: 'campaign-active', label: 'Campanhas Ativas', entity: 'campaign', status: 'active' },
  { value: 'campaign-paused', label: 'Campanhas Pausadas', entity: 'campaign', status: 'paused' },
  { value: 'campaign-any', label: 'Campanhas (Qualquer)', entity: 'campaign', status: 'any' },
  { value: 'adset-active', label: 'Conjuntos Ativos', entity: 'adset', status: 'active' },
  { value: 'adset-paused', label: 'Conjuntos Pausados', entity: 'adset', status: 'paused' },
  { value: 'adset-any', label: 'Conjuntos (Qualquer)', entity: 'adset', status: 'any' },
  { value: 'ad-active', label: 'Anúncios Ativos', entity: 'ad', status: 'active' },
  { value: 'ad-paused', label: 'Anúncios Pausados', entity: 'ad', status: 'paused' },
  { value: 'ad-any', label: 'Anúncios (Qualquer)', entity: 'ad', status: 'any' },
] as const;

const FREQUENCY_OPTIONS = [
  { value: 10, label: 'A cada 10 minutos' },
  { value: 15, label: 'A cada 15 minutos' },
  { value: 30, label: 'A cada 30 minutos' },
  { value: 60, label: 'A cada 1 hora' },
  { value: 120, label: 'A cada 2 horas' },
  { value: 180, label: 'A cada 3 horas' },
  { value: 360, label: 'A cada 6 horas' },
  { value: 1440, label: 'Uma vez por dia' },
] as const;

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'custom', label: 'Personalizado' },
] as const;

const ACTION_OPTIONS = [
  { value: 'activate', label: 'Ativar' },
  { value: 'pause', label: 'Pausar' },
  { value: 'increase_budget', label: 'Aumentar orçamento' },
  { value: 'decrease_budget', label: 'Diminuir orçamento' },
] as const;

const DAILY_FREQUENCY = 1440;
const BUDGET_ACTIONS = new Set(['increase_budget', 'decrease_budget']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET: BudgetAdjustmentInput = {
  mode: 'percentage',
  value: '',
  budget_type: 'daily',
  min_budget: '',
  max_budget: '',
};

function buildTargetValue(entity: string, status: string): string {
  return `${entity}-${status}`;
}

function parseTargetValue(combined: string): { entity: string; status: string } {
  const option = TARGET_OPTIONS.find((o) => o.value === combined);
  if (option) return { entity: option.entity, status: option.status };
  const lastDash = combined.lastIndexOf('-');
  return {
    entity: combined.slice(0, lastDash),
    status: combined.slice(lastDash + 1),
  };
}

function buildDefaultFormState() {
  return {
    name: '',
    connection_id: '',
    target: 'campaign-active',
    name_filter: '',
    action_type: 'activate' as string,
    budget: DEFAULT_BUDGET,
    conditions: [] as ConditionInput[],
    evaluation_period: 'today' as string,
    custom_start_date: '',
    frequency_minutes: 60,
    daily_run_time: '',
  };
}

function buildFormStateFromRule(rule: AutomationRule) {
  const ba = rule.budget_adjustment;
  return {
    name: rule.name,
    connection_id: rule.connection_id ?? '',
    target: buildTargetValue(rule.target_entity, rule.target_status),
    name_filter: rule.name_filter ?? '',
    action_type: rule.action_type,
    budget: ba
      ? {
          mode: ba.mode,
          value: String(ba.value),
          budget_type: ba.budget_type,
          min_budget: ba.min_budget != null ? String(ba.min_budget) : '',
          max_budget: ba.max_budget != null ? String(ba.max_budget) : '',
        }
      : DEFAULT_BUDGET,
    conditions: rule.conditions.map((c) => ({
      metric: c.metric,
      operator: c.operator,
      value: c.value,
    })),
    evaluation_period: rule.evaluation_period,
    custom_start_date: rule.custom_start_date ?? '',
    frequency_minutes: rule.frequency_minutes,
    daily_run_time: rule.daily_run_time ?? '',
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationErrors {
  name?: string;
  conditions?: string;
  daily_run_time?: string;
  custom_start_date?: string;
}

function validate(form: ReturnType<typeof buildDefaultFormState>): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!form.name.trim()) {
    errors.name = 'Nome da regra é obrigatório.';
  }

  if (form.conditions.length === 0) {
    errors.conditions = 'Adicione ao menos uma condição.';
  }

  if (form.frequency_minutes === DAILY_FREQUENCY && !form.daily_run_time) {
    errors.daily_run_time = 'Informe o horário de execução diária.';
  }

  if (form.evaluation_period === 'custom' && !form.custom_start_date) {
    errors.custom_start_date = 'Informe a data de início do período personalizado.';
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RuleFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: AutomationRule;
  onSave: (data: any) => Promise<void>;
  isSaving: boolean;
  connections?: Array<{ id: string; ad_account_id: string; account_name: string | null }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuleFormModal({
  open,
  onOpenChange,
  rule,
  onSave,
  isSaving,
  connections = [],
}: RuleFormModalProps) {
  const isEditMode = !!rule;
  const [form, setForm] = useState(buildDefaultFormState);
  const [errors, setErrors] = useState<ValidationErrors>({});

  // Reset / pre-fill when modal opens or rule changes
  useEffect(() => {
    if (open) {
      setForm(rule ? buildFormStateFromRule(rule) : buildDefaultFormState());
      setErrors({});
    }
  }, [open, rule]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const showBudgetConfig = BUDGET_ACTIONS.has(form.action_type);
  const showDailyRunTime = form.frequency_minutes === DAILY_FREQUENCY;
  const showCustomDate = form.evaluation_period === 'custom';

  const handleSave = async () => {
    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const { entity, status } = parseTargetValue(form.target);

    const payload: any = {
      name: form.name.trim(),
      connection_id: form.connection_id || undefined,
      target_entity: entity,
      target_status: status,
      name_filter: form.name_filter.trim() || undefined,
      action_type: form.action_type,
      evaluation_period: form.evaluation_period,
      custom_start_date: showCustomDate ? form.custom_start_date : undefined,
      frequency_minutes: form.frequency_minutes,
      daily_run_time: showDailyRunTime ? form.daily_run_time : undefined,
      conditions: form.conditions,
    };

    if (showBudgetConfig) {
      payload.budget_adjustment = {
        mode: form.budget.mode,
        value: parseFloat(form.budget.value) || 0,
        budget_type: form.budget.budget_type,
        min_budget: form.budget.min_budget ? parseFloat(form.budget.min_budget) : undefined,
        max_budget: form.budget.max_budget ? parseFloat(form.budget.max_budget) : undefined,
      };
    }

    await onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Regra' : 'Nova Regra de Automação'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Altere as configurações da regra de automação.'
              : 'Configure uma nova regra para automatizar ações nas suas campanhas.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Nome da regra */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Nome da regra</Label>
            <Input
              id="rule-name"
              placeholder="Ex: Pausar campanhas com CPA alto"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* Conta de Anúncio */}
          <div className="space-y-1.5">
            <Label>Conta de Anúncio</Label>
            <Select
              value={form.connection_id || '__all__'}
              onValueChange={(v) => set('connection_id', v === '__all__' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {connections.map((conn) => (
                  <SelectItem key={conn.id} value={conn.id}>
                    {conn.account_name || conn.ad_account_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Aplicar regra a */}
          <div className="space-y-1.5">
            <Label>Aplicar regra a</Label>
            <Select value={form.target} onValueChange={(v) => set('target', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filtrar por nome */}
          <div className="space-y-1.5">
            <Label htmlFor="name-filter">Filtrar por nome <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Input
              id="name-filter"
              placeholder="Deixe em branco para qualquer nome"
              value={form.name_filter}
              onChange={(e) => set('name_filter', e.target.value)}
            />
          </div>

          {/* Ação */}
          <div className="space-y-1.5">
            <Label>Ação</Label>
            <Select value={form.action_type} onValueChange={(v) => set('action_type', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Configuração de Orçamento */}
          {showBudgetConfig && (
            <BudgetConfig
              value={form.budget}
              onChange={(budget) => set('budget', budget)}
            />
          )}

          {/* Condições */}
          <div className="space-y-1.5">
            <ConditionBuilder
              conditions={form.conditions}
              onChange={(conditions) => set('conditions', conditions)}
            />
            {errors.conditions && (
              <p className="text-xs text-destructive">{errors.conditions}</p>
            )}
          </div>

          {/* Período de Cálculo */}
          <div className="space-y-1.5">
            <Label>Período de Cálculo</Label>
            <Select
              value={form.evaluation_period}
              onValueChange={(v) => set('evaluation_period', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Data de início (period = custom) */}
          {showCustomDate && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-start-date">Data de início</Label>
              <Input
                id="custom-start-date"
                type="date"
                value={form.custom_start_date}
                onChange={(e) => set('custom_start_date', e.target.value)}
              />
              {errors.custom_start_date && (
                <p className="text-xs text-destructive">{errors.custom_start_date}</p>
              )}
            </div>
          )}

          {/* Frequência */}
          <div className="space-y-1.5">
            <Label>Frequência</Label>
            <Select
              value={String(form.frequency_minutes)}
              onValueChange={(v) => set('frequency_minutes', Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Horário (frequency = 1440) */}
          {showDailyRunTime && (
            <div className="space-y-1.5">
              <Label htmlFor="daily-run-time">
                Horário <span className="text-muted-foreground text-xs">Fuso: America/Sao_Paulo (BRT)</span>
              </Label>
              <Input
                id="daily-run-time"
                type="time"
                value={form.daily_run_time}
                onChange={(e) => set('daily_run_time', e.target.value)}
              />
              {errors.daily_run_time && (
                <p className="text-xs text-destructive">{errors.daily_run_time}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Salvar alterações' : 'Criar regra'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
