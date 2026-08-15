import { usePlanUsage } from '@/hooks/usePlanUsage';

type Row = { title: string; used: number; limit: number };

function pctFill(used: number, limit: number): number {
  if (limit === -1) return 100;
  if (limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function fillLabel(used: number, limit: number): string {
  if (limit === -1) return `${used.toLocaleString('pt-BR')} / ∞`;
  return `${used.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')}`;
}

function daysUntil(iso: string): number {
  const end = new Date(iso).getTime();
  const diff = end - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function PlanUsageCard() {
  const { usage, isLoading } = usePlanUsage();

  if (isLoading || !usage) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center rounded-2xl border border-foreground/10 bg-foreground/[0.02]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const rows: Row[] = [
    { title: 'Vendas aprovadas',     used: usage.sales.used,        limit: usage.sales.limit },
    { title: 'Workspaces',           used: usage.workspaces.used,   limit: usage.workspaces.limit },
    { title: 'Contas de anúncio',    used: usage.adAccounts.used,   limit: usage.adAccounts.limit },
    { title: 'Integrações',          used: usage.integrations.used, limit: usage.integrations.limit },
    { title: 'Regras automatizadas', used: usage.activeRules.used,  limit: usage.activeRules.limit },
  ];

  const days = daysUntil(usage.period.end);

  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-6">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Uso do ciclo</h4>
        <span className="text-[11px] text-muted-foreground/70">
          {days === 0 ? 'reseta hoje' : `reseta em ${days} dia${days === 1 ? '' : 's'}`}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const pct = pctFill(r.used, r.limit);
          const isEmpty = r.used === 0;
          return (
            <li key={r.title} className="space-y-1.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted-foreground">{r.title}</span>
                <span className="font-medium text-foreground tabular-nums">{fillLabel(r.used, r.limit)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-foreground/10">
                <div
                  className={`h-full rounded-full transition-all ${isEmpty ? 'bg-foreground/10' : 'bg-primary'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {(usage.sales.blocked > 0 || usage.overage.count > 0) && (
        <div className="mt-auto space-y-2 pt-1">
          {usage.sales.blocked > 0 && (
            <div className="rounded-md border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
              <strong>{usage.sales.blocked}</strong> venda{usage.sales.blocked !== 1 ? 's' : ''} bloqueada
              {usage.sales.blocked !== 1 ? 's' : ''} este ciclo. Faça upgrade para processá-las.
            </div>
          )}
          {usage.overage.count > 0 && (
            <div className="rounded-md border border-foreground/10 bg-foreground/5 p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">{usage.overage.count}</strong> venda
              {usage.overage.count !== 1 ? 's' : ''} extra{usage.overage.count !== 1 ? 's' : ''} · total a
              cobrar: R$ {(usage.overage.totalCents / 100).toFixed(2).replace('.', ',')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
