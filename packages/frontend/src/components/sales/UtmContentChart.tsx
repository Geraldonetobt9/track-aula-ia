import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import type { AdBreakdownEntry } from '@/hooks/useSalesSummary';
import { useChartColors } from '@/hooks/useChartColors';

interface UtmContentChartProps {
  data: AdBreakdownEntry[];
  loading: boolean;
}

function CustomContent(props: any) {
  const { x, y, width, height, index, name, qty, pct, colors, qtyTextColor, pctTextColor } = props;
  if (!width || !height || width < 4 || height < 4 || !name) return null;

  const palette: string[] = colors;
  const color = palette[index % palette.length];
  const padding = 2;
  const rx = x + padding;
  const ry = y + padding;
  const rw = width - padding * 2;
  const rh = height - padding * 2;

  if (rw < 2 || rh < 2) return null;

  const showName = rw > 45 && rh > 28;
  const showQty = rw > 35 && rh > 44;
  const showPct = rw > 50 && rh > 58;

  const fontSize = Math.min(Math.max(rw / 10, 10), 14);
  const qtyFontSize = Math.min(Math.max(rw / 7, 14), 24);

  return (
    <g>
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        rx={10}
        ry={10}
        fill={color}
        fillOpacity={0.18}
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.5}
      />
      {showName && (
        <foreignObject x={rx + 8} y={ry + 6} width={rw - 16} height={fontSize + 4}>
          <div
            style={{
              color,
              fontSize: `${fontSize}px`,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
            }}
            title={name}
          >
            {name}
          </div>
        </foreignObject>
      )}
      {showQty && (
        <text
          x={rx + 10}
          y={ry + fontSize + 10 + qtyFontSize}
          fill={qtyTextColor}
          fontSize={qtyFontSize}
          fontWeight={700}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {qty}
        </text>
      )}
      {showPct && (
        <text
          x={rx + 10}
          y={ry + fontSize + 14 + qtyFontSize + 14}
          fill={pctTextColor}
          fontSize={11}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {(pct ?? 0).toFixed(1)}%
        </text>
      )}
    </g>
  );
}

export function UtmContentChart({ data, loading }: UtmContentChartProps) {
  const chart = useChartColors();
  const COLORS = chart.series;

  const adData = useMemo(() => {
    const totalCount = data.reduce((sum, d) => sum + d.count, 0);
    return data.map((d) => {
      const trimmed = d.name.split('|')[0].split('/')[0].trim();
      return {
        name: trimmed,
        size: d.count,
        qty: d.count,
        revenue: Number(d.revenue) || 0,
        pct: totalCount > 0 ? (d.count / totalCount) * 100 : 0,
      };
    });
  }, [data]);

  const formatCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Vendas por Anúncio</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-[350px] w-full bg-foreground/5 rounded-xl" /></CardContent>
      </Card>
    );
  }

  if (adData.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Vendas por Anúncio</CardTitle></CardHeader>
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
        <CardTitle>Vendas por Anúncio</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={adData}
              dataKey="size"
              aspectRatio={4 / 3}
              stroke="none"
              content={
                <CustomContent
                  colors={COLORS}
                  qtyTextColor={chart.foreground}
                  pctTextColor={chart.muted}
                />
              }
            >
              <Tooltip
                content={({ payload }) => {
                  if (!payload || !payload.length) return null;
                  const item = payload[0]?.payload;
                  if (!item) return null;
                  return (
                    <div
                      className="rounded-xl px-3 py-2.5 shadow-lg border border-border bg-popover text-popover-foreground"
                    >
                      <p className="text-xs font-semibold mb-1 text-accent-readable">{item.name}</p>
                      <p className="text-sm text-foreground font-medium">{item.qty} vendas ({item.pct.toFixed(1)}%)</p>
                      <p className="text-sm text-accent-readable font-medium mt-0.5">{formatCurrency(item.revenue)}</p>
                    </div>
                  );
                }}
              />
            </Treemap>
          </ResponsiveContainer>
        </div>

        {/* Summary Table */}
        <div className="mt-4 space-y-1.5 overflow-auto max-h-[200px]">
          <div className="grid grid-cols-[1fr_3rem_3.5rem_5.5rem] gap-x-3 pb-2 border-b border-foreground/5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Anúncio</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 text-right">Qtd</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 text-right">%</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 text-right">Total</span>
          </div>
          {adData.map((item, i) => (
            <div
              key={item.name + i}
              className="grid grid-cols-[1fr_3rem_3.5rem_5.5rem] gap-x-3 items-center py-1.5 border-b border-foreground/[0.03] last:border-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="text-sm text-muted-foreground truncate" title={item.name}>
                  {item.name}
                </span>
              </div>
              <span className="text-sm font-medium text-foreground tabular-nums text-right">{item.qty}</span>
              <span className="text-sm text-muted-foreground/70 tabular-nums text-right">
                {item.pct.toFixed(1)}%
              </span>
              <span className="text-sm font-medium text-accent-readable tabular-nums text-right whitespace-nowrap">
                {formatCurrency(item.revenue)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
