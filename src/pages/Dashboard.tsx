import { useQuery } from '@tanstack/react-query';
import { DollarSign, Megaphone, TrendingUp, Target, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

interface DashboardMetrics {
  gross_revenue: number;
  sales_count: number;
  ad_spend: number;
  profit: number;
  roas: number;
  lifetime_revenue: number;
  chart_data: Array<{ date: string; revenue: number }>;
  recent_sales: Array<{ id: string; product_name: string | null; sold_at: string; amount: number }>;
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardMetrics>('/metrics/dashboard'),
    staleTime: 60_000,
  });

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const profit = data?.profit ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gasto com anúncios contra vendas reais.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Faturamento"
          value={money(data?.gross_revenue)}
          icon={DollarSign}
          loading={isLoading}
        />
        <Metric
          label="Gasto com ads"
          value={money(data?.ad_spend)}
          icon={Megaphone}
          loading={isLoading}
        />
        <Metric
          label="Lucro"
          value={money(profit)}
          icon={TrendingUp}
          loading={isLoading}
          tone={profit >= 0 ? 'positive' : 'negative'}
        />
        <Metric
          label="ROAS"
          value={data ? `${data.roas.toFixed(2)}x` : '—'}
          icon={Target}
          loading={isLoading}
        />
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Últimas vendas</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : !data?.recent_sales.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma venda ainda. Conecte um checkout em Integrações para começar a receber.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.recent_sales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="truncate">{sale.product_name ?? 'Sem produto'}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {money(sale.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  loading,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  loading: boolean;
  tone?: 'positive' | 'negative';
}) {
  return (
    <Card className="glass-card">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground/70" strokeWidth={1.5} />
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-28" />
        ) : (
          <p
            className={cn(
              'mt-1 text-2xl font-semibold tabular-nums',
              tone === 'positive' && 'text-success',
              tone === 'negative' && 'text-destructive',
            )}
          >
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function money(value: number | undefined): string {
  return (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
