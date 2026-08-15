# Anuncios (Ads)

## 1. Proposito

Exibir metricas detalhadas de cada anuncio individual dentro de um conjunto de anuncios (ad set). Este e o nivel mais granular da hierarquia Campanhas -> Conjuntos -> Anuncios, permitindo identificar quais criativos geram mais vendas, melhor ROAS e menor CPA. Complementado pelo grafico de Top Ads (top 10 por volume de vendas) e pelo funil de conversao que mapeia o caminho do clique ate a venda.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Local                    | Descricao                                              |
|--------------------------|--------------------------------------------------------|
| Pagina `/campaigns`      | Nivel 3 da hierarquia, acessado ao clicar em um ad set |

Nao possui rota dedicada. O nivel de ads e controlado pelo estado `selectedAdSet` na pagina de Campanhas.

### 2.2 Fluxo de UI

**Exibicao de anuncios:**
1. Usuario clica em um ad set na AdSetsTable
2. `handleAdSetClick(adSet)` seta `selectedAdSet` e reseta `adsPage` para 1
3. Breadcrumb muda para: `Campanhas > Nome da Campanha > Nome do Ad Set`
4. Titulo muda para "Anuncios"
5. Subtitulo: `Anuncios do conjunto "Nome do Ad Set"`
6. AdsTable renderizada com dados de `useAds` (Last Click) ou `useMetaAds` (Meta)

**Colunas da AdsTable:**
| Coluna       | Descricao                                    |
|--------------|----------------------------------------------|
| Nome         | Nome do anuncio                              |
| Status       | Badge ACTIVE/PAUSED com StatusSelect         |
| Gasto        | Total gasto no periodo (R$)                  |
| Impressoes   | Total de impressoes                          |
| Cliques      | Total de cliques                             |
| Vendas       | Vendas atribuidas (Last Click ou Meta)       |
| Faturamento  | Receita das vendas atribuidas (R$)           |
| ROAS         | Revenue / Spend                              |
| Checkouts    | Finalizacoes de compra iniciadas (Initiate Checkout) — `max` entre as variantes do `action_type` do Insights API da Meta |
| CPA          | Spend / Sales (R$)                           |

**Top Ads Chart (nivel de campanhas):**
O grafico de Top Ads e exibido no nivel de campanhas (nao no nivel de ads individual), mas documenta-se aqui por ser a visao analitica principal de ads.

Modo Last Click:
1. Hook `useTopAds` busca `/api/metrics/ads` sem filtro de ad_set_id
2. Filtra ads com `sales > 0`
3. Ordena por sales descendente
4. Pega os 10 primeiros
5. Mapeia para formato de chart: `{ name, vendas, faturamento, gasto, roas }`

Modo Meta:
1. Dados derivados de `useMetaAds` (todos os ads, sem filtro de ad set)
2. Mesma logica de filtro e sort
3. Titulo do grafico: "Top Anuncios por Conversoes (Meta)"

Componente `TopAdsChart` renderiza grafico de barras horizontais com:
- Nome do anuncio (eixo Y)
- Vendas/conversoes (barra principal)
- Tooltip com faturamento, gasto e ROAS

**Funil de conversao (nivel de campanhas):**
Exibido no nivel de campanhas, mostra o caminho de conversao agregado:

| Etapa                | Fonte de dados                  | Descricao                           |
|----------------------|---------------------------------|--------------------------------------|
| Link Clicks          | Facebook Insights (inline_link_clicks) | Cliques no link do anuncio    |
| Landing Page Views   | Facebook Insights (landing_page_view)  | Visualizacoes da pagina destino |
| Initiated Checkouts  | Facebook Insights (initiate_checkout)  | Inicio de checkout no pixel   |
| Sales                | Vendas aprovadas (Last Click) ou conversoes (Meta) | Vendas efetivas |

Hooks:
- Last Click: `useCampaignsFunnel(dateRange, campaignIds)` -> GET `/api/metrics/daily-spend?campaign_ids=...`
- Meta: `useMetaCampaignsFunnel(dateRange, campaignIds)` -> GET `/api/metrics/daily-spend?campaign_ids=...&source=meta`

Componente `ConversionFunnel` renderiza as 4 etapas com valores absolutos e taxas de conversao entre etapas.

### 2.3 Permissoes

| Acao                        | Permissao Necessaria     |
|-----------------------------|--------------------------|
| Visualizar anuncios         | Usuario autenticado       |
| Alterar status do anuncio   | Usuario autenticado (dono da conexao Facebook) |
| Ver Top Ads                 | Usuario autenticado       |
| Ver funil de conversao      | Usuario autenticado       |

---

## 3. Regras de Negocio

| #  | Regra                                    | Condicao                                              | Resultado Esperado                                       |
|----|------------------------------------------|-------------------------------------------------------|----------------------------------------------------------|
| 1  | Ads filtrados por ad_set_id              | Ad set selecionado                                    | Apenas ads do ad set selecionado exibidos                |
| 2  | Top Ads = top 10 por vendas              | Modo Last Click ou Meta                               | Ordenado por sales desc, limitado a 10, apenas sales > 0 |
| 3  | Top Ads no nivel de campanhas            | currentView === 'campaigns'                           | Grafico exibido apenas nesse nivel                       |
| 4  | Funil no nivel de campanhas              | currentView === 'campaigns'                           | ConversionFunnel exibido apenas nesse nivel              |
| 5  | Funil usa campaign_ids visiveis          | Lista de campanhas atual                              | campaign_ids passados como parametro                     |
| 6  | ROAS por anuncio                         | Spend do ad > 0                                       | ROAS = revenue / spend                                   |
| 7  | CPA por anuncio                          | Sales do ad > 0                                       | CPA = spend / sales                                      |
| 8  | Atribuicao Last Click                    | Venda com facebook_ad_id matching                     | Venda contabilizada no anuncio que a originou            |
| 9  | Atribuicao Meta                          | Conversoes do pixel por ad                            | Conversoes da Meta contabilizadas por anuncio            |
| 10 | Funil - taxa entre etapas               | Etapa anterior > 0                                    | Taxa = etapa_atual / etapa_anterior * 100                |
| 11 | Top Ads Meta derivado client-side        | Modo meta                                             | Dados de useMetaAds filtrados e ordenados no frontend    |
| 12 | Alteracao de status de ad                | facebook_ad_id presente, type='ad'                    | PATCH na Facebook API com type='ad'                      |

---

## 4. Modelo de Dados

### 4.1 Tabelas

**ads**
| Coluna         | Tipo      | Descricao                           |
|----------------|-----------|--------------------------------------|
| id             | uuid (PK) | Identificador interno                |
| user_id        | uuid (FK) | Dono do anuncio                      |
| ad_set_id      | uuid (FK) | Conjunto pai                         |
| name           | text      | Nome do anuncio                      |
| status         | text      | ACTIVE, PAUSED, etc.                |
| spend          | numeric   | Gasto total                          |
| impressions    | integer   | Total de impressoes                  |
| clicks         | integer   | Total de cliques                     |
| conversions    | integer   | Conversoes Meta                      |
| cpc            | numeric   | Custo por clique                     |
| cpm            | numeric   | Custo por mil impressoes             |
| ctr            | numeric   | Taxa de cliques                      |
| facebook_ad_id | text      | ID no Facebook (para atribuicao)     |
| date_start     | timestamp | Inicio do periodo de metricas        |
| date_end       | timestamp | Fim do periodo de metricas           |
| synced_at      | timestamp | Ultima sincronizacao                 |
| created_at     | timestamp | Data de criacao                      |
| updated_at     | timestamp | Ultima atualizacao                   |

**sales** (relacao com ads)
| Coluna         | Tipo      | Relevancia para Ads                  |
|----------------|-----------|--------------------------------------|
| facebook_ad_id | text      | Matching com ads.facebook_ad_id      |
| amount         | numeric   | Revenue atribuida ao ad              |
| status         | text      | Filtro: apenas `approved`            |

### 4.2 Relacionamentos

- `ads.ad_set_id` -> `ad_sets.id` (N:1)
- `ads.user_id` -> `auth.users.id` (N:1)
- `sales.facebook_ad_id` -> `ads.facebook_ad_id` (N:1, via join logico)

### 4.3 Constraints

- RLS: `user_id = auth.uid()`
- `ad_set_id` obrigatorio (todo ad pertence a um ad set)
- `facebook_ad_id` pode ser null (ads sem ID do Facebook nao recebem atribuicao)

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path                               | Guard     | Descricao                                    |
|--------|-------------------------------------|-----------|-----------------------------------------------|
| GET    | `/api/metrics/ads`                  | AuthGuard | Lista ads com metricas                        |
| GET    | `/api/metrics/daily-spend`          | AuthGuard | Dados de funil                                |
| PATCH  | `/api/facebook/campaigns/status`    | AuthGuard | Altera status do ad via Facebook API          |

**Parametros de `/api/metrics/ads`:**
| Param          | Tipo   | Descricao                              |
|----------------|--------|----------------------------------------|
| from           | string | Data inicio (yyyy-MM-dd)               |
| to             | string | Data fim (yyyy-MM-dd)                  |
| ad_set_id      | string | Filtro por ad set                      |
| connection_id  | string | Filtro por conexao Facebook            |
| source         | string | `meta` para atribuicao Meta            |
| target_user_id | string | ID do usuario alvo (admin)             |
| checkout_ids   | string | IDs de checkout (para Top Ads)         |
| product_names  | string | Nomes de produtos (para Top Ads)       |

### 5.2 Logica do Service

**MetricsService.getAds:**
1. Busca ads do usuario filtrados por periodo e opcionalmente por ad_set_id
2. Se `source=meta`, usa conversoes do pixel como metricas de vendas
3. Se Last Click, faz join com tabela `sales` via `facebook_ad_id` para calcular sales e revenue
4. Calcula metricas derivadas: roas = revenue / spend, cpa_real = spend / sales
5. Retorna array de AdWithMetrics

**Top Ads (client-side):**
1. `useTopAds` chama `/api/metrics/ads` sem `ad_set_id` (todos os ads)
2. Filtra `sales > 0`
3. Ordena por `sales` desc
4. Pega `slice(0, 10)`
5. Mapeia para `{ name, vendas, faturamento, gasto, roas }`

**Funil (MetricsService.getDailyAdSpend):**
1. Agrega `inline_link_clicks` de insights das campanhas informadas
2. Agrega `landing_page_view` actions
3. Agrega `initiate_checkout` actions
4. Conta vendas aprovadas no periodo (ou conversoes se modo Meta)
5. Retorna: `{ linkClicks, landingPageViews, initiateCheckouts, sales }`

---

## 6. Implementacao no Frontend

### 6.1 Paginas/Componentes

| Componente       | Arquivo                                         | Descricao                                   |
|------------------|-------------------------------------------------|----------------------------------------------|
| AdsTable         | `src/components/campaigns/AdsTable.tsx`         | Tabela de anuncios com metricas              |
| TopAdsChart      | `src/components/campaigns/TopAdsChart.tsx`      | Grafico de barras top 10 anuncios            |
| ConversionFunnel | `src/components/dashboard/ConversionFunnel.tsx` | Funil visual de 4 etapas                     |
| StatusSelect     | `src/components/campaigns/StatusSelect.tsx`     | Dropdown de status com ACTIVE/PAUSED         |

### 6.2 Hooks

| Hook                    | Arquivo                                  | Descricao                                       |
|-------------------------|------------------------------------------|-------------------------------------------------|
| useAds                  | `src/hooks/useAds.ts`                    | Ads com metricas Last Click (filtro por ad_set_id) |
| useMetaAds              | `src/hooks/useMetaAds.ts`                | Ads com metricas Meta (source=meta)              |
| useTopAds               | `src/hooks/useTopAds.ts`                 | Top 10 ads por vendas (Last Click)               |
| useFunnelData           | `src/hooks/useFunnelData.ts`             | Funil de conversao para DateRangeFilter          |
| useCampaignsFunnel      | `src/hooks/useCampaignsFunnel.ts`        | Funil por campaign_ids (Last Click)              |
| useMetaCampaignsFunnel  | `src/hooks/useMetaCampaignsFunnel.ts`    | Funil por campaign_ids (Meta)                    |
| useCampaignStatusUpdate | `src/hooks/useCampaignStatusUpdate.ts`   | Altera status de ad (type='ad')                  |

### 6.3 Estado

**useAds retorna:**
- `ads: AdWithMetrics[]` - Lista de ads com metricas
- `loading: boolean`
- `error: string | null`
- `refetch()` - Funcao de recarregamento

**Interface AdWithMetrics:**
```typescript
interface AdWithMetrics {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpc: number;
  cpm: number;
  ctr: number;
  ad_set_id: string;
  facebook_ad_id: string | null;
  sales: number;
  revenue: number;
  ad_set_name?: string;
  roi: number;
  roas: number;
  cpa_real: number;
}
```

**useTopAds retorna:**
- `topAds: TopAd[]` - Array de `{ name, vendas, faturamento, gasto, roas }`
- `loading: boolean`
- `error: string | null`
- `refetch()` - Funcao de recarregamento

**useFunnelData / useCampaignsFunnel retornam:**
- `linkClicks: number`
- `landingPageViews: number`
- `initiateCheckouts: number`
- `sales: number`
- `loading: boolean`

**Dependencias de recarga (comum a todos os hooks de ads):**
- `effectiveId` (usuario efetivo)
- `dateRange.start` / `dateRange.end`
- `adSetId` (filtro por conjunto)
- `refetchSignal` (trigger manual)
- `activeConnectionId` (conexao ativa)
- `activeCheckoutIds` (para Top Ads)
- `activeProductNames` (para Top Ads)

---

## 7. Pontos de Integracao

| Sistema              | Tipo         | Descricao                                              |
|----------------------|--------------|--------------------------------------------------------|
| Facebook Marketing API | REST      | Alteracao de status de anuncios individuais             |
| Sale Matcher         | Backend      | Atribuicao de vendas a anuncios via facebook_ad_id     |
| MetricsService       | Backend      | Aggregacao de metricas com join de vendas              |
| WorkspaceContext     | Contexto     | Filtra Top Ads por checkouts e produtos do workspace   |
| ImpersonationCtx    | Contexto     | Admin ve anuncios de outro usuario                     |
| ActiveConnectionCtx | Contexto     | Filtro por conexao Facebook especifica                 |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario                                          | Tratamento                                                  |
|--------------------------------------------------|-------------------------------------------------------------|
| Ad sem facebook_ad_id                            | Nao recebe atribuicao de vendas; sales = 0, revenue = 0    |
| Ad set sem anuncios                              | Lista vazia na AdsTable                                     |
| Top Ads sem nenhum ad com vendas                 | Array vazio; TopAdsChart nao renderizado                    |
| Funil sem campaign_ids                           | Dados zerados; chamada API nao executada                    |
| Funil com etapa zero                             | Taxa de conversao nao calculavel; exibe 0%                  |
| Erro de API ao buscar ads                        | console.error; ads = []; loading = false                    |
| Erro ao alterar status de anuncio                | Toast com mensagem de erro da Facebook API                  |
| Anuncio sem impressoes                           | CTR e CPM nao calculaveis; exibem 0                         |
| Dados Meta e Last Click divergentes              | Esperado; sao fontes diferentes de atribuicao               |
| useTopAds reutiliza endpoint de ads              | Performance pode ser impactada com muitos ads               |

---

## 9. Checklist de Testes

- [ ] Lista de anuncios exibe dados corretos para ad set selecionado
- [ ] Metricas Last Click e Meta exibem valores diferentes conforme esperado
- [ ] Top Ads Chart exibe top 10 anuncios por vendas (modo Last Click)
- [ ] Top Ads Chart exibe top 10 por conversoes (modo Meta)
- [ ] Top Ads filtra apenas anuncios com vendas > 0
- [ ] Funil de conversao exibe 4 etapas com valores corretos
- [ ] Taxas de conversao entre etapas do funil calculadas corretamente
- [ ] StatusSelect altera status de anuncio individual
- [ ] Toast de sucesso "Anuncio ativado/pausado com sucesso"
- [ ] Paginacao funciona com mais de 10 anuncios
- [ ] Busca por nome filtra anuncios
- [ ] Filtro de status funciona
- [ ] Anuncio sem facebook_ad_id exibe sales = 0
- [ ] Breadcrumb navega corretamente entre niveis
- [ ] Refresh recarrega dados de anuncios

---

## 10. Questoes Abertas / TODOs

- [ ] `useTopAds` busca todos os ads e faz sort no client. Para contas com milhares de ads, considerar endpoint dedicado com `ORDER BY sales DESC LIMIT 10`.
- [ ] Funil de conversao nao diferencia entre campanhas visiveis e todas as campanhas (depende dos campaign_ids passados).
- [ ] Nao ha preview visual do criativo do anuncio (thumbnail da imagem/video).
- [ ] Considerar adicionar metricas de video (video views, video through plays) para ads de video.
- [ ] O funil usa `initiateCheckouts` do pixel da Meta, mas nao cruza com dados reais do checkout.
- [ ] Considerar adicionar comparativo temporal (periodo atual vs anterior) por anuncio individual.
- [ ] `useFunnelData` e `useCampaignsFunnel` fazem chamadas ao mesmo endpoint (`/metrics/daily-spend`) com parametros diferentes. Avaliar se podem ser unificados.
