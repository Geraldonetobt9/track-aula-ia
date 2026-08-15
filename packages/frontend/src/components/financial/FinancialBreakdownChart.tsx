import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface FinancialBreakdownChartProps {
  grossRevenue: number;
  adSpend: number;
  totalExpenses: number;
  totalRevenues: number;
  profit: number;
  loading: boolean;
}

interface Segment {
  name: string;
  value: number;
  color: string;
  pct: number;
}

const SEGMENT_CONFIG: { key: string; label: string; color: string }[] = [
  { key: 'grossRevenue', label: 'Faturamento Bruto', color: '#6366f1' },
  { key: 'adSpend',      label: 'Gasto com Ads',     color: '#ef4444' },
  { key: 'totalExpenses', label: 'Outros Gastos',     color: '#f97316' },
  { key: 'totalRevenues', label: 'Outras Receitas',   color: '#3b82f6' },
  { key: 'profit',        label: 'Lucro',             color: '#22c55e' },
];

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: Segment }[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-xl">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
        <span className="text-sm font-medium text-foreground">{item.name}</span>
      </div>
      <p className="text-xs text-muted-foreground pl-[18px]">
        {formatCurrency(item.value)} · {item.pct.toFixed(1)}%
      </p>
    </div>
  );
}

export function FinancialBreakdownChart({
  grossRevenue,
  adSpend,
  totalExpenses,
  totalRevenues,
  profit,
  loading,
}: FinancialBreakdownChartProps) {
  const values: Record<string, number> = {
    grossRevenue,
    adSpend,
    totalExpenses,
    totalRevenues,
    profit: Math.max(profit, 0),
  };

  const segments: Segment[] = useMemo(() => {
    const total = SEGMENT_CONFIG.reduce((sum, cfg) => sum + Math.abs(values[cfg.key] || 0), 0);
    return SEGMENT_CONFIG
      .filter((cfg) => (values[cfg.key] || 0) > 0)
      .map((cfg) => ({
        name: cfg.label,
        value: values[cfg.key],
        color: cfg.color,
        pct: total > 0 ? (values[cfg.key] / total) * 100 : 0,
      }));
  }, [grossRevenue, adSpend, totalExpenses, totalRevenues, profit]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Composição Financeira</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (segments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Composição Financeira</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
            Sem dados para o período selecionado
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Composição Financeira</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row items-center gap-6 min-h-[280px]">
          {/* Pie Chart */}
          <div className="w-full md:w-1/2 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={segments}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={105}
                  innerRadius={55}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {segments.map((seg, i) => (
                    <Cell key={i} fill={seg.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Custom Legend */}
          <div className="w-full md:w-1/2 flex flex-col gap-3">
            {segments.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-sm text-muted-foreground">{seg.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {formatCurrency(seg.value)}
                  </span>
                  <span
                    className="text-xs font-semibold rounded-full px-2 py-0.5 min-w-[48px] text-center"
                    style={{
                      backgroundColor: `${seg.color}20`,
                      color: seg.color,
                    }}
                  >
                    {seg.pct.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
