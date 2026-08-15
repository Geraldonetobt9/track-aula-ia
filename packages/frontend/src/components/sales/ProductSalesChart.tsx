import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ProductBreakdownEntry } from '@/hooks/useSalesSummary';
import { useChartColors } from '@/hooks/useChartColors';

interface ProductSalesChartProps {
  data: ProductBreakdownEntry[];
  loading: boolean;
}

export function ProductSalesChart({ data, loading }: ProductSalesChartProps) {
  const chart = useChartColors();
  const COLORS = chart.series;

  const productData = useMemo(() => {
    const totalCount = data.reduce((sum, d) => sum + d.count, 0);
    return data
      .map((d) => ({
        name: d.product_name.length > 20 ? d.product_name.slice(0, 18) + '…' : d.product_name,
        fullName: d.product_name,
        qty: d.count,
        revenue: Number(d.revenue) || 0,
        pct: totalCount > 0 ? (d.count / totalCount) * 100 : 0,
      }))
      .slice(0, 8);
  }, [data]);

  const formatCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Vendas por Produto</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[280px] w-full bg-foreground/5" /></CardContent>
      </Card>
    );
  }

  if (productData.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Vendas por Produto</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground/70">
            Nenhuma venda no período
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Vendas por Produto</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          {/* Bar Chart */}
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productData} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis
                  type="number"
                  stroke={chart.border}
                  tick={{ fill: chart.muted, fontSize: 11 }}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  stroke={chart.border}
                  tick={{ fill: chart.muted, fontSize: 11 }}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: chart.withAlpha('--foreground', 0.05) }}
                  contentStyle={{
                    backgroundColor: chart.background,
                    border: `1px solid ${chart.border}`,
                    borderRadius: '10px',
                  }}
                  labelStyle={{ color: chart.muted }}
                  itemStyle={{ color: chart.accent }}
                  formatter={(value: number) => [formatCurrency(value), 'Faturamento']}
                  labelFormatter={(label) => {
                    const item = productData.find(p => p.name === label);
                    return item?.fullName || label;
                  }}
                />
                <Bar dataKey="revenue" radius={[0, 6, 6, 0]} maxBarSize={28}>
                  {productData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Summary Table */}
          <div className="space-y-1.5 overflow-auto max-h-[280px]">
            <div className="grid grid-cols-[1fr_3rem_3.5rem_5.5rem] gap-x-3 pb-2 border-b border-foreground/5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Produto</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 text-right">Qtd</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 text-right">%</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 text-right">Total</span>
            </div>
            {productData.map((p, i) => (
              <div
                key={p.fullName}
                className="grid grid-cols-[1fr_3rem_3.5rem_5.5rem] gap-x-3 items-center py-1.5 border-b border-foreground/[0.03] last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-sm text-muted-foreground truncate" title={p.fullName}>
                    {p.fullName}
                  </span>
                </div>
                <span className="text-sm font-medium text-foreground tabular-nums text-right">{p.qty}</span>
                <span className="text-sm text-muted-foreground/70 tabular-nums text-right">
                  {p.pct.toFixed(1)}%
                </span>
                <span className="text-sm font-medium text-accent-readable tabular-nums text-right whitespace-nowrap">
                  R$ {p.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
