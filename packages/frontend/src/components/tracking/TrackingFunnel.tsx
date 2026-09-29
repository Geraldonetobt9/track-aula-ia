import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPercent, type FunnelData } from '@/hooks/useTracking';

/**
 * Visitantes → clicaram em comprar → compraram, em barras horizontais sobre a
 * mesma escala. Uma série só, uma cor: a etapa é dita pelo rótulo, não pela
 * tonalidade. Cada barra traz o número e a taxa escritos ao lado, então não
 * depende de hover para ser lida.
 */
export function TrackingFunnel({ funnel, loading }: { funnel: FunnelData | null; loading: boolean }) {
  const f = funnel ?? { visitors: 0, checkoutClicks: 0, sales: 0, checkoutRate: 0, purchaseRate: 0 };
  const max = Math.max(f.visitors, f.checkoutClicks, f.sales, 1);

  const steps = [
    { label: 'Visitantes', value: f.visitors, note: null },
    {
      label: 'Clicaram no checkout',
      value: f.checkoutClicks,
      note: `${formatPercent(f.checkoutRate)} dos visitantes`,
    },
    { label: 'Compraram', value: f.sales, note: `${formatPercent(f.purchaseRate)} dos visitantes` },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil</CardTitle>
        <CardDescription>Pessoas únicas em cada etapa, no período.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step) => (
          <div key={step.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{step.label}</span>
              {loading ? (
                <Skeleton className="h-4 w-16 bg-foreground/5" />
              ) : (
                <span className="tabular-nums">
                  <span className="font-medium text-foreground">{step.value.toLocaleString('pt-BR')}</span>
                  {step.note && <span className="ml-2 text-xs text-muted-foreground">{step.note}</span>}
                </span>
              )}
            </div>
            <div className="h-3 w-full rounded-full bg-foreground/5">
              <div
                className="h-3 rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: loading ? '0%' : `${Math.max((step.value / max) * 100, step.value > 0 ? 1 : 0)}%` }}
                role="img"
                aria-label={`${step.label}: ${step.value}`}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground/70 pt-1">
          Vendas são todos os pedidos aprovados do período, como no Dashboard — mesmo os que não tiveram a
          visita rastreada.
        </p>
      </CardContent>
    </Card>
  );
}
