import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useRuleHistory } from '@/hooks/useRuleHistory';
import type { AutomationRule } from '@/hooks/useAutomationRules';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RuleHistoryDrawerProps {
  rule: AutomationRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

function formatMetricValue(key: string, value: number): string {
  const currencyKeys = new Set(['spend', 'cpa', 'profit', 'cpc', 'cpm']);
  const percentKeys = new Set(['ctr', 'profit_margin']);
  if (currencyKeys.has(key)) return `R$${value.toFixed(2)}`;
  if (percentKeys.has(key)) return `${value.toFixed(2)}%`;
  return String(value);
}

function MetricsSnapshot({ snapshot }: { snapshot: Record<string, number> }) {
  const entries = Object.entries(snapshot).slice(0, 4);
  if (entries.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {entries.map(([key, value]) => (
        <span key={key} className="text-xs text-muted-foreground">
          <span className="font-medium">{METRIC_LABELS[key] ?? key}:</span>{' '}
          {formatMetricValue(key, value)}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuleHistoryDrawer({ rule, open, onOpenChange }: RuleHistoryDrawerProps) {
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useRuleHistory(rule?.id ?? null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Histórico: {rule?.name ?? '—'}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">Erro ao carregar histórico: {error}</p>
          )}

          {!isLoading && items.length === 0 && !error && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma execução registrada ainda.
            </p>
          )}

          {items.map((execution) => (
            <div
              key={execution.id}
              className="rounded-md border bg-card p-3 text-sm"
            >
              {/* Entity name + action */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {execution.entity_name ?? execution.entity_facebook_id ?? 'Entidade desconhecida'}
                  </p>
                  {execution.action_taken && (
                    <p className="text-xs text-muted-foreground">{execution.action_taken}</p>
                  )}
                </div>
                <Badge
                  variant={execution.status === 'success' ? 'default' : execution.status === 'error' ? 'destructive' : 'secondary'}
                  className={
                    execution.status === 'success'
                      ? 'bg-green-500/20 text-green-400'
                      : ''
                  }
                >
                  {execution.status === 'success'
                    ? 'Sucesso'
                    : execution.status === 'error'
                    ? 'Erro'
                    : 'Ignorado'}
                </Badge>
              </div>

              {/* Metrics snapshot */}
              {execution.metrics_snapshot && (
                <MetricsSnapshot snapshot={execution.metrics_snapshot} />
              )}

              {/* Error message */}
              {execution.status === 'error' && execution.error_message && (
                <p className="mt-1 text-xs text-destructive">{execution.error_message}</p>
              )}

              {/* Timestamp */}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formatTimestamp(execution.executed_at)}
              </p>
            </div>
          ))}

          {/* Load more */}
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Carregar mais...
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
