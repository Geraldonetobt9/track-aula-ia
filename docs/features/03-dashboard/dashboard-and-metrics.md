# Dashboard e Metricas

## 1. Proposito

Fornecer uma visao consolidada e em tempo real do desempenho das campanhas de marketing do usuario. O Dashboard e a pagina principal da plataforma e exibe metricas financeiras (faturamento, gasto, lucro), indicadores de performance (ROAS, CPA, vendas), graficos de evolucao, barra de progresso de receita, globo de vendas por regiao e painel de vendas recentes.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Rota         | Descricao                                  | Protegida |
|--------------|--------------------------------------------|-----------|
| `/dashboard` | Pagina principal com visao geral de metricas| Sim       |
| `/`          | Redireciona automaticamente para `/dashboard`| -        |

### 2.2 Fluxo de UI

**Layout principal:**
O Dashboard e dividido em grid de duas colunas no desktop (`lg:grid-cols-[1fr_0.28fr]`):
- Coluna esquerda: Cards de metricas (grid 3x2) + grafico de linha + globo de vendas
- Coluna direita: Painel de vendas em tempo real (full height)

**Seletor de periodo:**
1. Componente `DateRangeFilter` no header
2. Presets: Hoje, Ontem, Ultimos 7 dias, Ultimos 30 dias, Este mes, Mes passado, Todo periodo, Personalizado
3. Periodo selecionado e serializado na URL como query params (`?period=last_7d` ou `?period=custom&from=2026-01-01&to=2026-01-31`)
4. Ao mudar periodo, `useDashboardMetrics` refaz a chamada a API

**"Todo periodo" nao manda datas.** O preset marca a flag `allTime` no `DateRange`
e o hook envia `period=all` em vez de `from`/`to`. As datas que o preset carrega
sao placeholders, so para o tipo continuar `{ from: Date; to: Date }`.

O inicio real e resolvido no backend por `LiveMetricsService.resolveAllTimeStart`:
a primeira venda do workspace, limitada a 36 meses atras. O limite existe porque
o Insights do Facebook para de devolver gasto alem disso.

O motivo de nao mandar data do frontend e concreto: **faturamento e gasto com ads
precisam cair na mesma janela**. Quando o `from` fica em aberto, o faturamento
agrega a tabela inteira enquanto o gasto cai no default de 30 dias do
`resolveRange` — faturamento completo dividido por um mes de gasto, que aparece
como um ROAS excelente e falso. Esse bug ja foi para producao uma vez no
`/financial`. Resolver o inicio uma vez, no comeco de `getDashboardData`, e o que
garante que as duas metricas leiam o mesmo `from`.

`resolveAllTimeStart` e compartilhado com o `FinancialService`. As duas telas
precisam responder "todo periodo" igual, senao o mesmo workspace mostra dois
lucros diferentes.

**Consequencia aceita:** se houver vendas com mais de 36 meses, "todo periodo"
nao as inclui. Incluir quebraria o ROAS, ja que nao existe gasto correspondente
para buscar.

**Filtro de produto:**
1. Componente `ProductFilter` no header, ao lado do `AdAccountFilter`
2. Multi-selecao via Popover com checkboxes; opcao "Todos os produtos" limpa a selecao
3. Lista os produtos distintos do workspace (`GET /api/sales/products` via `useSalesProducts`)
4. Campo de busca aparece quando o workspace tem mais de 8 produtos
5. Oculto quando o workspace tem 0 ou 1 produto (filtro nao teria efeito)
6. Selecao vazia = todos os produtos; nesse caso o param `product_names` nao e enviado
7. Selecao nao e persistida na URL (reseta ao recarregar), igual ao `AdAccountFilter`
8. Afeta faturamento, vendas, grafico, regioes e vendas recentes — **nao afeta o gasto com Ads**

**Cards de metricas (grid 3x2):**
| Posicao | Card               | Prefixo | Sufixo | Cor condicional                          |
|---------|--------------------|---------|--------|------------------------------------------|
| 1       | Faturamento Bruto  | R$      | -      | -                                        |
| 2       | Gasto com Ads      | R$      | -      | -                                        |
| 3       | Lucro              | R$      | -      | Verde se > 0, vermelho se < 0            |
| 4       | Vendas Aprovadas   | -       | -      | -                                        |
| 5       | ROAS               | -       | x      | Verde se > 1, vermelho se > 0 e < 1     |
| 6       | CPA                | R$      | -      | -                                        |

Cada card exibe:
- Titulo em uppercase tracking-wider
- Valor formatado em pt-BR
- Icone contextual (DollarSign, BarChart3, Target, ShoppingCart)
- Skeleton loading enquanto carrega

**Grafico Faturamento vs Gasto:**
- Tipo: LineChart (Recharts)
- Duas linhas: Revenue (cor #d1fe17, solida) e Spend (cinza, tracejada)
- Eixo X: datas, Eixo Y: valores em `R$ Xk`
- Tooltip customizado com fundo escuro e blur
- Dados vem de `chartData` retornado por `useDashboardMetrics` (pontos diarios sorted asc)

**Globo de vendas por regiao (SalesGlobe):**
- Componente 3D mostrando distribuicao geografica de vendas
- Dados de `regions` retornados por `useDashboardMetrics` (recebidos via props)
- Ocupa 1 coluna ao lado do grafico de linha (que ocupa 2)

**Barra de progresso de receita (RevenueProgressBar):**
- Exibida no header, visivel apenas em telas `lg+`
- Milestones: 0 -> 10k -> 100k -> 500k -> 1M
- Valor de `lifetimeRevenue` fornecido via props a partir de `useDashboardMetrics`
- Barra animada com gradiente verde (#d1fe17)
- Exibe valor atual formatado (ex: `R$ 45k`) e proximo milestone

**Painel de vendas em tempo real (RealtimeSalesPanel):**
- Lista as 9 vendas aprovadas mais recentes do periodo selecionado
- Dados de `recentSales` fornecidos via props a partir de `useDashboardMetrics`
- Cada venda exibe: nome do produto, valor formatado em BRL, horario (HH:mm)
- Estilo de notificacao mobile com icone DollarSign em fundo verde
- Se sem vendas: "Sem vendas no periodo"

**Empty states:**
- Sem workspace: "Crie sua primeira area" com explicacao
- Workspace sem conexoes: "Area vazia" com botao "Ir para Integracoes"

**Acoes do header:**
- WorkspaceSwitcher (variante inline)
- AdAccountFilter (multi-selecao de contas de anuncio)
- ProductFilter (multi-selecao de produtos)
- DateRangeFilter
- SyncButton (sincronizacao manual)
- Botao refresh (icone RefreshCw com animacao spin)

### 2.3 Permissoes

| Acao                        | Permissao Necessaria     |
|-----------------------------|--------------------------|
| Visualizar Dashboard        | Usuario autenticado       |
| Filtrar por periodo         | Usuario autenticado       |
| Filtrar por produto         | Usuario autenticado       |
| Refresh manual              | Usuario autenticado       |
| Dados de outro usuario      | Admin (via impersonation) |

---

## 3. Regras de Negocio

| #  | Regra                                    | Condicao                                          | Resultado Esperado                                       |
|----|------------------------------------------|---------------------------------------------------|----------------------------------------------------------|
| 1  | ROAS = grossRevenue / adSpend            | adSpend > 0                                       | ROAS calculado; se adSpend = 0, ROAS = 0                 |
| 2  | CPA = adSpend / salesCount               | salesCount > 0                                    | CPA calculado; se salesCount = 0, CPA = 0                |
| 3  | Lucro = grossRevenue - adSpend           | Sempre                                            | Pode ser negativo (prejuizo)                             |
| 4  | grossRevenue                             | Vendas approved no periodo                        | Soma de `amount` de vendas com `status = 'approved'`     |
| 5  | adSpend                                  | Periodo selecionado                               | Soma de `spend` dos insights diarios do Facebook Ads no periodo via aggregateAdSpend (dados ao vivo da Graph API, nao da tabela `daily_ad_spend`) |
| 6  | netRevenue                               | Sempre                                            | `grossRevenue - adSpend`                                 |
| 7  | salesCount                               | Vendas approved no periodo                        | Count de vendas com `status = 'approved'`                |
| 8  | Todas as agregacoes no backend           | Sempre                                            | Frontend apenas renderiza; nao faz calculos de metrica   |
| 9  | Vendas filtradas por workspace           | Workspace ativo com checkouts e produtos          | Apenas vendas dos checkouts e produtos mapeados           |
| 10 | Gasto filtrado por conexao               | Workspace ativo com conexoes Facebook              | Apenas gasto das contas de anuncio vinculadas             |
| 11 | lifetimeRevenue ignora filtro de periodo | Sempre                                            | Soma all-time de sales.amount WHERE status='approved' no workspace |
| 12 | recentSales                              | Periodo selecionado                               | Ate 9 vendas approved mais recentes (id, product_name, sold_at, amount) |
| 13 | regions.percentage                       | Havendo vendas com estado definido                | Soma de percentages = 100 para vendas com customer_state |
| 14 | chartData sorted asc                     | Sempre                                            | Pontos diarios em ordem crescente de data                |
| 15 | Periodo default                          | Primeiro acesso sem params na URL                 | Usa `getDefaultDateRange()` (ultimos 7 dias)              |
| 16 | Periodo persistido na URL                | Usuario muda periodo                              | Query params atualizados (`?period=last_7d`)              |
| 17 | Sem workspace ativo                      | `activeWorkspaceId` null                           | Dados nao sao buscados; loading encerra imediatamente     |
| 18 | Sem dados no periodo                     | Nenhuma venda ou campanha no intervalo            | Badge "Sem dados" exibido no header                       |
| 19 | Filtro de produto aplicado               | Usuario seleciona 1+ produtos no `ProductFilter`  | `product_names` enviado a API; RPC `dashboard_metrics` filtra grossRevenue, salesCount, chartData, regions e recentSales por `sales.product_name` |
| 20 | Filtro de produto nao afeta adSpend      | Filtro de produto aplicado                        | `adSpend` continua sendo o gasto total das contas de anuncio (Meta nao expoe gasto por produto); logo ROAS, CPA e Lucro comparam receita filtrada com gasto total |
| 21 | Filtro de produto nao afeta lifetimeRevenue | Filtro de produto aplicado                     | Barra de milestone segue usando a receita all-time do workspace inteiro (por design no RPC) |

---

## 4. Modelo de Dados

### 4.1 Tabelas

O Dashboard e uma view de leitura que agrega dados de multiplas tabelas:

**sales** (leitura)
| Coluna                  | Tipo      | Relevancia para Dashboard         |
|-------------------------|-----------|-----------------------------------|
| amount                  | numeric   | Faturamento bruto e lifetimeRevenue|
| status                  | text      | Filtro: apenas `approved`         |
| sold_at                 | timestamp | Filtro de periodo e chartData     |
| customer_state          | text      | Agrupamento por regiao            |
| product_name            | text      | Filtro por workspace products; recentSales |
| checkout_integration_id | uuid      | Filtro por workspace checkouts    |
| user_id                 | uuid      | Isolamento por usuario            |

**Facebook Graph API** (leitura ao vivo, via `fetchAllConnectionsDailyInsights`)
| Campo  | Tipo      | Relevancia para Dashboard  |
|--------|-----------|----------------------------|
| date   | date      | Dados para grafico diario  |
| spend  | numeric   | Gasto por dia              |

Obs: o Dashboard NAO le da tabela persistida `daily_ad_spend` — essa tabela serve outros fluxos (funil, historico de sync). O adSpend do Dashboard e obtido em tempo real da Graph API v22.0 para cada conexao ativa, filtrado pelo periodo e `connection_ids` quando fornecidos.

### 4.2 Relacionamentos

- Agrega vendas da tabela `sales` (periodo + all-time lifetime)
- Agrega gasto via Facebook Graph API (tempo real por conexao ativa)
- Filtrados por `workspace_connections` e `workspace_checkout_integrations`

### 4.3 Constraints

- RLS em todas as tabelas: `user_id = auth.uid()`
- `sales.status` filtrado como `approved` nas queries do dashboard

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path                        | Guard     | Descricao                                                    |
|--------|-----------------------------|-----------|--------------------------------------------------------------|
| GET    | `/api/metrics/dashboard`    | AuthGuard | Retorna objeto consolidado com metricas, grafico, regioes, lifetimeRevenue e vendas recentes |

**Parametros de `/api/metrics/dashboard`:**
| Param          | Tipo   | Obrigatorio | Descricao                                         |
|----------------|--------|-------------|---------------------------------------------------|
| workspace_id   | string | Sim         | UUID do workspace ativo                            |
| from           | string | Nao         | Data inicio (YYYY-MM-DD)                           |
| to             | string | Nao         | Data fim (YYYY-MM-DD)                              |
| connection_ids | string | Nao         | UUIDs de conexoes Facebook, separados por virgula  |
| checkout_ids   | string | Nao         | IDs de checkout separados por virgula              |
| product_names  | string | Nao         | Nomes de produtos separados por virgula            |
| target_user_id | string | Nao         | ID do usuario alvo (somente admin impersonando)    |

**Shape da resposta:**

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

### 5.2 Logica do Service

**MetricsService.getDashboardData:**
1. Recebe `userId` (ou `targetUserId` via impersonation) e filtros (workspace_id, from, to, connection_ids, checkout_ids, product_names)
2. Busca vendas approved no periodo, filtradas por checkout_ids e product_names
3. Busca gastos diarios no periodo via helper `aggregateAdSpend` (chama Facebook Graph API ao vivo — curto-circuita retornando 0 quando nao ha conexoes ativas)
4. Calcula metricas: `grossRevenue`, `adSpend`, `netRevenue`, `roas`, `cpa`, `salesCount`
5. Gera `chartData`: pontos diarios (revenue e spend por data), sorted asc
6. Gera `regions`: vendas approved agrupadas por `customer_state` com percentual
7. Busca `lifetimeRevenue`: soma all-time de `sales.amount WHERE status='approved'` no workspace (ignora filtro de periodo)
8. Busca `recentSales`: ate 9 vendas approved mais recentes do periodo (id, product_name, sold_at, amount)
9. Retorna objeto consolidado com todos os campos acima

> Nota de implementacao: as agregacoes de vendas rodam no Postgres via a RPC `public.dashboard_metrics(...)`, que retorna `gross_revenue`, `sales_count`, `lifetime_revenue`, `chart_data`, `regions` e `recent_sales` em um unico jsonb (uma round trip). A atribuicao por ad usa a RPC `public.sales_grouped_by_ad(...)`. Os SUMs/COUNTs nao trafegam linhas pela rede, evitando o cap de 1000 linhas do PostgREST e o overhead de transferir dezenas de milhares de vendas. As funcoes sao restritas a `service_role` (definidas em `supabase/migrations/20260428100000_dashboard_aggregation_rpcs.sql`).

---

## 6. Implementacao no Frontend

### 6.1 Paginas/Componentes

| Componente           | Arquivo                                        | Descricao                                      |
|----------------------|------------------------------------------------|------------------------------------------------|
| Dashboard            | `src/pages/Dashboard.tsx`                      | Pagina principal com layout completo           |
| MetricCard           | `src/pages/Dashboard.tsx` (inline)             | Card individual de metrica                     |
| RevenueProgressBar   | `src/pages/Dashboard.tsx` (inline)             | Barra de progresso; recebe `lifetimeRevenue` via props |
| RealtimeSalesPanel   | `src/pages/Dashboard.tsx` (inline)             | Lista vendas recentes; recebe `recentSales` via props |
| SalesGlobe           | `src/components/dashboard/SalesGlobe.tsx`      | Globo 3D; recebe `regions` via props           |
| DateRangeFilter      | `src/components/DateRangeFilter.tsx`           | Seletor de periodo com presets                 |
| AdAccountFilter      | `src/components/AdAccountFilter.tsx`           | Multi-selecao de contas de anuncio Facebook    |
| ProductFilter        | `src/components/ProductFilter.tsx`             | Multi-selecao de produtos, com busca acima de 8 itens |
| WorkspaceSwitcher    | `src/components/WorkspaceSwitcher.tsx`          | Seletor de area de trabalho                    |
| SyncButton           | `src/components/SyncButton.tsx`                | Botao de sincronizacao manual                  |

### 6.2 Hooks

| Hook                | Arquivo                               | Descricao                                                     |
|---------------------|---------------------------------------|---------------------------------------------------------------|
| useDashboardMetrics | `src/hooks/useDashboardMetrics.ts`    | Busca o objeto consolidado de `/metrics/dashboard` e faz pass-through dos dados. Assinatura: `(dateRange, connectionIds?, productNames?)` |
| useSalesProducts    | `src/hooks/useSalesProducts.ts`       | Lista os produtos distintos do workspace para o `ProductFilter` (TanStack Query, `staleTime` 5 min) |

O dashboard **nao** usa `useSales` nem chama `/sales` diretamente. Todos os dados do painel (vendas recentes, barra de progresso, globo) vem de `useDashboardMetrics`.

### 6.3 Estado

**useDashboardMetrics** retorna:
- `metrics: DashboardMetrics` — { grossRevenue, netRevenue, adSpend, roas, cpa, salesCount }
- `chartData: ChartDataPoint[]` — Array de `{ date, revenue, spend }` para o grafico
- `regions: RegionData[]` — Array de `{ state, sales, revenue, percentage }` para o globo
- `lifetimeRevenue: number` — Receita total acumulada (sem filtro de periodo)
- `recentSales: RecentSale[]` — Array de ate 9 vendas recentes `{ id, product_name, sold_at, amount }`
- `loading: boolean`
- `refetch()` — Funcao para recarregar dados

**Estado local do Dashboard:**
- `dateRange: DateRange` — Periodo selecionado (inicializado da URL ou default)
- `selectedConnectionIds: string[]` — Contas de anuncio filtradas (vazio = todas)
- `selectedProducts: string[]` — Produtos filtrados (vazio = todos)
- `refreshing: boolean` — Animacao do botao refresh

**Dependencias de recarga:**
- `effectiveId` (muda com impersonation)
- `activeWorkspaceId` (muda com troca de workspace)
- `dateRange.from` / `dateRange.to`
- `activeConnectionId`
- `activeCheckoutIds`
- `activeProductNames`
- `refetchSignal` (trigger manual via RefetchContext)

---

## 7. Pontos de Integracao

| Sistema            | Tipo        | Descricao                                                  |
|--------------------|-------------|-------------------------------------------------------------|
| WorkspaceContext   | Contexto    | Filtra dados por conexoes, checkouts e produtos do workspace|
| ImpersonationCtx  | Contexto    | Admin pode ver dashboard de outro usuario via `target_user_id` |
| ActiveConnectionCtx| Contexto   | Filtro adicional por conexao Facebook especifica            |
| RefetchContext     | Contexto    | Sinal de reload apos sincronizacao                          |
| URL Query Params   | Browser     | Periodo persistido na URL para compartilhamento             |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario                                          | Tratamento                                                    |
|--------------------------------------------------|---------------------------------------------------------------|
| Sem workspace ativo                              | `fetchData` retorna imediatamente; nao faz chamada API        |
| Sem dados no periodo                             | Metricas retornam zeros; badge "Sem dados" exibido            |
| Erro na API de metricas                          | `error` setado; console.error logado                          |
| Workspace sem produtos mapeados                  | Query usa `['__no_product_mapped__']` = zero vendas           |
| Sem vendas approved                              | salesCount = 0; recentSales = []; painel exibe "Sem vendas no periodo" |
| adSpend = 0                                      | roas = 0, cpa = 0                                             |
| Periodo customizado sem selecao completa         | Fallback para ultimos 30 dias                                 |
| URL com parametros invalidos de data             | `parseDateRangeFromParams` retorna `getDefaultDateRange()`    |
| lifetimeRevenue > 1M                             | Progresso fixado em 100% no ultimo segmento da barra          |
| Formato de moeda para valores grandes           | `toLocaleString('pt-BR')` com minFractionDigits: 2           |

---

## 9. Checklist de Testes

- [ ] Cards de metricas exibem valores corretos para o periodo selecionado
- [ ] ROAS exibe cor verde quando > 1, vermelho quando < 1
- [ ] Lucro exibe cor verde quando positivo, vermelho quando negativo
- [ ] Grafico de linha renderiza faturamento e gasto por dia
- [ ] Seletor de periodo altera dados e URL corretamente
- [ ] Periodo customizado com calendario funciona
- [ ] Barra de progresso calcula milestone atual corretamente com lifetimeRevenue
- [ ] Painel de vendas mostra ate 9 vendas recentes do periodo
- [ ] Globo de vendas renderiza dados de regioes sem erros
- [ ] Troca de workspace recarrega todos os dados
- [ ] Botao refresh executa refetch
- [ ] SyncButton dispara sincronizacao
- [ ] Empty state exibido sem workspace
- [ ] Empty state exibido com workspace sem conexoes
- [ ] Skeleton loading exibido durante carregamento
- [ ] Admin pode ver dashboard de outro usuario via impersonation

---

## 10. Questoes Abertas / TODOs

- [ ] O painel de vendas em tempo real nao usa WebSocket/Realtime. Depende de polling via refetch.
- [ ] O grafico nao tem opcao de zoom ou drill-down.
- [ ] Considerar adicionar comparativo visual (overlay) do periodo anterior no grafico de linha.
- [ ] A barra de progresso nao considera receita de periodos especificos (sempre total — campo `lifetimeRevenue`).
