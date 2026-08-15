# Conjuntos de Anuncios (Ad Sets)

## 1. Proposito

Exibir e gerenciar os conjuntos de anuncios (ad sets) dentro de uma campanha selecionada. Cada ad set herda as metricas de performance do Facebook (spend, impressions, clicks, conversions) e pode ter vendas atribuidas via Last Click ou Meta Attribution. O usuario pode visualizar orcamentos, alterar status (ACTIVE/PAUSED) diretamente na plataforma e navegar para os anuncios individuais do conjunto.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Local                    | Descricao                                       |
|--------------------------|-------------------------------------------------|
| Pagina `/campaigns`      | Nivel 2 da hierarquia, acessado ao clicar em uma campanha |

Nao possui rota dedicada. O nivel de ad sets e controlado pelo estado `selectedCampaign` na pagina de Campanhas.

### 2.2 Fluxo de UI

**Exibicao de ad sets:**
1. Usuario clica em uma campanha na CampaignsTable
2. `handleCampaignClick(campaign)` seta `selectedCampaign` e limpa `selectedAdSet`
3. Breadcrumb muda para: `Campanhas > Nome da Campanha`
4. Titulo muda para "Conjuntos de Anuncios"
5. Subtitulo: `Conjuntos da campanha "Nome da Campanha"`
6. AdSetsTable renderizada com dados do hook `useAdSets` (Last Click) ou `useMetaAdSets` (Meta)

**Colunas da AdSetsTable:**
| Coluna       | Descricao                                    |
|--------------|----------------------------------------------|
| Nome         | Nome do ad set (clicavel para drill-down)    |
| Status       | Badge ACTIVE (verde) ou PAUSED (cinza), com StatusSelect para alterar |
| Orcamento    | daily_budget ou lifetime_budget formatado em BRL |
| Gasto        | Total gasto no periodo                       |
| Impressoes   | Total de impressoes                          |
| Cliques      | Total de cliques                             |
| Vendas       | Vendas atribuidas (Last Click ou Meta)       |
| Faturamento  | Receita das vendas atribuidas                |
| ROAS         | Revenue / Spend                              |
| Checkouts    | Finalizacoes de compra iniciadas (Initiate Checkout) — `max` entre as variantes do `action_type` do Insights API da Meta |
| CPA          | Spend / Sales                                |

**Gerenciamento de status:**
1. Componente `StatusSelect` no ad set permite alternar entre ACTIVE e PAUSED
2. `useCampaignStatusUpdate.updateStatus(facebook_adset_id, newStatus, 'adset')` faz PATCH para `/api/facebook/campaigns/status`
3. Corpo da requisicao: `{ facebook_id, status: 'ACTIVE'|'PAUSED', type: 'adset' }`
4. Sucesso: toast "Conjunto ativado(a) com sucesso" ou "Conjunto pausado(a) com sucesso"
5. Erro: toast com mensagem de erro da Facebook API

**Gerenciamento de orcamento:**
1. Componente `BudgetEditModal` permite editar orcamento diario ou vitalicio
2. `useBudgetUpdate.updateBudget()` faz PATCH para `/api/facebook/budget`
3. Corpo: `{ type: 'adset', facebook_id, budget_type: 'daily'|'lifetime', amount }` (amount em centavos)
4. Sucesso: toast "Orcamento diario do conjunto atualizado para R$ X.XX"

**Navegacao para anuncios:**
- Clicar no nome do ad set chama `handleAdSetClick(adSet)`
- Seta `selectedAdSet` e navega para nivel 3 (Ads)

### 2.3 Permissoes

| Acao                        | Permissao Necessaria     |
|-----------------------------|--------------------------|
| Visualizar ad sets          | Usuario autenticado       |
| Alterar status              | Usuario autenticado (dono da conexao Facebook) |
| Alterar orcamento           | Usuario autenticado (dono da conexao Facebook) |

---

## 3. Regras de Negocio

| #  | Regra                                    | Condicao                                              | Resultado Esperado                                       |
|----|------------------------------------------|-------------------------------------------------------|----------------------------------------------------------|
| 1  | Deduplicacao por facebook_adset_id       | Multiplos registros com mesmo facebook_adset_id        | Backend mantem registro com maior spend                  |
| 2  | Metricas filtradas por periodo           | from/to no request                                    | Spend, impressions, clicks filtrados pelo periodo        |
| 3  | Filtro por campanha                      | `campaign_id` no request                               | Apenas ad sets da campanha selecionada                   |
| 4  | Vendas Last Click                        | Modo lastclick                                        | Vendas reais atribuidas via ad_id do checkout            |
| 5  | Vendas Meta Attribution                  | Modo meta, `source=meta` no request                   | Conversoes reportadas pelo pixel                         |
| 6  | ROAS = Revenue / Spend                   | Spend > 0                                             | Calculado por ad set; 0 se spend = 0                     |
| 7  | CPA = Spend / Sales                      | Sales > 0                                             | Calculado por ad set; 0 se sales = 0                     |
| 8  | Orcamento exibido                        | daily_budget ou lifetime_budget preenchido             | Exibe o valor preenchido; se ambos null, nao exibe       |
| 9  | Alteracao de status via Facebook API     | facebook_adset_id presente                            | PATCH na API do Facebook para alterar status real        |
| 10 | Orcamento em centavos                    | Input do usuario em BRL                               | Converte para centavos antes de enviar (amount * 100)    |
| 11 | Status permitidos                        | Alteracao de status                                   | Apenas ACTIVE e PAUSED sao opcoes no StatusSelect        |

---

## 4. Modelo de Dados

### 4.1 Tabelas

**ad_sets**
| Coluna            | Tipo      | Descricao                           |
|-------------------|-----------|--------------------------------------|
| id                | uuid (PK) | Identificador interno                |
| user_id           | uuid (FK) | Dono do ad set                       |
| campaign_id       | uuid (FK) | Campanha pai                         |
| name              | text      | Nome do conjunto                     |
| status            | text      | ACTIVE, PAUSED, etc.                |
| spend             | numeric   | Gasto total                          |
| impressions       | integer   | Total de impressoes                  |
| clicks            | integer   | Total de cliques                     |
| conversions       | integer   | Conversoes Meta                      |
| cpc               | numeric   | Custo por clique                     |
| cpm               | numeric   | Custo por mil impressoes             |
| ctr               | numeric   | Taxa de cliques                      |
| facebook_adset_id | text      | ID no Facebook (para deduplicacao e API) |
| daily_budget      | numeric   | Orcamento diario (centavos)          |
| lifetime_budget   | numeric   | Orcamento vitalicio (centavos)       |
| date_start        | timestamp | Inicio do periodo de metricas        |
| date_end          | timestamp | Fim do periodo de metricas           |
| synced_at         | timestamp | Ultima sincronizacao                 |
| created_at        | timestamp | Data de criacao                      |
| updated_at        | timestamp | Ultima atualizacao                   |

### 4.2 Relacionamentos

- `ad_sets.campaign_id` -> `campaigns.id` (N:1)
- `ad_sets.user_id` -> `auth.users.id` (N:1)
- `ads.ad_set_id` -> `ad_sets.id` (1:N)
- Vendas linkadas via `facebook_ad_id` nos ads filhos

### 4.3 Constraints

- RLS: `user_id = auth.uid()`
- Deduplicacao por `facebook_adset_id` (backend mantem maior spend)
- `campaign_id` obrigatorio (todo ad set pertence a uma campanha)

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path                               | Guard     | Descricao                                    |
|--------|-------------------------------------|-----------|-----------------------------------------------|
| GET    | `/api/metrics/ad-sets`              | AuthGuard | Lista ad sets com metricas                    |
| PATCH  | `/api/facebook/campaigns/status`    | AuthGuard | Altera status via Facebook API                |
| PATCH  | `/api/facebook/budget`              | AuthGuard | Altera orcamento via Facebook API             |

**Parametros de `/api/metrics/ad-sets`:**
| Param          | Tipo   | Descricao                              |
|----------------|--------|----------------------------------------|
| from           | string | Data inicio (yyyy-MM-dd)               |
| to             | string | Data fim (yyyy-MM-dd)                  |
| campaign_id    | string | Filtro por campanha                    |
| connection_id  | string | Filtro por conexao Facebook            |
| source         | string | `meta` para atribuicao Meta            |
| target_user_id | string | ID do usuario alvo (admin)             |

**Body de PATCH `/api/facebook/campaigns/status`:**
```json
{
  "facebook_id": "23850000000000",
  "status": "ACTIVE",
  "type": "adset"
}
```

**Body de PATCH `/api/facebook/budget`:**
```json
{
  "type": "adset",
  "facebook_id": "23850000000000",
  "budget_type": "daily",
  "amount": 5000
}
```

### 5.2 Logica do Service

**MetricsService.getAdSets:**
1. Busca ad sets do usuario filtrados por periodo e opcionalmente por campaign_id
2. Se `source=meta`, usa conversoes do pixel; senao, faz join com vendas reais
3. Calcula metricas: spend, sales, revenue, roas, cpa_real
4. Deduplica por `facebook_adset_id`
5. Retorna array de AdSetWithMetrics

**FacebookService.updateStatus:**
1. Recebe facebook_id, status e type
2. Busca conexao do usuario para obter access_token
3. Faz chamada a Facebook Marketing API: `POST /{facebook_id}?status={status}`
4. Atualiza status no banco local
5. Retorna sucesso ou erro da Facebook API

**FacebookService.updateBudget:**
1. Recebe type, facebook_id, budget_type e amount
2. Faz chamada a Facebook Marketing API com o campo correspondente (daily_budget ou lifetime_budget)
3. Atualiza orcamento no banco local
4. Retorna sucesso ou erro

---

## 6. Implementacao no Frontend

### 6.1 Paginas/Componentes

| Componente       | Arquivo                                         | Descricao                                   |
|------------------|-------------------------------------------------|----------------------------------------------|
| AdSetsTable      | `src/components/campaigns/AdSetsTable.tsx`      | Tabela de ad sets com metricas e acoes       |
| StatusSelect     | `src/components/campaigns/StatusSelect.tsx`     | Dropdown de ACTIVE/PAUSED com confirmacao    |
| BudgetEditModal  | `src/components/campaigns/BudgetEditModal.tsx`  | Modal para editar orcamento                  |

### 6.2 Hooks

| Hook                    | Arquivo                                  | Descricao                                    |
|-------------------------|------------------------------------------|----------------------------------------------|
| useAdSets               | `src/hooks/useAdSets.ts`                 | Ad sets com metricas Last Click               |
| useMetaAdSets           | `src/hooks/useMetaAdSets.ts`             | Ad sets com metricas Meta (source=meta)       |
| useCampaignStatusUpdate | `src/hooks/useCampaignStatusUpdate.ts`   | Altera status via PATCH                       |
| useBudgetUpdate         | `src/hooks/useBudgetUpdate.ts`           | Altera orcamento via PATCH                    |

### 6.3 Estado

**useAdSets retorna:**
- `adSets: AdSetWithMetrics[]` - Lista de ad sets com metricas
- `loading: boolean`
- `error: string | null`
- `refetch()` - Funcao de recarregamento

**Interface AdSetWithMetrics:**
```typescript
interface AdSetWithMetrics {
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
  campaign_id: string;
  facebook_adset_id: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  sales: number;
  revenue: number;
  campaign_name?: string;
  roi: number;
  roas: number;
  cpa_real: number;
}
```

**useCampaignStatusUpdate:**
- `updateStatus(facebookId, newStatus, type)` - Altera status
- `updatingId: string | null` - ID do item sendo atualizado (para loading)

**useBudgetUpdate:**
- `updateBudget(params)` - Altera orcamento
- `updating: boolean` - Estado de loading

---

## 7. Pontos de Integracao

| Sistema            | Tipo         | Descricao                                              |
|--------------------|--------------|--------------------------------------------------------|
| Facebook Marketing API | REST    | Alteracao de status e orcamento em tempo real           |
| MetricsService     | Backend      | Aggregacao de metricas com join de vendas              |
| CampaignsTable     | Navegacao    | Click em campanha dispara carregamento de ad sets      |
| AdsTable           | Navegacao    | Click em ad set dispara carregamento de ads            |
| ImpersonationCtx   | Contexto     | Admin ve ad sets de outro usuario                      |
| ActiveConnectionCtx| Contexto     | Filtro por conexao Facebook especifica                 |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario                                          | Tratamento                                                  |
|--------------------------------------------------|-------------------------------------------------------------|
| Ad set sem facebook_adset_id                     | Status e orcamento nao podem ser alterados (sem ID do Facebook) |
| Erro da Facebook API ao alterar status           | Toast com mensagem de erro especifica da API                |
| Erro da Facebook API ao alterar orcamento        | Toast com mensagem de erro especifica                       |
| Ad set sem orcamento definido                    | Colunas daily_budget e lifetime_budget null; nada exibido   |
| Campanha sem ad sets                             | Lista vazia renderizada na tabela                           |
| Deduplicacao com multiplos registros             | Maior spend mantido; demais descartados                     |
| Timeout na Facebook API                          | Catch generico; toast de erro                               |
| Orcamento informado como zero                    | API aceita; orcamento zerado no Facebook                    |
| Orcamento em formato invalido                    | Validacao no modal antes de enviar                          |

---

## 9. Checklist de Testes

- [ ] Lista de ad sets exibe dados corretos para campanha selecionada
- [ ] Metricas Last Click e Meta exibem valores diferentes
- [ ] Deduplicacao por facebook_adset_id funciona (sem duplicatas)
- [ ] StatusSelect altera status para ACTIVE com sucesso
- [ ] StatusSelect altera status para PAUSED com sucesso
- [ ] Toast de sucesso exibido apos alteracao de status
- [ ] Toast de erro exibido quando Facebook API falha
- [ ] BudgetEditModal exibe valores atuais de orcamento
- [ ] Edicao de orcamento diario funciona
- [ ] Edicao de orcamento vitalicio funciona
- [ ] Conversao de centavos para BRL no display e vice-versa
- [ ] Clicar em ad set navega para nivel de anuncios
- [ ] Paginacao funciona com mais de 10 ad sets
- [ ] Busca por nome filtra ad sets corretamente
- [ ] Filtro de status funciona (Todos, Ativos, Pausados)

---

## 10. Questoes Abertas / TODOs

- [ ] Nao ha validacao de que o usuario tem permissao na conta de anuncios do Facebook antes de tentar alterar status/orcamento.
- [ ] O banco local pode ficar dessincronizado se a alteracao no Facebook for feita fora da plataforma.
- [ ] Considerar adicionar historico de alteracoes de orcamento e status.
- [ ] Nao ha confirmacao (dialog) antes de alterar status ou orcamento -- a alteracao e imediata.
- [ ] A coluna `campaign_name` em AdSetWithMetrics e opcional e pode nao estar presente.
