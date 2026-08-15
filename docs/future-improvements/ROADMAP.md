# Roadmap de Melhorias Futuras — Performance & Seguranca

**Criado em**: 2026-03-30
**Contexto**: Sistema atual com centenas de usuarios, ~15K vendas, milhares de webhooks/dia.
**Objetivo**: Preparar para milhares de usuarios e centenas de milhares de webhooks.

> Este documento lista melhorias que **nao** foram implementadas no hardening atual,
> organizadas por prioridade e ponto de escala onde se tornam necessarias.

---

## Como usar este documento

Cada melhoria indica:
- **Quando implementar**: O ponto de escala que torna a melhoria necessaria
- **Impacto**: O que acontece se nao implementar
- **Esforco**: Estimativa relativa (baixo/medio/alto)
- **Arquivos afetados**: Onde mexer

---

## Prioridade 1 — Critico (implementar antes de 1K usuarios)

### 1.1 Agregacoes no banco em vez de client-side

**Quando**: Tabela `sales` passar de 50K linhas
**Impacto**: Dashboard admin trava — carrega TODAS as vendas na memoria para calcular SUM

**Problema atual**:
- `admin.service.ts` `getStats()` faz `select('amount').eq('status', 'approved')` e soma em JS
- `admin.service.ts` `getUserDetail()` faz o mesmo para revenue e spend por usuario
- `admin.service.ts` `listUsers()` faz fetch de TODAS as sales aprovadas dos usuarios da pagina

**Solucao**: Criar funcoes RPC no Supabase:

```sql
CREATE OR REPLACE FUNCTION get_total_revenue()
RETURNS numeric AS $$
  SELECT COALESCE(SUM(amount), 0) FROM sales WHERE status = 'approved';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_user_revenue(p_user_id uuid)
RETURNS numeric AS $$
  SELECT COALESCE(SUM(amount), 0) FROM sales
  WHERE user_id = p_user_id AND status = 'approved';
$$ LANGUAGE sql STABLE;
```

Chamar via `supabase.rpc('get_total_revenue')` em vez de fetch + reduce.

**Arquivos**:
- `packages/backend/src/modules/admin/admin.service.ts` — getStats(), listUsers(), getUserDetail()
- `packages/backend/src/modules/metrics/metrics.service.ts` — getDashboardData()
- Nova migration com funcoes RPC

**Esforco**: Medio

---

### 1.2 Queries de dashboard com paginacao/limites

**Quando**: Tabela `sales` ou `daily_ad_spend` passar de 30K linhas
**Impacto**: Dashboard carrega TODOS os registros sem limite — memoria estoura

**Problema atual**:
- `metrics.service.ts` `getDashboardData()` faz fetch de ALL sales e ALL daily_ad_spend
- `metrics.service.ts` `getSalesByRegion()` sem limite
- `metrics.service.ts` `getCampaigns()`, `getAdSets()`, `getAds()` sem limite

**Solucao**: Adicionar `.limit()` e paginacao em todas as queries de metrics.
Para dashboards, usar agregacoes no banco (ver 1.1) em vez de puxar dados brutos.

**Arquivos**:
- `packages/backend/src/modules/metrics/metrics.service.ts` — todos os metodos

**Esforco**: Medio

---

### 1.3 Batch updates no sale-matcher (eliminar loop sequencial)

**Quando**: 10K+ vendas sem match ou apos re-sync
**Impacto**: Rematch de vendas leva 16+ minutos (1 UPDATE por venda no loop)

**Problema atual**:
```typescript
// sale-matcher.service.ts
for (const sale of salesMissingAdId || []) {
  await client.from('sales').update({ ad_id: numId }).eq('id', sale.id);
}
```

**Solucao**: Agrupar updates por ad_id e fazer batch:
```typescript
const updatesByAdId = new Map<string, string[]>();
// ... agrupar sale IDs por ad_id
for (const [adId, saleIds] of updatesByAdId) {
  await client.from('sales').update({ ad_id: adId }).in('id', saleIds);
}
```

**Arquivos**:
- `packages/backend/src/modules/facebook/sale-matcher.service.ts`

**Esforco**: Baixo

---

### 1.4 Indexes adicionais para queries criticas

**Quando**: Agora (preventivo)
**Impacto**: Queries ficam exponencialmente mais lentas sem indexes

**Indexes faltantes**:

```sql
-- Queue processing: busca por status + ordenacao por created_at
CREATE INDEX CONCURRENTLY idx_webhook_queue_status_created
  ON public.webhook_queue(status, created_at);

-- Sale matching: busca por user + ad_internal_id
CREATE INDEX CONCURRENTLY idx_sales_user_ad_internal
  ON public.sales(user_id, ad_internal_id);

-- Dashboard: vendas por user + status + data
CREATE INDEX CONCURRENTLY idx_sales_user_status_sold_at
  ON public.sales(user_id, status, sold_at DESC);

-- Sync scheduling: busca de schedules ativos por proximo sync
CREATE INDEX CONCURRENTLY idx_sync_schedules_active_next
  ON public.sync_schedules(next_sync_at)
  WHERE is_active = true;

-- Ad sets por campaign (FK join)
CREATE INDEX CONCURRENTLY idx_ad_sets_campaign_id
  ON public.ad_sets(campaign_id);
```

**Arquivos**:
- Nova migration SQL

**Esforco**: Baixo

---

### 1.5 Monitoramento e observabilidade

**Quando**: Antes de ir para producao com usuarios pagantes
**Impacto**: Sem monitoramento, problemas so sao descobertos quando usuarios reclamam

**O que falta**:
- **Error tracking**: Sentry ou similar — captura erros em producao com contexto
- **APM**: Metricas de latencia por endpoint, queries lentas
- **Log aggregation**: Logs estruturados (JSON) com Pino em vez de console.log
- **Alertas**: CPU, memoria, fila de webhooks crescendo, erros de sync

**Solucao minima**:
1. Instalar `@sentry/node` no backend e `@sentry/react` no frontend
2. Trocar Logger do NestJS por Pino (logs JSON)
3. Configurar alertas no Render para CPU/memoria

**Arquivos**:
- `packages/backend/src/main.ts` — Sentry init
- `packages/frontend/src/main.tsx` — Sentry init
- `packages/backend/src/app.module.ts` — LoggerModule com Pino

**Esforco**: Medio

---

## Prioridade 2 — Alto (implementar entre 1K–5K usuarios)

### 2.1 Migrar hooks de useState/useEffect para TanStack Query

**Quando**: Numero de requests ao backend cresce significativamente
**Impacto**: Sem staleTime/cache, cada mount de componente refaz fetch. Com milhares de usuarios, backend recebe requests redundantes.

**Hooks que precisam migrar** (~20 hooks):
- `useDashboardMetrics`, `useSales`, `useCampaigns`, `useAds`, `useAdSets`
- `useMetaCampaigns`, `useMetaAdSets`, `useMetaAds`
- `useTopAds`, `useFunnelData`, `useSalesByRegion`
- `useProfitEvolution`, `useFinancialSummary`, `useFinancialEntries`
- `useCompanyCosts`, `useCheckoutIntegrations`, `useFacebookSync`
- `useCampaignsFunnel`, `useMetaCampaignsFunnel`, `useMetaInsights`

**Beneficios da migracao**:
- Cache automatico com staleTime
- Deduplicacao de requests
- Retry automatico em falhas
- Loading/error states sem boilerplate

**Esforco**: Alto (1 hook por vez, pode ser incremental)

---

### 2.2 Redis + cache distribuido

**Quando**: Backend rodando em multiplas instancias (auto-scaling)
**Impacto**: Cache in-memory atual nao e compartilhado entre instancias

**Problema atual**: `CacheService` usa `Map` local — cada instancia tem cache separado.

**Solucao**:
1. Adicionar Redis (Render oferece Redis ou usar Upstash serverless)
2. Substituir `Map` por cliente Redis (`ioredis`)
3. Usar para: plan_rules, workspace configs, contagens frequentes

**Custo**: ~$7-10/mes no Render para Redis basico

**Arquivos**:
- `packages/backend/src/shared/services/cache.service.ts` — migrar para Redis
- `packages/backend/src/app.module.ts` — config do Redis

**Esforco**: Medio

---

### 2.3 Retry com backoff exponencial para APIs externas

**Quando**: Volume de syncs aumentar (mais usuarios com Facebook conectado)
**Impacto**: Um erro 429 (rate limit) do Facebook mata o sync inteiro

**Problema atual**:
- `insights.service.ts` faz fetch direto sem retry
- `email.service.ts` faz fetch para Resend sem retry

**Solucao**: Criar helper `fetchWithRetry`:
```typescript
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429 || response.status >= 500) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return response;
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}
```

**Arquivos**:
- `packages/backend/src/modules/facebook/insights.service.ts`
- `packages/backend/src/modules/utils/email.service.ts`
- Novo: `packages/backend/src/shared/helpers/fetch-with-retry.ts`

**Esforco**: Baixo

---

### 2.4 Virtualizacao de listas longas no frontend

**Quando**: Usuarios com 500+ vendas/campanhas visualizando tabelas
**Impacto**: UI congela ao renderizar 1000+ linhas de tabela

**Problema atual**: Tabelas em Sales, Campaigns, AdminUsers renderizam todas as linhas no DOM (paginacao client-side ajuda mas nao resolve completamente).

**Solucao**: Usar `@tanstack/react-virtual` para renderizar apenas linhas visiveis.

**Componentes afetados**:
- `packages/frontend/src/components/campaigns/CampaignsTable.tsx`
- `packages/frontend/src/components/campaigns/AdSetsTable.tsx`
- `packages/frontend/src/components/campaigns/AdsTable.tsx`
- `packages/frontend/src/components/admin/UsersTable.tsx`
- `packages/frontend/src/components/sales/` — tabelas de vendas

**Esforco**: Medio

---

### 2.5 Graceful shutdown no backend

**Quando**: Antes de auto-scaling (instancias subindo/descendo frequentemente)
**Impacto**: Deploys matam requests em andamento, webhooks em processamento sao perdidos

**Solucao**:
```typescript
// main.ts
app.enableShutdownHooks();

// Ou manualmente:
process.on('SIGTERM', async () => {
  logger.log('SIGTERM received, draining connections...');
  await app.close();
  process.exit(0);
});
```

**Arquivos**:
- `packages/backend/src/main.ts`

**Esforco**: Baixo

---

### 2.6 Dead letter queue para webhooks falhados

**Quando**: Volume de webhooks cresce e falhas se tornam mais frequentes
**Impacto**: Webhooks que falham 3x sao marcados como "failed" e esquecidos — vendas perdidas

**Solucao**:
1. Criar tabela `webhook_dead_letter` para webhooks que excedem max_attempts
2. Adicionar alerta quando novos itens entram na dead letter
3. Criar endpoint admin para reprocessar dead letters

**Arquivos**:
- `packages/backend/src/modules/webhooks/webhook-queue.service.ts`
- Nova migration SQL
- `packages/backend/src/modules/admin/admin.controller.ts` — endpoint de reprocessamento

**Esforco**: Medio

---

## Prioridade 3 — Medio (implementar entre 5K–20K usuarios)

### 3.1 Particionamento de tabelas grandes

**Quando**: Tabela `sales` passar de 1M linhas, `webhook_queue` passar de 500K
**Impacto**: Queries ficam lentas mesmo com indexes

**Tabelas candidatas**:
- `sales` — particionar por `sold_at` (mensal)
- `daily_ad_spend` — particionar por `date` (mensal)
- `webhook_queue` — particionar por `created_at` (semanal), deletar particoes antigas
- `sync_logs` — particionar por `started_at` (mensal)

**Solucao**: Range partitioning por data com manutencao automatica.

**Esforco**: Alto

---

### 3.2 Redis + BullMQ para filas

**Quando**: Volume de webhooks ultrapassar dezenas de milhares/dia
**Impacto**: Cron polling a cada minuto causa delay e overhead no banco

**Migrar de**: tabela `webhook_queue` + cron
**Migrar para**: Redis + BullMQ com:
- Processamento event-driven (sem polling)
- Concurrency control nativo (`concurrency: 50`)
- Retry com backoff exponencial nativo
- Dead letter queue nativa
- Dashboard de monitoramento (Bull Board)

**Custo**: ~$10-20/mes para Redis com mais capacidade

**Esforco**: Alto

---

### 3.3 Filtragem server-side em vez de client-side

**Quando**: Tabelas de vendas/campanhas passarem de 10K linhas por usuario
**Impacto**: Frontend carrega todos os dados e filtra localmente — lento e desperdicador

**Problema atual**: Sales e Campaigns carregam todos os dados e filtram com `useMemo`.

**Solucao**: Mover filtros para query params da API. O backend filtra no banco.

**Arquivos**:
- `packages/backend/src/modules/sales/sales.service.ts` — aceitar filtros
- `packages/backend/src/modules/metrics/metrics.service.ts` — aceitar filtros
- `packages/frontend/src/pages/Sales.tsx` — enviar filtros via query params
- `packages/frontend/src/pages/Campaigns.tsx` — idem

**Esforco**: Medio

---

### 3.4 CI/CD pipeline

**Quando**: Equipe crescer ou deploys ficarem frequentes
**Impacto**: Sem CI, bugs chegam em producao sem testes

**O que implementar**:
1. GitHub Actions workflow:
   - `npm run build` em PRs
   - `npm run test` em PRs
   - `npm run lint` em PRs
   - Deploy automatico no merge para main
2. Dependabot para updates de seguranca
3. SAST scanning (CodeQL ou similar)

**Arquivos**:
- `.github/workflows/ci.yml`
- `.github/dependabot.yml`

**Esforco**: Medio

---

### 3.5 Content Security Policy (CSP)

**Quando**: Antes de dados sensiveis de pagamento/financeiros
**Impacto**: Sem CSP, scripts injetados podem roubar dados

**Solucao**: Adicionar header CSP no Fastify hook:
```typescript
reply.header('Content-Security-Policy',
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co"
);
```

**Arquivos**:
- `packages/backend/src/main.ts` — adicionar ao hook onSend existente

**Esforco**: Baixo (mas requer teste cuidadoso)

---

## Prioridade 4 — Desejavel (qualidade e robustez)

### 4.1 Audit logging para acoes administrativas

**O que logar**: Criacao/edicao/exclusao de usuarios, mudancas de planos, force sync, proxy queries.
**Onde**: Tabela `audit_logs(id, actor_id, action, target_table, target_id, metadata, created_at)`.

### 4.2 Encryption at rest para dados sensiveis

**O que encriptar**: Webhook secrets em `checkout_integrations`, CPF em `profiles`, tokens de API.
**Como**: Usar o `EncryptionService` existente, aplicar nos services antes de salvar.

### 4.3 Load testing com k6 ou similar

**Cenarios**: Simular 1000 usuarios concorrentes + 10K webhooks/minuto.
**Objetivo**: Encontrar gargalos antes que usuarios reais os encontrem.

### 4.4 Docker hardening

**Melhorias**: User non-root, health check no Dockerfile, `.dockerignore` completo, `npm ci --production` no stage final, pinagem de versao exata da imagem base.

### 4.5 Timing-safe comparison para HMAC de webhooks

**Problema**: `kiwify.processor.ts` compara HMAC com `===` em vez de `crypto.timingSafeEqual()`.
**Risco**: Timing attack para descobrir o secret. Baixa probabilidade mas facil de corrigir.

### 4.6 Limite de tamanho em payloads de webhook

**Problema**: Webhook aceita payload de qualquer tamanho sem validacao.
**Solucao**: Configurar `bodyLimit` no Fastify adapter: `new FastifyAdapter({ bodyLimit: 1048576 })` (1MB).

---

## Checklist Rapido por Escala

| Escala | Acoes necessarias |
|--------|------------------|
| **500 usuarios** | Indexes adicionais (1.4), monitoramento basico (1.5) |
| **1K usuarios** | Agregacoes no banco (1.1), limites nas queries (1.2), batch updates (1.3) |
| **2K usuarios** | Migrar hooks para TanStack Query (2.1), retry em APIs (2.3), graceful shutdown (2.5) |
| **5K usuarios** | Redis cache (2.2), virtualizacao (2.4), dead letter queue (2.6) |
| **10K usuarios** | Particionamento (3.1), BullMQ (3.2), filtragem server-side (3.3) |
| **20K+ usuarios** | CI/CD completo (3.4), CSP (3.5), audit logging (4.1), load testing (4.3) |
