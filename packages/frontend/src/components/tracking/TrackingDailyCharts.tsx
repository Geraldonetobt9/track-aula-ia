import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useChartColors } from '@/hooks/useChartColors';
import { cn } from '@/lib/utils';
import type { TrackingDailyPoint } from '@/hooks/useTracking';

function shortDate(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/**
 * Visitantes e vendas por dia, em dois gráficos empilhados sobre o mesmo eixo
 * de datas — e não um gráfico com dois eixos Y. Com duas escalas, o cruzamento
 * das linhas depende só de onde cada eixo começa e não significa nada;
 * empilhados, cada número fica na sua escala e o dia continua alinhado.
 */
export function TrackingDailyCharts({
  daily,
  loading,
  blurValues,
}: {
  daily: TrackingDailyPoint[];
  loading: boolean;
  blurValues?: boolean;
}) {
  const chart = useChartColors();
  const data = daily.map((d) => ({ ...d, label: shortDate(d.date) }));

  const axis = {
    stroke: chart.withAlpha('--foreground', 0.15),
    tick: { fill: chart.muted, fontSize: 11 },
    tickLine: false,
  };
  const tooltip = {
    contentStyle: { backgroundColor: chart.background, border: `1px solid ${chart.border}`, borderRadius: '10px' },
    labelStyle: { color: chart.muted },
    cursor: { stroke: chart.withAlpha('--foreground', 0.2), fill: chart.withAlpha('--foreground', 0.05) },
  };

  return (
    <Card className={cn(loading && 'opacity-50')}>
      <CardHeader>
        <CardTitle>Visitantes e vendas por dia</CardTitle>
        <CardDescription>Mesmas datas, cada número na sua escala.</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-2 transition-[filter] duration-200 ease-out', blurValues && 'blur-md select-none pointer-events-none')}>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Visitantes únicos</p>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId="tracking-daily" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.withAlpha('--foreground', 0.05)} vertical={false} />
              <XAxis dataKey="label" {...axis} hide />
              <YAxis {...axis} width={40} allowDecimals={false} />
              <Tooltip {...tooltip} formatter={(v: number) => [v.toLocaleString('pt-BR'), 'Visitantes']} />
              <Line
                type="linear"
                dataKey="visitors"
                stroke={chart.primary}
                strokeWidth={2}
                dot={data.length <= 31 ? { r: 2, fill: chart.primary, strokeWidth: 0 } : false}
                activeDot={{ r: 4, fill: chart.primary, strokeWidth: 2, stroke: chart.background }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground pt-2">Vendas aprovadas</p>
        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} syncId="tracking-daily" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.withAlpha('--foreground', 0.05)} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={16} />
              <YAxis {...axis} width={40} allowDecimals={false} />
              <Tooltip {...tooltip} formatter={(v: number) => [v.toLocaleString('pt-BR'), 'Vendas']} />
              <Bar dataKey="sales" fill={chart.primary} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
