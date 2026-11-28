import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { DateRangeFilter, DateRange, getDefaultDateRange } from '@/components/DateRangeFilter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreativeContributionCard } from '@/components/journey/CreativeContribution';
import { JourneyList } from '@/components/journey/JourneyList';
import { brl } from '@/components/journey/format';
import { useJourneyCreatives, useJourneyCustomers, type JourneyCreative } from '@/hooks/useTracking';

export default function Journey() {
  const [dateRange, setDateRange] = useState<DateRange>(() => getDefaultDateRange());
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const creatives = useJourneyCreatives(dateRange);
  const customers = useJourneyCustomers(dateRange, q);

  const creativeMap = useMemo(() => {
    const map = new Map<string, JourneyCreative>();
    for (const row of creatives.data?.creatives ?? []) map.set(row.key, row);
    return map;
  }, [creatives.data]);

  const selectedName = selected ? creativeMap.get(selected)?.name ?? selected : null;
  const journeys = customers.journeys.filter(
    (j) => !selected || j.creatives.includes(selected) || j.lastClickCreative === selected,
  );

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
            {creatives.error ? (
              <p className="text-sm text-destructive">{creatives.error}</p>
            ) : (
              <>
                <CreativeContributionCard
                  creatives={creatives.data?.creatives ?? []}
                  loading={creatives.loading}
                  selected={selected}
                  onSelect={setSelected}
                />
                {!!creatives.data?.unattributed.sales && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    {creatives.data.unattributed.sales}{' '}
                    {creatives.data.unattributed.sales === 1 ? 'venda' : 'vendas'} (
                    {brl(creatives.data.unattributed.revenue)}) sem criativo identificado.
                  </p>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="customers" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                placeholder="Buscar por e-mail ou nome"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="max-w-sm"
              />
              {selected && (
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                  Jornadas de {selectedName} · limpar
                </Button>
              )}
            </div>
            {customers.error ? (
              <p className="text-sm text-destructive">{customers.error}</p>
            ) : (
              <JourneyList journeys={journeys} creatives={creativeMap} loading={customers.loading} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
