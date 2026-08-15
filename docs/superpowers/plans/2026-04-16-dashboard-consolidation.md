# Dashboard Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `GET /metrics/dashboard` num endpoint consolidado que devolve o objeto da tela inteiramente pré-computado. Eliminar cálculos duplicados no frontend, remover 2 requisições auxiliares (`/sales` para painel realtime e para barra de progresso, `/metrics/sales-by-region` para o globo) e descartar 13 campos mortos + 7 campos "*Change" hardcoded a 0.

**Architecture:** Hoje `/metrics/dashboard` retorna `{sales: [], daily_spend: []}` cru; o hook `useDashboardMetrics` faz 6 `useMemo` com `reduce`/`filter`/`groupBy` para calcular 22 campos métricos (só 6 renderizados), chartData, pieData/checkoutPieData/products/campaigns (todos descartados). `useSales` é chamado pelo painel realtime só pra filtrar as 9 últimas vendas aprovadas. `useSalesByRegion` faz outro GET e agrupa por estado no JS. `RevenueProgressBar` dispara uma 3ª chamada a `/sales` pra somar receita lifetime do workspace.

A refatoração move **todas** essas agregações para `LiveMetricsService.getDashboardData`, que passa a retornar:
```ts
{
  metrics: { grossRevenue, netRevenue, adSpend, roas, cpa, salesCount },
  chartData: Array<{ date, revenue, spend }>,     // pré-agrupado por dia
  regions: Array<{ state, sales, revenue, percentage }>,  // pré-agrupado por estado com %
  lifetimeRevenue: number,                         // soma all-time de approved no workspace
  recentSales: Array<{ id, product_name, sold_at, amount }>  // top 9 approved no período
}
```

Frontend vira renderização pura: `useDashboardMetrics` devolve o objeto como recebido; `useSales(dateRange)` e `useSalesByRegion(dateRange)` **não são mais chamados pelo Dashboard** (`useSales` fica porque a página Sales usa; `useSalesByRegion` + o endpoint `/metrics/sales-by-region` são deletados — únicos consumidores eram o dashboard).

**Tech Stack:** NestJS 10, Fastify, Supabase PostgreSQL, Jest (backend tests), React 18, Vite, Vitest (frontend).

---

## Contexto da Análise

### Endpoints que o dashboard consome hoje

| Endpoint | Call | Campos consumidos pelo UI |
|---|---|---|
| `GET /metrics/dashboard?from&to&workspace_id&connection_ids?` | `useDashboardMetrics` | 6 métricas + chartData (rest é calculado mas descartado) |
| `GET /sales?status=approved,refunded&from&to&workspace_id` | `useSales` em `RealtimeSalesPanel` | 4 campos × 9 itens (id, product_name, sold_at, amount) |
| `GET /sales?status=approved&workspace_id` (sem período!) | `RevenueProgressBar` inline fetch | só soma `amount` → `lifetimeRevenue` |
| `GET /metrics/sales-by-region?from&to&workspace_id` | `useSalesByRegion` | state, sales, percentage (frontend calcula percentage) |
| `GET /facebook/connections?workspace_id` | `useFacebookConnection` via `AdAccountFilter` | 5 campos (id, ad_account_id, account_name, is_valid, is_active) |

### Cálculos que hoje são feitos no frontend e vão para o backend

Todos em `packages/frontend/src/hooks/useDashboardMetrics.ts:106-269`:

- `grossRevenue` = soma de `amount` em sales com `status='approved'`
- `adSpend` = soma de `spend` em `daily_spend`
- `netRevenue` = `grossRevenue - adSpend`
- `roas` = `grossRevenue / adSpend` (ou 0 se `adSpend <= 0`)
- `cpa` = `adSpend / (salesCount - refundsCount)` (ou 0)
- `salesCount` = count de approved
- `chartData` = agrupa por `format(sold_at, 'yyyy-MM-dd')` + merge com daily_spend por `date`
- `regions` = agrupa `sales.amount` por `customer_state` e calcula `percentage` sobre o total
- `lifetimeRevenue` = 2ª query `/sales?status=approved` e somar
- `recentSales` = filtra approved + `slice(0, 9)` + pega 4 campos

### Campos mortos a remover

**De `DashboardMetrics` (hook atual retorna, UI não lê):**

```
roi, averageTicket, attributedSales, organicSales,
refundsCount, refundsAmount, netSalesCount, netSalesRevenue,
roiChange
```

**Campos `*Change` hardcoded a 0** (feature morta — UI mostra sempre "+0%"):

```
grossRevenueChange, netRevenueChange, adSpendChange,
roasChange, cpaChange, salesCountChange
```

**Retornos do hook nunca consumidos pelo Dashboard:**

```
pieData, checkoutPieData, campaigns, products, error
```

Decisão do produto (confirmada): **remover** os `*Change` da UI (em vez de implementar a comparação period-over-period no backend). Simplifica `MetricCard`.

### Safety verificado

- `useSalesByRegion` e `/metrics/sales-by-region`: **único** consumidor é o dashboard → deletar hook + endpoint
- `useSales`: usado por `Sales.tsx` e componentes do módulo Sales → **manter**; dashboard apenas para de chamar
- `useDashboardMetrics`: além do dashboard, `useProfitEvolution` chama `/metrics/dashboard` esperando um campo `monthlyBreakdown` que **nunca existiu** na resposta — o hook cai no fallback `0/0` sempre. E `useProfitEvolution` é importado só por `ProfitEvolutionChart.tsx` que está comentado em `Financial.tsx`. Ou seja: é código morto que continuará "funcionando" (devolvendo zeros) depois da refatoração. **Não bloqueia nada** — deferir limpeza.
- `useFacebookConnection` e `/facebook/connections`: usados por Campaigns, Onboarding, SyncStatusIndicator etc → **intocado**

### Ganhos esperados

- **Requests:** dashboard cai de 5 chamadas de API (metrics + 2× sales + sales-by-region + facebook-connections) para 2 (dashboard consolidado + facebook-connections)
- **Payload:** `/metrics/dashboard` hoje carrega arrays de sales (20+ campos × N itens) e daily_spend. Depois: objeto agregado com ~30 números + 9 sales × 4 campos. Em um workspace típico (~100 vendas/mês), redução de 80–95% do corpo da resposta
- **Frontend:** `useDashboardMetrics` cai de ~280 linhas para ~40 (sem `useMemo` pesados); `Dashboard.tsx` elimina `useSales`, `useSalesByRegion`, `RevenueProgressBar` inline fetch
- **Backend:** 1 query a menos (`sales-by-region` desaparece); as queries de sales continuam as mesmas mas seleciona apenas colunas que ajudam nas agregações

### Risco e mitigação

- **Quebra de `useProfitEvolution`:** mitigado acima — o hook já está degradado, e a mudança não altera a degradação.
- **Mudança de shape do `/metrics/dashboard`:** quebra qualquer consumer não-identificado. Task 0 repete o grep para o último check.
- **Queries mais complexas no backend:** o novo `getDashboardData` agrupa em memória (Postgres + Node). Workspaces grandes (>100k sales/período) podem sentir. Aceitável — se virar problema, passamos as agregações pra SQL num follow-up. Queries continuam indexadas (sales por workspace_id+sold_at, daily_ad_spend existente).
- **Lifetime revenue query:** nova query sem filtro de data. Usa índice `(workspace_id, status)` — a tabela `sales` já deveria ter isso; verificaremos na Task 2. Se não tiver, adicionamos.

---

## File Structure

**Arquivos modificados:**

- `packages/backend/src/modules/metrics/live-metrics.service.ts` — `getDashboardData` reescrito (hoje ~linha 330–375; vira ~80 linhas mais cálculo in-memory)
- `packages/backend/src/modules/metrics/metrics.controller.ts` — endpoint `/metrics/sales-by-region` deletado
- `packages/backend/src/modules/metrics/metrics.service.ts` — método `getSalesByRegion` deletado
- `packages/frontend/src/hooks/useDashboardMetrics.ts` — simplificado para pass-through
- `packages/frontend/src/pages/Dashboard.tsx` — `MetricCard` sem `change`, `RealtimeSalesPanel`/`RevenueProgressBar` recebem dados via prop, remove `useSales`/`useSalesByRegion` calls
- `docs/features/02-dashboard/*.md` (ou equivalente — verificar) — refletir novo contrato

**Arquivos criados:**

- `packages/backend/src/modules/metrics/__tests__/live-metrics.service.spec.ts` — testes para `getDashboardData`

**Arquivos deletados:**

- `packages/frontend/src/hooks/useSalesByRegion.ts`

Total: ~6 arquivos modificados, 1 criado, 1 deletado.

---

### Task 0: Pre-flight verificação de consumidores

Repetir o grep de segurança diretamente antes de começar, caso o codebase tenha avançado desde o planejamento.

**Files:** (nenhum — só verificação)

- [ ] **Step 1: Verificar consumidores dos campos "mortos" do `/metrics/dashboard`**

```bash
grep -rn "pieData\|checkoutPieData\|\.campaigns\b\|\.products\b\|averageTicket\|attributedSales\|organicSales\|refundsCount\|refundsAmount\|netSalesCount\|netSalesRevenue\|\.roi\b\|roiChange\|grossRevenueChange\|netRevenueChange\|adSpendChange\|roasChange\|cpaChange\|salesCountChange" packages/frontend/src
```

Expected: todos os matches são no próprio `useDashboardMetrics.ts` (definição/cálculo interno) ou em tipos. Nenhum componente lê esses campos do retorno do hook.

Se aparecer em `Dashboard.tsx` ou em componentes, **parar** e ajustar o plano.

- [ ] **Step 2: Verificar que `useSalesByRegion` e `/metrics/sales-by-region` só são usados pelo dashboard**

```bash
grep -rn "useSalesByRegion\|/metrics/sales-by-region\|sales-by-region" packages/frontend/src packages/backend/src
```

Expected: matches em:
- `packages/frontend/src/hooks/useSalesByRegion.ts` (definição)
- `packages/frontend/src/pages/Dashboard.tsx` ou `packages/frontend/src/components/dashboard/SalesGlobe.tsx` (uso)
- `packages/backend/src/modules/metrics/metrics.controller.ts` (endpoint)
- `packages/backend/src/modules/metrics/metrics.service.ts` (método)

Nenhuma referência fora disso. Se aparecer outra tela consumindo, **parar**.

- [ ] **Step 3: Verificar existência de índice para lifetime revenue query**

A nova query de `lifetimeRevenue` será: `SELECT amount FROM sales WHERE workspace_id = $1 AND status = 'approved'` (sem filtro de data).

```bash
grep -n "idx_sales\|CREATE INDEX.*sales" supabase/migrations/*.sql | grep -iE "workspace_id|status"
```

Expected: existe um índice que cobre `(workspace_id, status)` ou composite similar. Se não houver, Task 2 inclui migration nova.

Sem commits nesta task — pura verificação.

---

### Task 1: Escrever testes falhando para novo contrato de `getDashboardData`

Criar suite Jest que fixa o shape consolidado e valida as agregações. TDD step — os testes devem falhar contra a implementação atual.

**Files:**
- Create: `packages/backend/src/modules/metrics/__tests__/live-metrics.service.spec.ts`

- [ ] **Step 1: Criar o arquivo de teste**

Pensar primeiro no esqueleto de mock. O `LiveMetricsService` usa: `SupabaseService`, `EncryptionService`, `FacebookService`, logger interno. Para o teste, precisamos:
- Mockar `supabase.getClient().from('sales')` retornando arrays canonizados conforme a query (com/sem filtros)
- Mockar `supabase.getClient().from('daily_ad_spend')` (ou o caminho via Facebook, conforme a implementação atual use DB ou API)
- Mockar `FacebookService` se o path atual chamar Facebook para daily_spend — **verificar ao ler o service**

Primeiro passo concreto: leia `packages/backend/src/modules/metrics/live-metrics.service.ts` e identifique:
1. Quais services são injetados
2. Se `getDashboardData` busca `daily_spend` via DB (`daily_ad_spend` table) ou via Facebook Graph API

Se a implementação atual usa Facebook API (via `fetchAllConnectionsDailyInsights`), o teste precisa mockar o método de service que faz isso. Uma opção limpa é refatorar para buscar de `daily_ad_spend` table (DB-only) — já que o sync persiste lá — mas isso é uma decisão de Task 2.

Para Task 1, criar o teste assumindo o path DB (mais simples de mockar):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { LiveMetricsService } from '../live-metrics.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FacebookService } from '../../facebook/facebook.service';

type FromCall = { table: string; columns?: string };

describe('LiveMetricsService.getDashboardData — consolidated contract', () => {
  let service: LiveMetricsService;
  let fromCalls: FromCall[];

  const userId = 'user-1';
  const workspaceId = '00000000-0000-0000-0000-000000000001';

  // Fixture: 3 approved sales, 1 refunded, spanning 2 days, 2 states
  const salesInPeriod = [
    { id: 's1', amount: '100', status: 'approved', sold_at: '2026-04-10T12:00:00Z', product_name: 'A', customer_state: 'SP' },
    { id: 's2', amount: '50',  status: 'approved', sold_at: '2026-04-10T15:00:00Z', product_name: 'A', customer_state: 'SP' },
    { id: 's3', amount: '200', status: 'approved', sold_at: '2026-04-11T10:00:00Z', product_name: 'B', customer_state: 'RJ' },
    { id: 's4', amount: '30',  status: 'refunded', sold_at: '2026-04-11T11:00:00Z', product_name: 'A', customer_state: 'SP' },
  ];
  const lifetimeSales = [
    { amount: '100' }, { amount: '50' }, { amount: '200' },
    { amount: '999' }, // another approved sale outside the period
  ];
  const dailySpend = [
    { date: '2026-04-10', spend: 40 },
    { date: '2026-04-11', spend: 60 },
    { date: '2026-04-12', spend: 20 },  // outside period — backend must filter
  ];

  beforeEach(async () => {
    fromCalls = [];

    const makeBuilder = (table: string) => {
      const state: { hasDateFilter: boolean } = { hasDateFilter: false };
      const builder: any = {
        select: (cols: string) => { fromCalls.push({ table, columns: cols }); return builder; },
        eq: () => builder,
        in: () => builder,
        gte: () => { state.hasDateFilter = true; return builder; },
        lt:  () => { state.hasDateFilter = true; return builder; },
        lte: () => { state.hasDateFilter = true; return builder; },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: { id: workspaceId }, error: null }),
        then: (resolve: (v: any) => void) => {
          if (table === 'sales' && state.hasDateFilter) {
            resolve({ data: salesInPeriod, error: null });
          } else if (table === 'sales' && !state.hasDateFilter) {
            resolve({ data: lifetimeSales, error: null });
          } else if (table === 'daily_ad_spend') {
            resolve({
              data: dailySpend.filter((d) => d.date >= '2026-04-10' && d.date <= '2026-04-11'),
              error: null,
            });
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
      return builder;
    };

    const supabaseMock: Partial<SupabaseService> = {
      getClient: () => ({ from: (t: string) => makeBuilder(t) }) as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveMetricsService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: EncryptionService, useValue: { decrypt: jest.fn(), encrypt: jest.fn() } },
        { provide: FacebookService, useValue: {
          getConnections: jest.fn().mockResolvedValue([]),   // no active FB connections in test
        } },
      ],
    }).compile();

    service = module.get(LiveMetricsService);
  });

  it('returns the consolidated shape with exactly the 5 top-level keys', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });

    expect(Object.keys(r).sort()).toEqual([
      'chartData', 'lifetimeRevenue', 'metrics', 'recentSales', 'regions',
    ]);
  });

  it('metrics contains exactly 6 fields, all numbers, no *Change fields', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });

    expect(Object.keys(r.metrics).sort()).toEqual([
      'adSpend', 'cpa', 'grossRevenue', 'netRevenue', 'roas', 'salesCount',
    ]);
    for (const v of Object.values(r.metrics)) {
      expect(typeof v).toBe('number');
    }
  });

  it('metrics values are correctly aggregated', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });

    expect(r.metrics.grossRevenue).toBe(350);       // 100 + 50 + 200 approved
    expect(r.metrics.salesCount).toBe(3);
    expect(r.metrics.adSpend).toBe(100);            // 40 + 60 (spend filtered to period)
    expect(r.metrics.netRevenue).toBe(250);         // 350 - 100
    expect(r.metrics.roas).toBeCloseTo(3.5, 4);     // 350 / 100
    expect(r.metrics.cpa).toBeCloseTo(100 / 3, 4);  // 100 / 3 approved sales
  });

  it('chartData is sorted ascending by date and merges revenue+spend per day', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });

    expect(r.chartData).toEqual([
      { date: '2026-04-10', revenue: 150, spend: 40 },
      { date: '2026-04-11', revenue: 200, spend: 60 },
    ]);
  });

  it('regions is grouped by customer_state with pre-computed percentage summing to 100', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });

    // SP: 2 sales × (100+50)=150; RJ: 1 sale × 200
    expect(r.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'SP', sales: 2, revenue: 150 }),
        expect.objectContaining({ state: 'RJ', sales: 1, revenue: 200 }),
      ]),
    );
    const sumPct = r.regions.reduce((s, x) => s + x.percentage, 0);
    expect(sumPct).toBeCloseTo(100, 1);
  });

  it('lifetimeRevenue aggregates approved sales across all time (no date filter)', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });
    expect(r.lifetimeRevenue).toBe(1349);  // 100 + 50 + 200 + 999
  });

  it('recentSales returns at most 9 approved sales with exactly the 4 fields', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });
    expect(r.recentSales.length).toBeLessThanOrEqual(9);
    for (const s of r.recentSales) {
      expect(Object.keys(s).sort()).toEqual(['amount', 'id', 'product_name', 'sold_at']);
    }
    // All 3 approved sales should appear (only 3, below cap of 9)
    expect(r.recentSales.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('no refunded sales leak into metrics, regions, recentSales, or chartData', async () => {
    const r = await service.getDashboardData(userId, {
      workspace_id: workspaceId,
      from: '2026-04-10',
      to: '2026-04-11',
    });
    expect(r.recentSales.map((s) => s.id)).not.toContain('s4');
    // refunded sale was in SP/A — it should not inflate SP counts
    const sp = r.regions.find((r) => r.state === 'SP');
    expect(sp?.sales).toBe(2);
  });
});
```

Notas sobre o mock:
- `from('sales')` é chamado DUAS vezes com filtros diferentes (período + lifetime). O `makeBuilder` distingue pela presença de `gte`/`lt` (`hasDateFilter`).
- Se a implementação real não usa `daily_ad_spend` table mas sim `FacebookService`, o implementer da Task 2 vai ter que decidir se (a) refatora para usar DB ou (b) adapta o mock. Prefira DB — é o caminho do sync persistido e mais testável.

- [ ] **Step 2: Rodar os testes — devem falhar**

```bash
cd packages/backend && npx jest src/modules/metrics/__tests__/live-metrics.service.spec.ts 2>&1 | tail -40
```

Expected: todos os testes falham. Hoje `getDashboardData` retorna `{sales: [...], daily_spend: [...]}` cru, então `Object.keys(r).sort()` não bate, nem `r.metrics.grossRevenue` (undefined), etc.

Se algum teste passar acidentalmente, revisar — provavelmente é um falso positivo (método retornou `undefined` e assertion foi leniente). Os `Object.keys` devem ser suficientes.

Se um teste der erro de mock (TypeError: `.gte is not a function` etc), ajustar o `makeBuilder` para cobrir o path real da implementação.

- [ ] **Step 3: Commit dos testes falhando**

```bash
git add packages/backend/src/modules/metrics/__tests__/live-metrics.service.spec.ts
git commit -m "test(metrics): pin consolidated contract for getDashboardData (expected failing)"
```

---

### Task 2: Refatorar `LiveMetricsService.getDashboardData` para retorno consolidado

Substituir a implementação atual (retorno cru) por uma versão que faz agregações em memória e devolve o objeto consolidado.

**Files:**
- Modify: `packages/backend/src/modules/metrics/live-metrics.service.ts` (método `getDashboardData`, ~linhas 330-375 no estado pré-tarefa)

- [ ] **Step 1: Ler a implementação atual**

Ler `packages/backend/src/modules/metrics/live-metrics.service.ts`. Localizar o método `getDashboardData`. Identificar:
1. Os services injetados (constructor)
2. Como hoje são obtidas as vendas (query direta em `sales` — OK)
3. Como hoje é obtido `daily_spend` — se via Facebook API (`fetchAllConnectionsDailyInsights`) ou via `daily_ad_spend` table

Se via Facebook API: decidir switch para `daily_ad_spend` table. Justificativa: o sync automático já popula `daily_ad_spend`; o dashboard é latência-sensível, não pode esperar round-trip externo; Regra 3 de CLAUDE.md (performance) e Regra 5 (caching). Esse é o mesmo racional que o Rule 8 query writing cobre.

Se o consenso do codebase for híbrido (DB com fallback Facebook), manter. Documentar no comentário inline.

- [ ] **Step 2: Substituir o método `getDashboardData`**

Estrutura esperada (escrever em TypeScript, seguindo o padrão do service):

```ts
async getDashboardData(
  userId: string,
  params: {
    workspace_id: string;
    from?: string;                 // 'YYYY-MM-DD'
    to?: string;                   // 'YYYY-MM-DD'
    connection_ids?: string[];     // optional FB connection filter
    checkout_ids?: string[];
    product_names?: string[];
  },
): Promise<{
  metrics: {
    grossRevenue: number;
    netRevenue: number;
    adSpend: number;
    roas: number;
    cpa: number;
    salesCount: number;
  };
  chartData: Array<{ date: string; revenue: number; spend: number }>;
  regions: Array<{ state: string; sales: number; revenue: number; percentage: number }>;
  lifetimeRevenue: number;
  recentSales: Array<{ id: string; product_name: string | null; sold_at: string; amount: number }>;
}> {
  const client = this.supabase.getClient();

  // Workspace ownership (use the existing helper pattern — adapt to actual service code)
  // ...

  // Range bounds
  const fromISO = params.from ? toStartOfDayUTC(params.from) : undefined;
  const toISO = params.to ? toExclusiveEndDate(params.to) : undefined;

  // --- Build sales-in-period query (only columns needed for aggregations) ---
  const buildPeriodSalesQuery = () => {
    let q = client
      .from('sales')
      .select('id, amount, status, sold_at, product_name, customer_state')
      .eq('user_id', userId)
      .eq('workspace_id', params.workspace_id);
    if (fromISO) q = q.gte('sold_at', fromISO);
    if (toISO) q = q.lt('sold_at', toISO);
    if (params.checkout_ids?.length) q = q.in('checkout_integration_id', params.checkout_ids);
    if (params.product_names?.length) q = q.in('product_name', params.product_names);
    return q;
  };

  // --- Lifetime revenue (no date filter, status approved only) ---
  const buildLifetimeQuery = () =>
    client
      .from('sales')
      .select('amount')
      .eq('user_id', userId)
      .eq('workspace_id', params.workspace_id)
      .eq('status', 'approved');

  // --- Daily ad spend (scoped to period + optional connections) ---
  const buildDailySpendQuery = () => {
    let q = client
      .from('daily_ad_spend')
      .select('date, spend, facebook_connection_id')
      .eq('user_id', userId)
      .eq('workspace_id', params.workspace_id);
    if (params.from) q = q.gte('date', params.from);
    if (params.to) q = q.lte('date', params.to);
    if (params.connection_ids?.length) q = q.in('facebook_connection_id', params.connection_ids);
    return q;
  };

  const [periodResult, lifetimeResult, spendResult] = await Promise.all([
    buildPeriodSalesQuery(),
    buildLifetimeQuery(),
    buildDailySpendQuery(),
  ]);

  if (periodResult.error) throw periodResult.error;
  if (lifetimeResult.error) throw lifetimeResult.error;
  if (spendResult.error) throw spendResult.error;

  const periodSales = periodResult.data ?? [];
  const approved = periodSales.filter((s) => s.status === 'approved');

  // --- Metrics ---
  const grossRevenue = approved.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const salesCount = approved.length;
  const adSpend = (spendResult.data ?? []).reduce((s, r) => s + Number(r.spend ?? 0), 0);
  const netRevenue = grossRevenue - adSpend;
  const roas = adSpend > 0 ? grossRevenue / adSpend : 0;
  const cpa = salesCount > 0 ? adSpend / salesCount : 0;

  // --- chartData: group by day, merge revenue + spend ---
  const revenueByDate = new Map<string, number>();
  for (const s of approved) {
    const date = s.sold_at.slice(0, 10);  // 'YYYY-MM-DD' from ISO
    revenueByDate.set(date, (revenueByDate.get(date) ?? 0) + Number(s.amount ?? 0));
  }
  const spendByDate = new Map<string, number>();
  for (const d of spendResult.data ?? []) {
    spendByDate.set(d.date, (spendByDate.get(d.date) ?? 0) + Number(d.spend ?? 0));
  }
  const allDates = Array.from(new Set([...revenueByDate.keys(), ...spendByDate.keys()])).sort();
  const chartData = allDates.map((date) => ({
    date,
    revenue: revenueByDate.get(date) ?? 0,
    spend: spendByDate.get(date) ?? 0,
  }));

  // --- regions: group by customer_state (approved only), compute percentage ---
  const regionMap = new Map<string, { sales: number; revenue: number }>();
  for (const s of approved) {
    if (!s.customer_state) continue;
    const r = regionMap.get(s.customer_state) ?? { sales: 0, revenue: 0 };
    r.sales += 1;
    r.revenue += Number(s.amount ?? 0);
    regionMap.set(s.customer_state, r);
  }
  const totalRegionSales = Array.from(regionMap.values()).reduce((s, r) => s + r.sales, 0);
  const regions = Array.from(regionMap.entries())
    .map(([state, r]) => ({
      state,
      sales: r.sales,
      revenue: r.revenue,
      percentage: totalRegionSales > 0 ? (r.sales / totalRegionSales) * 100 : 0,
    }))
    .sort((a, b) => b.sales - a.sales);

  // --- lifetimeRevenue ---
  const lifetimeRevenue = (lifetimeResult.data ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0,
  );

  // --- recentSales: top 9 approved, sorted by sold_at desc, 4 fields only ---
  const recentSales = [...approved]
    .sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1))
    .slice(0, 9)
    .map((s) => ({
      id: s.id,
      product_name: s.product_name,
      sold_at: s.sold_at,
      amount: Number(s.amount ?? 0),
    }));

  return { metrics: { grossRevenue, netRevenue, adSpend, roas, cpa, salesCount }, chartData, regions, lifetimeRevenue, recentSales };
}
```

**Ajustes que o implementer precisa fazer lendo o código real:**
- O service atual provavelmente já tem um helper `verifyWorkspaceOwnership` ou equivalente. **Reusar**, não duplicar.
- `toStartOfDayUTC`/`toExclusiveEndDate` vêm de `packages/backend/src/shared/helpers/date-range.ts` — já importados em outros services.
- Se `daily_ad_spend` não está sendo usado hoje e o path é via Facebook API: adicionar uma justificativa no commit message de por que estamos mudando o source de truth (a tabela está populada pelo sync — verificar `packages/backend/src/modules/facebook/insights.service.ts`).
- Se a assinatura atual de `getDashboardData` for diferente (ex: recebe query params como string vs objeto), adaptar os chamadores.

- [ ] **Step 3: Verificar consumidores internos que possam depender do shape antigo**

```bash
grep -rn "getDashboardData" packages/backend/src --include="*.ts"
```

Esperado ver:
- `metrics.controller.ts` — chama e retorna direto (atualizar se pegar campos específicos)
- `financial.service.ts` — já chama `getDashboardData` (do trabalho financeiro anterior), só lê `daily_spend` (via `dashboardData.daily_spend`). **ATENÇÃO:** esse path quebra — precisamos adaptar.

Se `financial.service.ts` ainda depender de `daily_spend`, opções:
- Opção A: Em `financial.service.ts`, parar de chamar `getDashboardData` e buscar `daily_ad_spend` diretamente (query própria). É o caminho limpo — financial não precisa do dashboard inteiro.
- Opção B: Manter um método `getAdSpendTotal()` separado no `LiveMetricsService` que apenas soma o spend do período. Refatorar `financial.service.ts` e `getDashboardData` para ambos usarem.

Preferir **Opção B**: extrair um helper privado `private async aggregateAdSpend(userId, workspaceId, from?, to?, connectionIds?): Promise<number>` que faz só a query do daily_spend + reduce. Chamar de `getSummary` do financial e de `getDashboardData`. DRY sem abstração prematura (dois callers reais).

- [ ] **Step 4: Rodar os testes da Task 1 — devem passar**

```bash
cd packages/backend && npx jest src/modules/metrics/__tests__/live-metrics.service.spec.ts 2>&1 | tail -20
```

Expected: 8/8 verdes.

- [ ] **Step 5: Rodar o financial spec também (da refatoração anterior)**

```bash
cd packages/backend && npx jest src/modules/financial/__tests__/financial.service.spec.ts 2>&1 | tail -10
```

Expected: 3/3 verdes. Se quebrou porque `financial.service.ts` foi modificado na Opção B acima, adicionar mock adicional aos testes de financial (mocká-lo da mesma forma que LiveMetricsService já era mockado).

- [ ] **Step 6: Suite completa**

```bash
cd packages/backend && npm test 2>&1 | tail -10
```

Expected: tudo verde. Baseline anterior era 77/77; Task 1 adiciona 8 testes → 85/85.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/metrics/live-metrics.service.ts \
        packages/backend/src/modules/financial/financial.service.ts
git commit -m "refactor(metrics): consolidate getDashboardData response shape"
```

(Se Opção B foi usada e `financial.service.ts` mudou, incluir no mesmo commit — a mudança é conjunta.)

---

### Task 3: Simplificar `useDashboardMetrics` hook

Remover toda a agregação client-side. O hook vira um pass-through que faz o GET e repassa o objeto ao componente.

**Files:**
- Modify: `packages/frontend/src/hooks/useDashboardMetrics.ts`

- [ ] **Step 1: Reescrever o arquivo inteiro**

Substituir o conteúdo de `packages/frontend/src/hooks/useDashboardMetrics.ts` pelo seguinte:

```ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRefetch } from '@/contexts/RefetchContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { DateRange } from '@/components/DateRangeFilter';

export interface DashboardMetrics {
  grossRevenue: number;
  netRevenue: number;
  adSpend: number;
  roas: number;
  cpa: number;
  salesCount: number;
}

export interface ChartPoint {
  date: string;
  revenue: number;
  spend: number;
}

export interface RegionPoint {
  state: string;
  sales: number;
  revenue: number;
  percentage: number;
}

export interface RecentSale {
  id: string;
  product_name: string | null;
  sold_at: string;
  amount: number;
}

export interface DashboardResponse {
  metrics: DashboardMetrics;
  chartData: ChartPoint[];
  regions: RegionPoint[];
  lifetimeRevenue: number;
  recentSales: RecentSale[];
}

const EMPTY_RESPONSE: DashboardResponse = {
  metrics: { grossRevenue: 0, netRevenue: 0, adSpend: 0, roas: 0, cpa: 0, salesCount: 0 },
  chartData: [],
  regions: [],
  lifetimeRevenue: 0,
  recentSales: [],
};

export function useDashboardMetrics(dateRange: DateRange, connectionIds?: string[]) {
  const [data, setData] = useState<DashboardResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);

  const { user } = useAuth();
  const { getEffectiveUserId, isImpersonating, target } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const { refetchSignal } = useRefetch();
  const { activeWorkspaceId } = useWorkspaceContext();

  const fetchData = useCallback(async () => {
    if (!effectiveId || !activeWorkspaceId) {
      setData(EMPTY_RESPONSE);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('from', format(dateRange.from, 'yyyy-MM-dd'));
      params.set('to', format(dateRange.to, 'yyyy-MM-dd'));
      params.set('workspace_id', activeWorkspaceId);
      if (isImpersonating && target) params.set('target_user_id', target.userId);
      if (connectionIds && connectionIds.length > 0) params.set('connection_ids', connectionIds.join(','));

      const result = await api.get<DashboardResponse>(`/metrics/dashboard?${params}`);
      setData(result ?? EMPTY_RESPONSE);
    } catch (err) {
      console.error('[useDashboardMetrics] Error:', err);
      setData(EMPTY_RESPONSE);
    } finally {
      setLoading(false);
    }
  }, [effectiveId, activeWorkspaceId, format(dateRange.from, 'yyyy-MM-dd'), format(dateRange.to, 'yyyy-MM-dd'), connectionIds?.join(','), isImpersonating, target]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refetchSignal]);

  return { ...data, loading, refetch: fetchData };
}
```

Mudanças-chave:
- Arquivo cai de 282 linhas para ~90.
- Assinatura da função: `useDashboardMetrics(dateRange, connectionIds)` — removido `productFilter` (nunca usado).
- Interfaces expostas: apenas as 5 que o componente precisa.
- Sem `useMemo`, sem `reduce`/`filter`, sem tipos mortos (`PieData`, `CampaignSummary`).
- `error` removido do retorno (não era consumido).
- `refetch` preservado (pode ser usado por outros callers).

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "useDashboardMetrics|Dashboard.tsx" | head -20 || echo "clean"
```

Espera-se **erros** em `Dashboard.tsx` (consumer ainda espera os campos antigos). Task 4 corrige. OK prosseguir.

- [ ] **Step 3: Rodar testes do frontend**

```bash
cd packages/frontend && npm test -- --run 2>&1 | tail -10
```

Expected: passam (nenhum teste aparentemente cobre `useDashboardMetrics` especificamente; se quebrou algo, investigar).

- [ ] **Step 4: Commit (com nota de que Dashboard.tsx ainda precisa de ajuste)**

```bash
git add packages/frontend/src/hooks/useDashboardMetrics.ts
git commit -m "refactor(dashboard): simplify useDashboardMetrics to pass-through the consolidated response"
```

(Sim, o app está "broken" entre este commit e o final da Task 4 — branch ainda não merged, OK.)

---

### Task 4: Atualizar `Dashboard.tsx` e componentes

Consumir o novo shape do hook. Remover 2 chamadas de API auxiliares e drop de `change` dos cards.

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Mudanças em `MetricCard` (componente inline)**

Localizar a definição de `MetricCard` (próximo a linha 41 na versão pré-plano). Remover o prop `change` e toda a lógica/JSX que renderiza o percentual:

```tsx
// ANTES (pseudocódigo das mudanças)
function MetricCard({ title, value, change, icon, prefix, suffix, loading, valueColor }: {
  title: string;
  value: string;
  change: number;      // REMOVER
  icon: React.ReactNode;
  prefix?: string;
  suffix?: string;
  loading?: boolean;
  valueColor?: string;
}) {
  // ... no JSX, remover o bloco que exibe `{change > 0 ? '+' : ''}{change.toFixed(1)}%`
}
```

Substituir a assinatura e o JSX de acordo — remover prop, remover JSX do percentual, remover qualquer import só usado para o change (ex: ícones de seta se forem exclusivos desse caso).

Nas 6 instâncias de `<MetricCard ...>` no Dashboard, remover o `change={...}`.

- [ ] **Step 2: Substituir o corpo do componente `Dashboard` para consumir o novo hook**

Na função `Dashboard()`, substituir o bloco de hooks de dados:

```tsx
// ANTES:
const { metrics, chartData, loading, campaigns } = useDashboardMetrics(dateRange, undefined, selectedConnectionIds);
const { sales, loading: salesLoading } = useSales(dateRange);
// RevenueProgressBar faz seu próprio fetch;
// SalesGlobe consume useSalesByRegion;

// DEPOIS:
const {
  metrics, chartData, regions, lifetimeRevenue, recentSales,
  loading: dashLoading,
} = useDashboardMetrics(dateRange, selectedConnectionIds);
```

- Remover imports de `useSales` e `useSalesByRegion` do topo de `Dashboard.tsx`.
- O `dashLoading` substitui o que antes era `loading || salesLoading`.

- [ ] **Step 3: Atualizar `RevenueProgressBar` para receber `lifetimeRevenue` via prop**

Localizar a função inline `RevenueProgressBar`. Substituir:

```tsx
function RevenueProgressBar({ value, loading }: { value: number; loading: boolean }) {
  const totalRevenue = value;
  const isReady = !loading;
  // ... resto do cálculo de milestones idêntico
}
```

- Remover o `useEffect` com `fetchTotalRevenue` e o state `totalRevenue`/`loadingRevenue`.
- No caller (no JSX do `Dashboard`), passar `<RevenueProgressBar value={lifetimeRevenue} loading={dashLoading} />`.

- [ ] **Step 4: Atualizar `RealtimeSalesPanel` para receber `recentSales` via prop**

Localizar a função inline `RealtimeSalesPanel`. Substituir:

```tsx
function RealtimeSalesPanel({
  recentSales,
  loading,
}: {
  recentSales: Array<{ id: string; product_name: string | null; sold_at: string; amount: number }>;
  loading: boolean;
}) {
  // Remover useSales e filtro client-side. recentSales já vem pronto do backend.
  // O resto do render (cards estilo notificação, loading skeletons, formatCurrency, formatTime) fica igual.
}
```

No caller:
```tsx
<RealtimeSalesPanel recentSales={recentSales} loading={dashLoading} />
```

- [ ] **Step 5: Atualizar `SalesGlobe` para receber `regions` via prop**

`SalesGlobe.tsx` está em `packages/frontend/src/components/dashboard/SalesGlobe.tsx`. Ler o arquivo para entender a interface atual. Hoje ele chama internamente `useSalesByRegion(dateRange)`. Mudar:

```tsx
// ANTES: o componente chama o hook internamente
export function SalesGlobe({ dateRange }: { dateRange: DateRange }) {
  const { regions, loading } = useSalesByRegion(dateRange);
  // ...
}

// DEPOIS: o componente recebe regions via prop
export function SalesGlobe({ regions, loading }: { regions: RegionPoint[]; loading: boolean }) {
  // resto do render usando regions[i].state, .percentage, .sales — igual a hoje
}
```

No caller em `Dashboard.tsx`:
```tsx
<SalesGlobe regions={regions} loading={dashLoading} />
```

Importar `RegionPoint` de `@/hooks/useDashboardMetrics`.

- [ ] **Step 6: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -30 || echo "clean"
```

Expected: `clean` (ou sem erros em Dashboard.tsx / SalesGlobe.tsx / useDashboardMetrics.ts).

- [ ] **Step 7: Testes do frontend**

```bash
cd packages/frontend && npm test -- --run 2>&1 | tail -10
```

Expected: verde.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/pages/Dashboard.tsx \
        packages/frontend/src/components/dashboard/SalesGlobe.tsx
git commit -m "refactor(dashboard): consume consolidated response and drop client-side aggregations"
```

---

### Task 5: Remover endpoint e hook órfãos `/metrics/sales-by-region`

Agora que nada consome, deletar para não deixar ruído.

**Files:**
- Modify: `packages/backend/src/modules/metrics/metrics.controller.ts` — remover endpoint
- Modify: `packages/backend/src/modules/metrics/metrics.service.ts` — remover método `getSalesByRegion`
- Delete: `packages/frontend/src/hooks/useSalesByRegion.ts`

- [ ] **Step 1: Grep final de consumidores**

```bash
grep -rn "useSalesByRegion\|/metrics/sales-by-region\|getSalesByRegion\|sales-by-region" packages/frontend/src packages/backend/src
```

Expected: matches apenas em:
- `packages/backend/src/modules/metrics/metrics.controller.ts` (o endpoint que vamos remover)
- `packages/backend/src/modules/metrics/metrics.service.ts` (o método que vamos remover)
- `packages/frontend/src/hooks/useSalesByRegion.ts` (o hook que vamos deletar)

Se aparecer outro match, parar.

- [ ] **Step 2: Remover o endpoint do controller**

Em `packages/backend/src/modules/metrics/metrics.controller.ts`, localizar o handler do `/metrics/sales-by-region` (provavelmente entre linhas 36-48 conforme análise). Deletar:
- O método completo (incluindo decorators `@Get('sales-by-region')`)
- Imports não usados após a remoção (ex: se um DTO só servia a esse handler)

- [ ] **Step 3: Remover o método do service**

Em `packages/backend/src/modules/metrics/metrics.service.ts`, localizar `getSalesByRegion` (~linhas 115-147). Deletar o método inteiro. Remover imports que ficaram órfãos.

- [ ] **Step 4: Deletar o hook**

```bash
rm packages/frontend/src/hooks/useSalesByRegion.ts
```

- [ ] **Step 5: Typecheck ambos os pacotes**

```bash
cd packages/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "node_modules" | head -20 || echo "backend clean"
cd ../frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "node_modules" | head -20 || echo "frontend clean"
```

Expected: ambos `clean`.

- [ ] **Step 6: Suite completa**

```bash
cd ../../ && npm test 2>&1 | tail -10
```

Expected: backend 85/85 (sem perder testes), frontend verde.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/metrics/metrics.controller.ts \
        packages/backend/src/modules/metrics/metrics.service.ts \
        packages/frontend/src/hooks/useSalesByRegion.ts
git commit -m "refactor(metrics): remove orphan /metrics/sales-by-region endpoint and hook"
```

---

### Task 6: Atualizar documentação

Refletir o novo contrato de `/metrics/dashboard` e a remoção de `/metrics/sales-by-region`.

**Files:**
- Modify: `docs/features/02-dashboard/*.md` (OU `docs/features/03-metrics/*.md` — descobrir qual arquivo documenta essa feature)

- [ ] **Step 1: Localizar a documentação atual**

```bash
grep -rln "/metrics/dashboard\|sales-by-region\|useDashboardMetrics" docs/features
```

Identificar o arquivo principal. Pode ser algo como `docs/features/02-dashboard/dashboard.md` ou `docs/features/03-metrics/metrics.md`.

- [ ] **Step 2: Atualizar a seção que descreve `GET /metrics/dashboard`**

Substituir qualquer descrição de response antigo (`{sales, daily_spend}`) pela nova:

```markdown
#### `GET /metrics/dashboard`

**Query params:** `workspace_id` (UUID, obrigatorio), `from` (YYYY-MM-DD, opcional), `to` (YYYY-MM-DD, opcional), `connection_ids` (CSV de UUIDs, opcional), `checkout_ids` (CSV, opcional), `product_names` (CSV, opcional), `target_user_id` (UUID, opcional — admin impersonando).

**Response:**
```json
{
  "metrics": {
    "grossRevenue": 12345.67,
    "netRevenue": 8000.00,
    "adSpend": 4345.67,
    "roas": 2.84,
    "cpa": 18.50,
    "salesCount": 235
  },
  "chartData": [
    { "date": "2026-04-10", "revenue": 500, "spend": 120 }
  ],
  "regions": [
    { "state": "SP", "sales": 120, "revenue": 8000, "percentage": 51.06 }
  ],
  "lifetimeRevenue": 98765.43,
  "recentSales": [
    { "id": "...", "product_name": "Produto X", "sold_at": "2026-04-16T12:00:00Z", "amount": 197 }
  ]
}
```

Todas as agregacoes sao feitas no backend. O frontend apenas renderiza.

- `metrics`: agregados do periodo selecionado. `netRevenue = grossRevenue - adSpend`. `roas = grossRevenue / adSpend`. `cpa = adSpend / salesCount`. Valores = 0 quando divisao por zero.
- `chartData`: pontos diarios sorted ascending. `revenue` = soma de `amount` de vendas `approved` no dia; `spend` = soma de `daily_ad_spend.spend` no dia.
- `regions`: vendas `approved` agrupadas por `customer_state`. `percentage` e calculado sobre o total de vendas do periodo (soma = 100%, exceto quando nao ha vendas com estado preenchido).
- `lifetimeRevenue`: soma all-time de `sales.amount WHERE status = 'approved'` no workspace, **ignorando** o filtro de periodo. Usado pela barra de progresso de marcos.
- `recentSales`: ate 9 vendas `approved` do periodo, ordenadas por `sold_at DESC`. 4 campos por venda.
```

- [ ] **Step 3: Remover referencias a `/metrics/sales-by-region`**

Na mesma doc, se houver secao documentando o endpoint deletado, **remove-la inteira**. Se a lista de endpoints incluir `sales-by-region`, tirar a linha.

- [ ] **Step 4: Atualizar secao de hooks no frontend**

Se houver uma secao "Hooks do Frontend" listando `useDashboardMetrics` com a interface antiga (22 campos etc), atualizar para refletir o novo shape `{metrics, chartData, regions, lifetimeRevenue, recentSales, loading, refetch}`.

Remover mencao a `useSalesByRegion` (hook deletado).

- [ ] **Step 5: Commit**

```bash
git add docs/features
git commit -m "docs(dashboard): align dashboard docs with consolidated metrics contract"
```

---

### Task 7: Verificacao final

**Files:** (nenhum)

- [ ] **Step 1: Lint + testes completos**

```bash
npm run lint 2>&1 | tail -10
npm test 2>&1 | tail -15
```

Expected: testes verdes em ambos os pacotes. Lint possivelmente falha no backend (ESLint 9 migration pendente em main — pre-existente, nao regressao).

- [ ] **Step 2: Safeguard grep**

```bash
grep -rn "pieData\|checkoutPieData\|averageTicket\|roiChange\|grossRevenueChange\|netRevenueChange\|adSpendChange\|roasChange\|cpaChange\|salesCountChange" packages
grep -rn "useSalesByRegion\|/metrics/sales-by-region" packages
```

Expected: nenhum match em `packages/` (excluindo arquivos de documentacao do plano em `docs/superpowers`).

- [ ] **Step 3: Diff review**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

Expected: ~7 commits (test + 4 refactor + docs + opcional cleanup), ~7-8 arquivos modificados/criados/deletados. Nenhum no modulo `/facebook` ou `/sales`.

- [ ] **Step 4: Smoke manual (o usuario faz)**

Subir o stack no worktree e validar visualmente:
- 6 cards ainda preenchem (sem mais o "+0%")
- Grafico de linha mostra dias + revenue/spend
- Globo de vendas com regioes
- Painel realtime com ate 9 vendas
- Barra de progresso com lifetime revenue
- Filtro de contas Facebook continua funcionando (sem regressao)
- DevTools Network tab: apenas 2 requests (metrics/dashboard + facebook/connections) por troca de periodo

Se algum dos items falhar, reportar e corrigir.

---

## Self-Review Checklist

1. **Spec coverage:** Cada decisao do brainstorm esta coberta?
   - "Backend mastiga tudo" → Tasks 1-2 (testes + implementacao)
   - "Mantem painel de vendas como hoje" → Task 4 step 4 (RealtimeSalesPanel consome recentSales do endpoint)
   - "Remove 13 campos mortos" → Tasks 2-3 (backend nao retorna, frontend nao expoe)
   - "Remove *Change" → Task 4 step 1 (MetricCard drop change prop)
2. **Placeholder scan:** sem "TBD" ou "implement later". Todo step tem comando ou codigo explicito.
3. **Type consistency:** `DashboardResponse` definido em `useDashboardMetrics.ts` (Task 3) bate com o retorno do `getDashboardData` em `live-metrics.service.ts` (Task 2). Campos: `metrics, chartData, regions, lifetimeRevenue, recentSales`. Ordem dos campos em `metrics`: `grossRevenue, netRevenue, adSpend, roas, cpa, salesCount`.
4. **Edge case documentado:** `useProfitEvolution` continua lendo campo `monthlyBreakdown` que nunca existiu na resposta. Fica como dead code nao-bloqueante. Limpeza deferida.
