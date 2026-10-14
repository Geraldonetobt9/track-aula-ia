import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Clock, FlaskConical, HelpCircle, Trophy } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChartColors } from '@/hooks/useChartColors';
import { privacyBlurClass } from '@/lib/privacyBlur';
import { cn } from '@/lib/utils';
import {
  formatMoney,
  formatRate,
  GOAL_LABELS,
  goalValue,
  type AbTest,
  type AbVariant,
} from '@/hooks/useAbTests';

function shortDate(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function pctText(value: number) {
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** O que o teste diz até agora, numa frase. */
function Verdict({ test }: { test: AbTest }) {
  const { verdict, leader, samplePerVariant, progress, alpha } = test.summary;
  const leaderVariant = test.variants.find((v) => v.key === leader);
  const confidence = `${Math.round((1 - alpha) * 1000) / 10}%`;

  const content = {
    draft: {
      icon: FlaskConical,
      tone: 'border-foreground/10 bg-foreground/5',
      title: 'Rascunho',
      text: 'Confira as variantes e inicie o teste. Nada é sorteado antes disso.',
    },
    collecting: {
      icon: Clock,
      tone: 'border-info/30 bg-info/5',
      title: 'Coletando dados',
      text: 'Ainda é cedo: com poucos visitantes, qualquer diferença pode ser acaso. Não encerre agora.',
    },
    winner: {
      icon: Trophy,
      tone: 'border-success/40 bg-success/10',
      title: `Variante ${leader} vence${leaderVariant ? ` — ${leaderVariant.name}` : ''}`,
      text: `A diferença em ${GOAL_LABELS[test.goal].toLowerCase()} é estatisticamente significativa (${confidence} de confiança).`,
    },
    control: {
      icon: CheckCircle2,
      tone: 'border-warning/40 bg-warning/10',
      title: 'O original vence',
      text: `Todas as variantes ficaram significativamente abaixo do controle (${confidence} de confiança). Mantenha a página original.`,
    },
    inconclusive: {
      icon: HelpCircle,
      tone: 'border-foreground/10 bg-foreground/5',
      title: 'Sem diferença clara ainda',
      text: 'Há amostra, mas a diferença entre as variantes ainda cabe no acaso. Deixe rodar até completar a amostra sugerida.',
    },
  }[verdict];
  const Icon = content.icon;

  return (
    <div className={cn('rounded-xl border p-4', content.tone)}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-foreground" strokeWidth={1.75} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-foreground">{content.title}</p>
          <p className="text-sm text-muted-foreground">{content.text}</p>
          {verdict !== 'draft' && samplePerVariant && progress !== null && (
            <div className="space-y-1 pt-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Amostra para detectar uma melhora de 20%</span>
                <span className="tabular-nums">
                  {progress}% de {samplePerVariant.toLocaleString('pt-BR')} visitantes por variante
                </span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Lift({ variant }: { variant: AbVariant }) {
  const lift = variant.comparison?.lift;
  if (variant.isControl) return <span className="text-muted-foreground">controle</span>;
  if (lift == null) return <span className="text-muted-foreground">—</span>;
  const up = lift >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium tabular-nums',
        variant.comparison?.significant ? (up ? 'text-success' : 'text-destructive') : 'text-muted-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? '+' : ''}
      {lift.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  );
}

function Significance({ variant }: { variant: AbVariant }) {
  const c = variant.comparison;
  if (variant.isControl || !c) return <span className="text-muted-foreground">—</span>;
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
            c.significant ? 'bg-success/15 text-success' : 'bg-foreground/5 text-muted-foreground',
          )}
        >
          {c.significant ? 'Significativo' : 'Ainda não'}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        p-valor {c.pValue == null ? '—' : c.pValue.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
      </TooltipContent>
    </UiTooltip>
  );
}

export function AbTestResults({ test, blurValues }: { test: AbTest; blurValues?: boolean }) {
  const chart = useChartColors();
  const blur = privacyBlurClass(blurValues);
  const { summary } = test;

  const data = test.daily.map((d) => {
    const row: Record<string, string | number> = { label: shortDate(d.date) };
    for (const [key, v] of Object.entries(d.values)) row[key] = v.rate;
    return row;
  });

  const axis = {
    stroke: chart.withAlpha('--foreground', 0.15),
    tick: { fill: chart.muted, fontSize: 11 },
    tickLine: false,
  };

  return (
    <div className="space-y-4">
      <Verdict test={test} />

      <Card>
        <CardHeader>
          <CardTitle>Variantes</CardTitle>
          <CardDescription>
            Por visitante sorteado, desde o sorteio. Objetivo: {GOAL_LABELS[test.goal].toLowerCase()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variante</TableHead>
                  <TableHead className="text-right">Visitantes</TableHead>
                  <TableHead className="text-right">Checkout</TableHead>
                  <TableHead className="text-right">Compradores</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">{GOAL_LABELS[test.goal]}</TableHead>
                  <TableHead className="text-right">vs. original</TableHead>
                  <TableHead className="text-right">Chance de superar</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {test.variants.map((v) => (
                  <TableRow key={v.id} className={cn(summary.leader === v.key && 'bg-success/5')}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/8 text-xs font-semibold text-foreground">
                          {v.key}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{v.name}</p>
                          {v.url && (
                            <a
                              href={v.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block max-w-[220px] truncate text-xs text-muted-foreground hover:text-foreground"
                            >
                              {v.url.replace(/^https?:\/\//, '')}
                            </a>
                          )}
                        </div>
                        {test.winnerVariantId === v.id && <Trophy className="h-4 w-4 text-success" aria-label="Vencedora" />}
                      </div>
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', blur)}>{v.visitors.toLocaleString('pt-BR')}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', blur)}>
                      {v.checkoutVisitors.toLocaleString('pt-BR')}
                      <span className="block text-xs text-muted-foreground">{formatRate(v.checkoutRate)}</span>
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', blur)}>
                      {v.buyers.toLocaleString('pt-BR')}
                      <span className="block text-xs text-muted-foreground">{formatRate(v.conversionRate)}</span>
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', blur)}>
                      {formatMoney(v.revenue)}
                      <span className="block text-xs text-muted-foreground">{formatMoney(v.revenuePerVisitor)}/visitante</span>
                    </TableCell>
                    <TableCell className={cn('text-right font-semibold tabular-nums text-foreground', blur)}>
                      {goalValue(test.goal, v)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Lift variant={v} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.isControl || v.comparison?.chanceToBeat == null ? '—' : pctText(v.comparison.chanceToBeat)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Significance variant={v} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 space-y-1 px-6 text-xs text-muted-foreground sm:px-0">
            {summary.totalOrders > 0 && (
              <p>
                {summary.ordersIndexed.toLocaleString('pt-BR')} de {summary.totalOrders.toLocaleString('pt-BR')} pedidos do
                teste chegaram pelo indexador (sck) — o vínculo exato entre a venda e a visita. Os demais foram ligados
                pelo fbclid ou pelas UTMs.
              </p>
            )}
            {test.status !== 'draft' && summary.unmatchedSales > 0 && (
              <p>
                {summary.unmatchedSales.toLocaleString('pt-BR')} vendas aprovadas no período do teste não foram ligadas a
                nenhuma visita e ficam de fora. Se forem muitas, confira em Integrações se a plataforma devolve o
                indexador no webhook.
              </p>
            )}
            {summary.alpha < 0.05 && (
              <p>
                Com {test.variants.length - 1} variantes desafiantes, cada uma precisa de{' '}
                {Math.round((1 - summary.alpha) * 1000) / 10}% de confiança (correção de Bonferroni), para não declarar
                vencedora por acaso.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {data.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Conversão acumulada em venda</CardTitle>
            <CardDescription>
              Compradores sobre visitantes de cada variante, até cada dia. As linhas oscilam no começo e se estabilizam
              com a amostra: decidir no meio de uma oscilação é o erro mais comum de teste A/B.
            </CardDescription>
          </CardHeader>
          <CardContent className={blur}>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.withAlpha('--foreground', 0.05)} vertical={false} />
                  <XAxis dataKey="label" {...axis} minTickGap={16} />
                  <YAxis {...axis} width={44} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: chart.background, border: `1px solid ${chart.border}`, borderRadius: '10px' }}
                    labelStyle={{ color: chart.muted }}
                    formatter={(v: number, key: string) => [formatRate(v), `Variante ${key}`]}
                  />
                  <Legend formatter={(key: string) => `Variante ${key}`} wrapperStyle={{ fontSize: 12 }} />
                  {test.variants.map((v, i) => (
                    <Line
                      key={v.key}
                      type="linear"
                      dataKey={v.key}
                      stroke={chart.series[i % chart.series.length]}
                      strokeWidth={2}
                      strokeDasharray={v.isControl ? '4 3' : undefined}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
