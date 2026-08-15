import { Pencil, ClipboardList, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { AutomationRule } from '@/hooks/useAutomationRules';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RuleCardProps {
  rule: AutomationRule;
  onToggle: (id: string) => void;
  onEdit: (rule: AutomationRule) => void;
  onHistory: (rule: AutomationRule) => void;
  onDelete: (id: string) => void;
  ruleLimitReached?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFrequency(minutes: number, dailyRunTime: string | null): string {
  if (minutes === 1440) {
    const time = dailyRunTime ?? '00:00';
    return `Uma vez/dia (${time})`;
  }
  if (minutes >= 60) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours}h`;
  }
  return `${minutes} min`;
}

function formatAction(
  actionType: AutomationRule['action_type'],
  budgetAdjustment: AutomationRule['budget_adjustment'],
): string {
  switch (actionType) {
    case 'activate':
      return 'Ativar';
    case 'pause':
      return 'Pausar';
    case 'increase_budget': {
      if (budgetAdjustment?.mode === 'percentage') {
        return `Aumentar orçamento +${budgetAdjustment.value}%`;
      }
      return 'Aumentar orçamento';
    }
    case 'decrease_budget': {
      if (budgetAdjustment?.mode === 'percentage') {
        return `Diminuir orçamento -${budgetAdjustment.value}%`;
      }
      return 'Diminuir orçamento';
    }
    default:
      return actionType;
  }
}

const ENTITY_LABELS: Record<AutomationRule['target_entity'], string> = {
  campaign: 'Campanhas',
  adset: 'Conjuntos',
  ad: 'Anúncios',
};

const STATUS_LABELS: Record<AutomationRule['target_status'], string> = {
  active: 'Ativas',
  paused: 'Pausadas',
  any: 'Qualquer',
};

const METRIC_LABELS: Record<string, string> = {
  spend: 'Gasto',
  cpa: 'CPA',
  roi: 'ROI',
  roas: 'ROAS',
  profit: 'Lucro',
  profit_margin: 'Margem',
  cpc: 'CPC',
  ctr: 'CTR',
  cpm: 'CPM',
  impressions: 'Impressões',
  clicks: 'Cliques',
  conversions: 'Conversões',
};

const OPERATOR_SYMBOLS: Record<string, string> = {
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};

const CURRENCY_METRICS = new Set(['spend', 'cpa', 'profit', 'cpc', 'cpm']);

function formatConditionValue(metric: string, value: number): string {
  if (CURRENCY_METRICS.has(metric)) {
    return `R$${value}`;
  }
  return String(value);
}

function summarizeConditionsFormatted(conditions: AutomationRule['conditions']): string {
  if (conditions.length === 0) return 'Sem condições';
  return conditions
    .map((c) => {
      const metric = METRIC_LABELS[c.metric] ?? c.metric;
      const op = OPERATOR_SYMBOLS[c.operator] ?? c.operator;
      const val = formatConditionValue(c.metric, c.value);
      return `${metric} ${op} ${val}`;
    })
    .join(' E ');
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;

  const diffD = Math.floor(diffH / 24);
  return `há ${diffD}d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuleCard({ rule, onToggle, onEdit, onHistory, onDelete, ruleLimitReached }: RuleCardProps) {
  const entityLabel = ENTITY_LABELS[rule.target_entity] ?? rule.target_entity;
  const statusLabel = STATUS_LABELS[rule.target_status] ?? rule.target_status;
  const frequencyLabel = formatFrequency(rule.frequency_minutes, rule.daily_run_time);
  const actionLabel = formatAction(rule.action_type, rule.budget_adjustment);
  const conditionsSummary = summarizeConditionsFormatted(rule.conditions);

  const borderColor = rule.is_active ? '#4ade80' : '#6b7280';
  const cardOpacity = rule.is_active ? '' : 'opacity-60';

  return (
    <div
      className={`rounded-lg border bg-card p-4 shadow-sm transition-opacity ${cardOpacity}`}
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold text-foreground">{rule.name}</span>
          <Badge
            variant={rule.is_active ? 'default' : 'secondary'}
            className={rule.is_active ? 'bg-green-500/20 text-green-400' : ''}
          >
            {rule.is_active ? 'Ativa' : 'Inativa'}
          </Badge>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={rule.is_active}
            onCheckedChange={() => onToggle(rule.id)}
            disabled={!rule.is_active && ruleLimitReached}
            title={!rule.is_active && ruleLimitReached ? 'Limite de regras ativas atingido. Faça upgrade.' : undefined}
            aria-label={rule.is_active ? 'Desativar regra' : 'Ativar regra'}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onEdit(rule)}
            title="Editar regra"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onHistory(rule)}
            title="Ver histórico"
          >
            <ClipboardList className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onDelete(rule.id)}
            title="Excluir regra"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary line */}
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {entityLabel} {statusLabel}
        </span>
        {' · '}
        <span>{frequencyLabel}</span>
        {' · '}
        <span>{actionLabel}</span>
        {' · '}
        <span>{conditionsSummary}</span>
      </p>

      {/* Last execution */}
      <div className="mt-2 text-xs text-muted-foreground">
        {rule.last_executed_at ? (
          <span>Última execução: {formatRelativeTime(rule.last_executed_at)}</span>
        ) : (
          <span>Ainda não executada</span>
        )}
      </div>
    </div>
  );
}
