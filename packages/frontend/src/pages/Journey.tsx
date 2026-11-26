import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DashboardLayout } from '@/components/DashboardLayout';
import { DateRangeFilter, DateRange, getDefaultDateRange } from '@/components/DateRangeFilter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useJourneyCreatives,
  useJourneyCustomers,
  type JourneyCreative,
  type JourneyCustomer,
} from '@/hooks/useTracking';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const roi = (n: number | null) => (n === null ? '—' : `${n.toFixed(2).replace('.', ',')}x`);
const when = (iso: string) => format(new Date(iso), "dd/MM 'às' HH:mm", { locale: ptBR });

function CreativesTable({ rows }: { rows: JourneyCreative[] }) {
  if (!rows.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Ainda sem vendas ou gasto neste período.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-foreground/10 text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Criativo</th>
            <th className="px-3 text-right font-medium">Vendas (último clique)</th>
            <th className="px-3 text-right font-medium">Receita (último clique)</th>
            <th className="px-3 text-right font-medium">Contribuiu em</th>
            <th className="px-3 text-right font-medium">Meta reporta</th>
            <th className="px-3 text-right font-medium">Gasto</th>
            <th className="px-3 text-right font-medium">ROI último clique</th>
            <th className="pl-3 text-right font-medium">ROI total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-foreground/5">
              <td className="max-w-[260px] truncate py-2 pr-3" title={r.key}>{r.name}</td>
              <td className="px-3 text-right tabular-nums">{r.lastClickSales}</td>
              <td className="px-3 text-right tabular-nums">{brl(r.lastClickRevenue)}</td>
              <td className="px-3 text-right tabular-nums">{r.assistedSales} {r.assistedSales === 1 ? 'venda' : 'vendas'}</td>
              <td className="px-3 text-right tabular-nums">{r.metaPurchases}</td>
              <td className="px-3 text-right tabular-nums">{brl(r.spend)}</td>
              <td className="px-3 text-right tabular-nums">{roi(r.roiLastClick)}</td>
              <td className="pl-3 text-right tabular-nums">{roi(r.roiTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Customer({ c }: { c: JourneyCustomer }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{c.name ?? c.email ?? c.key}</CardTitle>
        <CardDescription>
          {c.email} · {c.purchases} {c.purchases === 1 ? 'compra' : 'compras'} · {brl(c.revenue)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1.5 border-l border-foreground/10 pl-4 text-sm">
          {c.timeline.map((s, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs tabular-nums text-muted-foreground">{when(s.at)}</span>
              <span>{s.label}</span>
              {s.creative && <span className="truncate text-xs text-muted-foreground">criativo {s.creative}</span>}
              {s.role === 'ajudou' && <span className="rounded bg-foreground/10 px-1.5 text-xs">ajudou</span>}
              {s.role === 'comprou' && <span className="rounded bg-primary/15 px-1.5 text-xs text-accent-readable">comprou</span>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default function Journey() {
  const [dateRange, setDateRange] = useState<DateRange>(() => getDefaultDateRange());
  const [q, setQ] = useState('');
  const creatives = useJourneyCreatives(dateRange);
  const customers = useJourneyCustomers(dateRange, q);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Jornada do cliente</h1>
            <p className="mt-1 text-sm text-muted-foreground/80">
              Quais criativos venderam no último clique, quais ajudaram antes, e o caminho de cada cliente
            </p>
          </div>
          <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
        </div>

        <Tabs defaultValue="creatives">
          <TabsList>
            <TabsTrigger value="creatives">Por criativo</TabsTrigger>
            <TabsTrigger value="customers">Por cliente</TabsTrigger>
          </TabsList>

          <TabsContent value="creatives">
            <Card>
              <CardContent className="pt-6">
                {creatives.loading ? (
                  <Skeleton className="h-40 w-full bg-foreground/5" />
                ) : creatives.error ? (
                  <p className="text-sm text-destructive">{creatives.error}</p>
                ) : (
                  <>
                    <CreativesTable rows={creatives.data?.creatives ?? []} />
                    {!!creatives.data?.unattributed.sales && (
                      <p className="mt-4 text-xs text-muted-foreground">
                        {creatives.data.unattributed.sales} {creatives.data.unattributed.sales === 1 ? 'venda' : 'vendas'} ({brl(creatives.data.unattributed.revenue)}) sem criativo identificado.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Contribuiu em: vendas atribuídas a outro criativo, em que este apareceu antes na jornada. ROI total soma último clique e contribuição.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customers" className="space-y-4">
            <Input placeholder="Buscar por e-mail ou nome" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
            {customers.loading ? (
              <Skeleton className="h-40 w-full bg-foreground/5" />
            ) : customers.error ? (
              <p className="text-sm text-destructive">{customers.error}</p>
            ) : customers.customers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhum cliente neste período.</p>
            ) : (
              customers.customers.map((c) => <Customer key={c.key} c={c} />)
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
