import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
    return <p className="text-sm text-red-400">{(error as Error).message}</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Gasto com anúncios contra vendas reais.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Faturamento" value={money(data?.gross_revenue)} loading={isLoading} />
        <Metric label="Gasto com ads" value={money(data?.ad_spend)} loading={isLoading} />
        <Metric
          label="Lucro"
          value={money(data?.profit)}
          loading={isLoading}
          tone={(data?.profit ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <Metric label="ROAS" value={data ? `${data.roas.toFixed(2)}x` : '—'} loading={isLoading} />
      </div>

      <section className="card">
        <h2 className="font-medium">Últimas vendas</h2>
        {isLoading ? (
          <p className="mt-3 text-sm text-muted">Carregando…</p>
        ) : !data?.recent_sales.length ? (
          <p className="mt-3 text-sm text-muted">
            Nenhuma venda ainda. Conecte um checkout em Integrações para começar a receber.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.recent_sales.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="truncate">{sale.product_name ?? 'Sem produto'}</span>
                <span className="shrink-0 text-muted">{money(sale.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: string;
  loading: boolean;
  tone?: 'positive' | 'negative';
}) {
  const color = tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-red-400' : '';
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{loading ? '—' : value}</p>
    </div>
  );
}

function money(value: number | undefined): string {
  return (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
