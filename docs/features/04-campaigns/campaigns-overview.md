# Campanhas - Visao Geral

## 1. Proposito

Fornecer uma visao hierarquica e detalhada das campanhas de Facebook Ads do usuario, com metricas de performance calculadas por dois modelos de atribuicao: Last Click (vendas reais atribuidas via ad_id do checkout) e Meta Attribution (conversoes reportadas pelo pixel da Meta). A pagina permite navegar pela hierarquia Campanhas -> Conjuntos de Anuncios -> Anuncios com breadcrumb, filtros de busca e periodo, e graficos de top anuncios e funil de conversao.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Rota         | Descricao                                       | Protegida |
|--------------|-------------------------------------------------|-----------|
| `/campaigns` | Pagina de campanhas com navegacao hierarquica    | Sim       |

### 2.2 Fluxo de UI

**Navegacao hierarquica (3 niveis):**
1. **Nivel 1 - Campanhas:** Lista todas as campanhas com metricas agregadas
2. **Nivel 2 - Conjuntos de Anuncios:** Clicando em uma campanha, exibe seus ad sets
3. **Nivel 3 - Anuncios:** Clicando em um ad set, exibe seus anuncios individuais

**Breadcrumb:**
- Visivel a partir do nivel 2
- Formato: `Campanhas > Nome da Campanha > Nome do Conjunto`
- Cada nivel e clicavel para voltar (exceto o nivel atual, que e texto simples)
- Botoes de voltar: `handleBackToCampaigns()` e `handleBackToAdSets()`

**Modos de atribuicao (Tabs):**
- `lastclick`: Vendas reais atribuidas via `ad_id` presente no evento de venda do checkout. Tooltip: "Vendas reais atribuidas via ad_id"
- `meta`: Conversoes reportadas pelo pixel da Meta. Tooltip: "Conversoes reportadas pelo pixel da Meta"
- Troca de aba recarrega dados automaticamente (hooks diferentes para cada modo)

**Modo privacidade (botao de olho no header):**
- Alterna o borrado de **nome**, **orcamento** e **gasto** nas tres tabelas (campanhas, conjuntos, anuncios), incluindo a linha de totais.
- Colunas de resultado (vendas, receita, ROAS, CPA, impressoes, cliques) seguem visiveis: o objetivo e esconder quanto se investe e em que, nao os indicadores.
- Compartilha o estado com o botao do Dashboard via `usePrivacyMode` (`localStorage: sentinel_dashboard_privacy`), entao ligar em uma tela liga na outra.
- O borrado e visual: o valor continua no DOM. Serve para quem esta ao lado da tela, nao para negar dado ao proprio usuario.

**Filtros:**
- Campo de busca por texto (filtra por nome)
- Seletor de periodo: Hoje, Ontem, Ultimos 7 dias (default), Ultimos 30 dias, Personalizado
- Periodo personalizado: calendario duplo com selecao de range (ptBR locale)
- Filtro de status: Todos, Ativos, Pausados
- Indicador textual do periodo selecionado abaixo dos filtros

**Top Ads Chart:**
- Exibido apenas no nivel de campanhas (nao em ad sets ou ads)
- Modo Last Click: dados do hook `useTopAds` (top 10 anuncios por vendas)
- Modo Meta: dados derivados de `metaAds` filtrados e ordenados por sales
- Campos: nome, vendas, faturamento, gasto, roas

**Funil de conversao (ConversionFunnel):**
- Exibido apenas no nivel de campanhas
- 4 etapas: Link Clicks -> Landing Page Views -> Initiated Checkouts -> Sales
- Dados do hook `useCampaignsFunnel` (Last Click) ou `useMetaCampaignsFunnel` (Meta)
- Endpoint: `GET /api/metrics/daily-spend` com parametro `campaign_ids`

**Tabelas de dados:**
- `CampaignsTable`: campanhas com colunas de metricas + clique para drill-down
- `AdSetsTable`: conjuntos com colunas de metricas + clique para drill-down
- `AdsTable`: anuncios com colunas de metricas (nivel final)
- Paginacao: 10 itens por pagina
- Cada tabela tem paginacao independente (campaignsPage, adSetsPage, adsPage)
- Todas as tabelas exibem a coluna "Checkouts" (header curto; tooltip com o nome oficial "Finalizacoes de compra iniciadas") entre "ROAS" e "CPA", ordenavel e somada no footer da tabela de Campanhas. Vem direto do campo `actions` do Insights API da Meta, deduplicando via `max` as variantes `offsite_conversion.fb_pixel_initiate_checkout`, `onsite_web_initiate_checkout`, `onsite_web_app_initiate_checkout`, `omni_initiated_checkout` e `initiate_checkout` (a mesma logica ja aplicada a compras).

**Empty states:**
- Sem workspace: "Nenhuma area criada"
- Workspace sem conexoes: "Area vazia" com link para Integracoes
- Sem dados no periodo: badge "Sem dados" no header

### 2.3 Permissoes

| Acao                          | Permissao Necessaria     |
|-------------------------------|--------------------------|
| Visualizar campanhas          | Usuario autenticado       |
| Filtrar por periodo/status    | Usuario autenticado       |
| Navegar na hierarquia         | Usuario autenticado       |
| Dados de outro usuario        | Admin (via impersonation) |

---

## 3. Regras de Negocio

| #  | Regra                                    | Condicao                                              | Resultado Esperado                                       |
|----|------------------------------------------|-------------------------------------------------------|----------------------------------------------------------|
| 1  | Dois modos de atribuicao                 | Tab selecionada                                       | Last Click usa vendas reais; Meta usa conversoes do pixel|
| 2  | Deduplicacao por facebook_campaign_id    | Multiplos registros com mesmo facebook_campaign_id     | Backend mantem apenas o registro com maior spend         |
| 3  | Filtro de objetivo                       | Campanhas da Meta                                     | Apenas campanhas com objective `OUTCOME_SALES`           |
| 4  | Metricas por campanha                    | Periodo selecionado                                   | spend, sales, revenue, ROAS, CPA agregados              |
| 5  | ROAS = Revenue / Spend                   | Spend > 0                                             | Calculado por campanha/ad set/ad                         |
| 6  | CPA = Spend / Sales                      | Sales > 0                                             | Calculado por campanha/ad set/ad                         |
| 7  | Top Ads limitado a 10                    | Ordenacao por vendas                                  | Top 10 anuncios com sales > 0                            |
| 8  | Funil usa campaign_ids visiveis          | Lista de campanhas filtradas                          | Passa `campaign_ids` para o endpoint de funil            |
| 9  | Periodo default                          | Primeiro acesso                                       | Ultimos 30 dias                                          |
| 10 | Filtro de status no frontend             | Selecao "Ativos", "Pausados" ou "Todos"              | Filtragem client-side nos dados retornados               |
| 11 | Busca por nome no frontend               | Texto digitado no campo de busca                      | Filtragem client-side por nome                           |
| 12 | Paginacao independente por nivel         | Navegacao entre niveis                                | Cada nivel mantem sua propria pagina atual                |
| 13 | Reset de paginacao ao navegar            | Clique em campanha ou ad set                          | adSetsPage e adsPage resetados para 1                    |
| 14 | Finalizacoes de compra iniciadas (Initiate Checkout) | `actions` retornado pelo Insights API para cada nivel | Soma por registro aplicando `max` entre as variantes do action_type para evitar dupla contagem |

---

## 4. Modelo de Dados

### 4.1 Tabelas

**campaigns**
| Coluna               | Tipo      | Descricao                            |
|----------------------|-----------|--------------------------------------|
| id                   | uuid (PK) | Identificador interno                |
| user_id              | uuid (FK) | Dono da campanha                     |
| name                 | text      | Nome da campanha                     |
| status               | text      | ACTIVE, PAUSED, etc.                |
| spend                | numeric   | Gasto total                          |
| impressions          | integer   | Total de impressoes                  |
| clicks               | integer   | Total de cliques                     |
| conversions          | integer   | Conversoes reportadas pela Meta      |
| cpc                  | numeric   | Custo por clique                     |
| cpm                  | numeric   | Custo por mil impressoes             |
| ctr                  | numeric   | Taxa de cliques                      |
| facebook_campaign_id | text      | ID no Facebook (para deduplicacao)   |
| objective            | text      | Objetivo da campanha                 |
| daily_budget         | numeric   | Orcamento diario                     |
| lifetime_budget      | numeric   | Orcamento vitalicio                  |
| date_start           | timestamp | Inicio do periodo de metricas        |
| date_end             | timestamp | Fim do periodo de metricas           |
| synced_at            | timestamp | Ultima sincronizacao                 |
| created_at           | timestamp | Data de criacao                      |
| updated_at           | timestamp | Ultima atualizacao                   |

### 4.2 Relacionamentos

- `campaigns.user_id` -> `auth.users.id`
- `ad_sets.campaign_id` -> `campaigns.id`
- `ads.ad_set_id` -> `ad_sets.id`
- Vendas ligadas via `facebook_ad_id` na tabela `sales`

### 4.3 Constraints

- RLS: `user_id = auth.uid()`
- Deduplicacao por `facebook_campaign_id` (backend mantem registro com maior spend)
- `status` aceita valores do Facebook API (ACTIVE, PAUSED, DELETED, ARCHIVED)

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path                          | Guard     | Descricao                                         |
|--------|-------------------------------|-----------|----------------------------------------------------|
| GET    | `/api/metrics/campaigns`      | AuthGuard | Lista campanhas com metricas (aceita `source=meta`)|
| GET    | `/api/metrics/ad-sets`        | AuthGuard | Lista ad sets com metricas                         |
| GET    | `/api/metrics/ads`            | AuthGuard | Lista ads com metricas                             |
| GET    | `/api/metrics/daily-spend`    | AuthGuard | Dados de funil e gasto diario                      |

**Parametros comuns:**
| Param          | Tipo   | Descricao                              |
|----------------|--------|----------------------------------------|
| from           | string | Data inicio (yyyy-MM-dd)               |
| to             | string | Data fim (yyyy-MM-dd)                  |
| connection_id  | string | Filtro por conexao Facebook            |
| campaign_id    | string | Filtro por campanha (para ad sets)     |
| ad_set_id      | string | Filtro por ad set (para ads)           |
| source         | string | `meta` para atribuicao Meta            |
| target_user_id | string | ID do usuario alvo (admin)             |
| campaign_ids   | string | IDs de campanhas para funil (separados por virgula) |
| checkout_ids   | string | IDs de checkout para funil             |
| product_names  | string | Nomes de produtos para funil           |

### 5.2 Logica do Service

**MetricsService.getCampaigns:**
1. Busca campanhas do usuario no periodo
2. Se `source=meta`, usa conversoes do pixel; senao, faz join com vendas reais via ad_id
3. Calcula metricas agregadas: spend, sales, revenue, roas, cpa_real
4. Deduplica por `facebook_campaign_id` mantendo maior spend
5. Filtra por `objective = OUTCOME_SALES` quando aplicavel

**MetricsService.getDailyAdSpend (funil):**
1. Agrega dados de insights: link_clicks, landing_page_views
2. Conta initiated_checkouts dos eventos
3. Conta sales das vendas aprovadas
4. Retorna: linkClicks, landingPageViews, initiateCheckouts, sales

---

## 6. Implementacao no Frontend

### 6.1 Paginas/Componentes

| Componente       | Arquivo                                        | Descricao                                    |
|------------------|------------------------------------------------|----------------------------------------------|
| Campaigns        | `src/pages/Campaigns.tsx`                      | Pagina principal com logica de navegacao      |
| CampaignsTable   | `src/components/campaigns/CampaignsTable.tsx`  | Tabela de campanhas com paginacao            |
| AdSetsTable      | `src/components/campaigns/AdSetsTable.tsx`     | Tabela de conjuntos de anuncios              |
| AdsTable         | `src/components/campaigns/AdsTable.tsx`        | Tabela de anuncios                           |
| TopAdsChart      | `src/components/campaigns/TopAdsChart.tsx`     | Grafico de barras dos top 10 anuncios        |
| ConversionFunnel | `src/components/dashboard/ConversionFunnel.tsx`| Funil de conversao visual                    |
| StatusSelect     | `src/components/campaigns/StatusSelect.tsx`    | Seletor de status (ACTIVE/PAUSED)            |
| BudgetEditModal  | `src/components/campaigns/BudgetEditModal.tsx` | Modal de edicao de orcamento                 |
| privacyBlurClass | `src/lib/privacyBlur.ts`                       | Classes do borrado de privacidade, compartilhadas pelas tabelas |

As tres tabelas aceitam `blurValues?: boolean` e aplicam `privacyBlurClass()` nas celulas de nome, orcamento e gasto. A pagina passa `isPrivacyHidden` de `usePrivacyMode` para as tres.

### 6.2 Hooks

| Hook                    | Arquivo                               | Descricao                                     |
|-------------------------|---------------------------------------|------------------------------------------------|
| useCampaigns            | `src/hooks/useCampaigns.ts`           | Campanhas com metricas Last Click              |
| useMetaCampaigns        | `src/hooks/useMetaCampaigns.ts`       | Campanhas com metricas Meta (source=meta)      |
| useAdSets               | `src/hooks/useAdSets.ts`              | Ad sets com metricas Last Click                |
| useMetaAdSets           | `src/hooks/useMetaAdSets.ts`          | Ad sets com metricas Meta                      |
| useAds                  | `src/hooks/useAds.ts`                 | Ads com metricas Last Click                    |
| useMetaAds              | `src/hooks/useMetaAds.ts`             | Ads com metricas Meta                          |
| useTopAds               | `src/hooks/useTopAds.ts`              | Top 10 ads por vendas (Last Click)             |
| useCampaignsFunnel      | `src/hooks/useCampaignsFunnel.ts`     | Dados de funil Last Click                      |
| useMetaCampaignsFunnel  | `src/hooks/useMetaCampaignsFunnel.ts` | Dados de funil Meta                            |
| useCampaignStatusUpdate | `src/hooks/useCampaignStatusUpdate.ts`| Alteracao de status via Facebook API           |

### 6.3 Estado

**Estado local do Campaigns:**
- `attributionMode: 'lastclick' | 'meta'` - Modo de atribuicao selecionado
- `search: string` - Texto de busca
- `statusFilter: string` - Filtro de status (all, active, paused)
- `periodOption: 'today' | 'yesterday' | '7d' | '30d' | 'custom'` - Preset de periodo
- `customDateRange: { from: Date, to: Date }` - Range customizado
- `selectedCampaign: { id, name } | null` - Campanha selecionada (nivel 2)
- `selectedAdSet: { id, name } | null` - Ad set selecionado (nivel 3)
- `campaignsPage, adSetsPage, adsPage: number` - Paginacao por nivel
- `currentView` (derivado): `'campaigns' | 'adsets' | 'ads'`

**Interfaces de dados:**
- `CampaignWithMetrics`: Campaign + sales, revenue, roi, roas, cpa_real
- `AdSetWithMetrics`: AdSet + sales, revenue, campaign_name, roi, roas, cpa_real
- `AdWithMetrics`: Ad + sales, revenue, ad_set_name, roi, roas, cpa_real

---

## 7. Pontos de Integracao

| Sistema            | Tipo        | Descricao                                                  |
|--------------------|-------------|-------------------------------------------------------------|
| WorkspaceContext   | Contexto    | Filtra conexoes e checkouts do workspace ativo              |
| ImpersonationCtx  | Contexto    | Admin ve campanhas de outro usuario                         |
| ActiveConnectionCtx| Contexto    | Filtro adicional por conexao Facebook especifica            |
| RefetchContext     | Contexto    | Recarrega dados apos sincronizacao                          |
| Facebook API       | REST        | Alteracao de status e orcamento via backend                 |
| SyncButton         | Acao        | Trigger de sincronizacao manual                             |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario                                          | Tratamento                                                  |
|--------------------------------------------------|-------------------------------------------------------------|
| Campanha sem vendas atribuidas (Last Click)      | sales = 0, revenue = 0, ROAS = 0, CPA = 0                  |
| Campanha com gasto zero                          | ROAS nao calculavel; exibe 0                                |
| Periodo customizado sem ambas as datas           | Fallback para ultimos 30 dias                               |
| Navegacao para ad set de campanha sem ad sets    | Lista vazia renderizada                                     |
| Deduplicacao de campanha                         | Backend mantem registro com maior spend                     |
| Top Ads sem vendas                               | Array vazio; grafico nao renderizado                        |
| Funil sem campaign_ids                           | Dados zerados; componente nao faz chamada API               |
| Erro de API nos hooks                            | console.error; loading encerra; dados permanecem vazios     |
| Muitos anuncios (> 100)                          | Paginacao de 10 itens por pagina                            |

---

## 9. Checklist de Testes

- [ ] Lista de campanhas exibe metricas corretas no modo Last Click
- [ ] Lista de campanhas exibe metricas corretas no modo Meta
- [ ] Clicar em campanha navega para nivel de ad sets
- [ ] Clicar em ad set navega para nivel de ads
- [ ] Breadcrumb exibe navegacao correta em cada nivel
- [ ] Busca por nome filtra campanhas/ad sets/ads
- [ ] Filtro de status funciona (Todos, Ativos, Pausados)
- [ ] Seletor de periodo altera dados exibidos
- [ ] Periodo customizado com calendario funciona
- [ ] Tab de atribuicao alterna entre Last Click e Meta
- [ ] Top Ads Chart exibe top 10 no nivel de campanhas
- [ ] Funil de conversao exibe 4 etapas com dados corretos
- [ ] Paginacao funciona em cada nivel
- [ ] Empty state exibido sem workspace ou conexoes
- [ ] Deduplicacao de campanhas funciona corretamente
- [ ] Refresh recarrega todos os dados

---

## 10. Questoes Abertas / TODOs

- [ ] Filtros de busca e status sao client-side. Para bases grandes, considerar mover para backend.
- [ ] O modo Meta nao filtra por `objective = OUTCOME_SALES` no frontend (depende do backend).
- [ ] useTopAds reutiliza o endpoint `/metrics/ads` e faz sort/slice no client. Considerar endpoint dedicado.
- [ ] Nao ha cache entre navegacoes de nivel (voltar para campanhas refaz a chamada API).
- [ ] Considerar adicionar export CSV/Excel das tabelas.
- [ ] Breadcrumb poderia ser persistido na URL para compartilhamento de deep links.
