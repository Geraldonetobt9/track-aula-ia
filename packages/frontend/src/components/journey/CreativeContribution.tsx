import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useChartColors } from '@/hooks/useChartColors';
import { cn } from '@/lib/utils';
import type { JourneyCreative as Row } from '@/hooks/useTracking';
import { brl } from './format';

const brlShort = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(v);
const count = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const int = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
/** 2,35x; sem gasto não há ROI — traço, não zero. */
const roiLabel = (v: number | null) =>
  v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;

const CHART_TOP = 10;

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Quanto cada criativo vendeu sozinho (last click) e quanto ajudou a vender.
 * O gasto é o mesmo período de Campanhas, somado por anúncio.
 */
export function CreativeContributionCard({
  creatives,
  loading,
  selected,
  onSelect,
}: {
  creatives: Row[];
  loading: boolean;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const chart = useChartColors();
  const top = creatives
    .filter((c) => c.lastClickRevenue + c.assistedRevenue > 0)
    .sort((a, b) => b.lastClickRevenue + b.assistedRevenue - (a.lastClickRevenue + a.assistedRevenue))
    .slice(0, CHART_TOP)
    .map((c) => ({ ...c, label: truncate(c.name, 28) }));

  const axis = {
    stroke: chart.withAlpha('--foreground', 0.15),
    tick: { fill: chart.muted, fontSize: 11 },
    tickLine: false,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contribuição dos criativos</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">Vendeu</span> é a venda em que o criativo foi o último clique
          antes da compra. <span className="font-medium text-foreground">Ajudou</span> é a venda de outro criativo em
          que este apareceu antes, na jornada da mesma pessoa. O gasto é o da Meta no período, o mesmo de Campanhas.
          Clique numa linha para ver só as jornadas dele.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <Skeleton className="h-[260px] w-full bg-foreground/5" />
        ) : creatives.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground/70">
            Nenhum criativo com venda ou gasto neste período.
          </p>
        ) : (
          <>
            {top.length > 0 && (
              <div className="w-full" style={{ height: Math.max(160, top.length * 34 + 50) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.withAlpha('--foreground', 0.05)} horizontal={false} />
                    <XAxis type="number" {...axis} tickFormatter={brlShort} />
                    <YAxis type="category" dataKey="label" {...axis} width={190} />
                    <Tooltip
                      contentStyle={{ backgroundColor: chart.background, border: `1px solid ${chart.border}`, borderRadius: '10px' }}
                      labelStyle={{ color: chart.foreground, fontWeight: 500 }}
                      cursor={{ fill: chart.withAlpha('--foreground', 0.05) }}
                      labelFormatter={(_, payload) => (payload?.[0]?.payload as Row | undefined)?.name ?? ''}
                      formatter={(value, name, item) => {
                        const v = Number(value ?? 0);
                        const r = item?.payload as Row;
                        return name === 'lastClickRevenue'
                          ? [`${brl(v)} · ${count(r.lastClickSales)} vendas`, 'Vendeu (last click)']
                          : [`${brl(v)} · ${count(r.assistedSales)} vendas`, 'Ajudou a vender'];
                      }}
                    />
                    <Legend
                      formatter={(v: string) => (v === 'lastClickRevenue' ? 'Vendeu (last click)' : 'Ajudou a vender')}
                      wrapperStyle={{ fontSize: 12, color: chart.muted }}
                    />
                    <Bar dataKey="lastClickRevenue" stackId="c" fill={chart.primary} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="assistedRevenue" stackId="c" fill={chart.withAlpha('--primary', 0.35)} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Criativo</TableHead>
                    <TableHead className="text-right">Impressões</TableHead>
                    <TableHead className="text-right">Gasto</TableHead>
                    <TableHead className="text-right">Vendeu (último clique)</TableHead>
                    <TableHead className="text-right">Contribuiu para venda</TableHead>
                    <TableHead className="text-right" title="Compras que o pixel da Meta atribuiu ao anúncio no período">
                      Vendas na Meta
                    </TableHead>
                    <TableHead className="text-right" title="Receita do último clique ÷ gasto">
                      ROI último clique
                    </TableHead>
                    <TableHead className="text-right" title="(Receita do último clique + receita das vendas em que ajudou) ÷ gasto">
                      ROI total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creatives.map((c) => (
                    <TableRow
                      key={c.key}
                      onClick={() => onSelect(selected === c.key ? null : c.key)}
                      className={cn('cursor-pointer', selected === c.key && 'bg-primary/10 hover:bg-primary/10')}
                      aria-selected={selected === c.key}
                    >
                      <TableCell className="max-w-[260px]">
                        <p className="truncate font-medium" title={c.name}>{c.name}</p>
                        {c.campaignName && (
                          <p className="truncate text-xs text-muted-foreground" title={c.campaignName}>{c.campaignName}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.impressions > 0 ? int(c.impressions) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.spend > 0 ? brl(c.spend) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <p>{brl(c.lastClickRevenue)}</p>
                        <p className="text-xs text-muted-foreground">
                          {count(c.lastClickSales)} {c.lastClickSales === 1 ? 'venda' : 'vendas'}
                        </p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <p>{brl(c.assistedRevenue)}</p>
                        <p className="text-xs text-muted-foreground">
                          {count(c.assistedSales)} {c.assistedSales === 1 ? 'venda' : 'vendas'} de outros
                        </p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.spend > 0 || c.metaPurchases > 0 ? int(c.metaPurchases) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{roiLabel(c.roiLastClick)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{roiLabel(c.roiTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
