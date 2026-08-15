# Sincronizacao de Anuncios do Facebook (Facebook Ads Sync)

> **Modulo:** `packages/backend/src/modules/facebook/sync.service.ts`, `insights.service.ts`, `sale-matcher.service.ts` | **Pagina:** `src/pages/Campaigns.tsx` (botao de sync)
> **Ultima atualizacao:** 2026-03-30
> **Status:** Aprovado

---

## 1. Proposito

A sincronizacao de anuncios do Facebook e o mecanismo central que importa dados de campanhas, conjuntos de anuncios, anuncios e insights diarios da API do Facebook Ads para o banco de dados local do Sentinela. O processo roda automaticamente a cada 5 minutos via cron job, verificando quais usuarios possuem agendamentos pendentes, e tambem pode ser disparado manualmente pelo usuario ou forçado por um administrador. Apos a sincronizacao dos dados de anuncios, o sistema executa um rematch de vendas para vincular transacoes recebidas via webhook aos anuncios correspondentes usando parametros UTM. Essa funcionalidade e essencial para que metricas como ROI, ROAS e custo por venda sejam calculadas corretamente.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Botao "Sincronizar" na pagina de Campanhas | Dispara sync manual com feedback visual de progresso |
| Auto-sync (cron) | Execucao automatica a cada 5 minutos sem intervencao do usuario |
| Admin: Force Sync | Administrador pode forçar sincronizacao para qualquer usuario |

### 2.2 Fluxo de UI

1. O usuario clica no botao "Sincronizar" na pagina de campanhas.
2. O hook `useFacebookSync` dispara `syncData()`, que itera sobre todas as conexoes ativas do usuario (`connectionsRef.current`).
3. Para cada conexao, chama `POST /api/facebook/insights/sync` com `connection_id` e periodo opcional.
4. O backend cria um registro em `processing_jobs` com status `processing` e retorna o `job_id` imediatamente.
5. O frontend entra em polling via `GET /api/facebook/insights/job/:jobId`, com backoff exponencial (delay inicial de 3s, fator 1.3x, maximo 6s).
6. Timeout total de 5 minutos (300.000ms); apos isso, erro de expiracao.
7. O progresso e atualizado no backend (5% -> 15% -> 30% -> 50% -> 70% -> 80% -> 90% -> 100%).
8. Ao concluir todas as conexoes, o hook executa `rematchSales()` via `POST /api/facebook/rematch`.
9. Toasts de notificacao informam o resultado: quantidade de campanhas, conjuntos e anuncios sincronizados, e vendas re-associadas.
10. Apos sucesso, o hook invalida caches do TanStack Query: `campaigns`, `adSets`, `ads`, `sales`, `dashboard`, `sync-schedule`, `sync-logs`.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Sync manual | Usuario autenticado com conexao Facebook valida |
| Auto-sync | Sistema (cron), requer `is_active=true` e `consecutive_errors < 3` |
| Force sync | Somente admin via `/api/admin/users/:id/force-sync` |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Cron a cada 5 minutos | `@Cron('*/5 * * * *')` | O `handleAutoSync` e executado automaticamente |
| RN-02 | Agendamento devido | `is_active=true` AND `last_sync_status != 'running'` AND `next_sync_at <= now` | Schedule e selecionado para sincronizacao |
| RN-03 | Marca como running | Antes de iniciar o sync | `last_sync_status` e atualizado para `running` para evitar execucoes duplicadas |
| RN-04 | Conexoes validas | `is_valid=true` no `facebook_connections` | Apenas conexoes validas sao sincronizadas |
| RN-05 | Conexao invalida | `is_valid=false` e nenhuma conexao valida existe | Incrementa `consecutive_errors`, registra mensagem "Credenciais do Facebook invalidas" |
| RN-06 | Desativacao por erros | `consecutive_errors >= 3` | Schedule e desativado (`is_active=false`) |
| RN-07 | Reset de erros | Sync completa com sucesso | `consecutive_errors` e zerado |
| RN-08 | Token expirado | Erro contendo "190" ou "token" | `facebook_connections.is_valid` e marcado como `false` |
| RN-09 | Proximo sync | Apos cada execucao (sucesso ou erro) | `next_sync_at = now + interval_minutes * 60 * 1000` |
| RN-10 | Filtro de campanhas (auto-sync) | `objective === 'OUTCOME_SALES'` | Apenas campanhas com objetivo de vendas sao sincronizadas no auto-sync |
| RN-11 | Sync completo (manual) | Todas as campanhas | Sync manual importa todas as campanhas sem filtro de objetivo |
| RN-12 | Conversao de moeda | Conta com moeda diferente de BRL | Valores monetarios (spend, cpm, cpc, budget) sao convertidos para BRL usando taxa de cambio |
| RN-13 | Batch upsert campanhas | Lotes de ate 200 registros | Campanhas sao inseridas/atualizadas em batches via `upsert` com `onConflict: 'id'` |
| RN-14 | Batch insert insights | Lotes de ate 500 registros | Registros diarios em `daily_ad_spend` sao inseridos em batches de 500 |
| RN-15 | Rematch apos sync | Sempre apos sync bem-sucedido | `saleMatcher.rematchSales(userId)` e chamado para vincular vendas a anuncios |
| RN-16 | Extracao de ad_id | UTM content com pipe ou barra | `extractNumericId` extrai ID numerico longo (6+ digitos) de strings como `vid34|120245519580910309` |

---

## 4. Modelo de Dados

### 4.1 Tabelas Principais

#### `sync_schedules`

| Coluna | Tipo | Descricao |
|---|---|---|
| id | UUID | Chave primaria |
| user_id | UUID | FK para auth.users |
| is_active | BOOLEAN | Se o agendamento esta ativo |
| interval_minutes | INTEGER | Intervalo entre sincronizacoes |
| next_sync_at | TIMESTAMPTZ | Proximo horario agendado |
| last_sync_at | TIMESTAMPTZ | Ultimo sync realizado |
| last_sync_status | TEXT | Status: pending, running, success, error |
| last_sync_error | TEXT | Mensagem do ultimo erro |
| last_sync_duration_ms | INTEGER | Duracao em milissegundos |
| consecutive_errors | INTEGER | Contador de erros consecutivos |
| synced_campaigns | INTEGER | Campanhas sincronizadas no ultimo sync |
| synced_ad_sets | INTEGER | Conjuntos sincronizados no ultimo sync |
| synced_ads | INTEGER | Anuncios sincronizados no ultimo sync |

#### `sync_logs`

| Coluna | Tipo | Descricao |
|---|---|---|
| id | UUID | Chave primaria |
| user_id | UUID | FK para auth.users |
| sync_schedule_id | UUID | FK para sync_schedules |
| sync_type | TEXT | Tipo do sync (ex: `facebook_ads`) |
| status | TEXT | success ou error |
| started_at | TIMESTAMPTZ | Inicio da execucao |
| finished_at | TIMESTAMPTZ | Fim da execucao |
| duration_ms | INTEGER | Duracao em milissegundos |
| campaigns_synced | INTEGER | Campanhas sincronizadas |
| ad_sets_synced | INTEGER | Conjuntos sincronizados |
| ads_synced | INTEGER | Anuncios sincronizados |
| sales_rematched | INTEGER | Vendas re-associadas |
| error_message | TEXT | Mensagem de erro (se houver) |

#### `processing_jobs`

| Coluna | Tipo | Descricao |
|---|---|---|
| id | UUID | Chave primaria |
| user_id | UUID | FK para auth.users |
| job_type | TEXT | Tipo do job (ex: `facebook_sync`) |
| status | TEXT | processing, completed, failed |
| progress | INTEGER | Progresso de 0 a 100 |
| result | JSONB | Resultado da sincronizacao |
| error | TEXT | Mensagem de erro |

#### `daily_ad_spend`

| Coluna | Tipo | Descricao |
|---|---|---|
| id | UUID | Chave primaria |
| user_id | UUID | FK para auth.users |
| facebook_connection_id | UUID | FK para facebook_connections |
| campaign_id | UUID | FK para campaigns (interno) |
| ad_set_id | UUID | FK para ad_sets (interno) |
| ad_id | UUID | FK para ads (interno) |
| facebook_campaign_id | TEXT | ID do Facebook da campanha |
| facebook_adset_id | TEXT | ID do Facebook do ad set |
| facebook_ad_id | TEXT | ID do Facebook do anuncio |
| date | DATE | Data do registro |
| spend | DECIMAL | Gasto convertido para BRL |
| impressions | INTEGER | Impressoes |
| clicks | INTEGER | Cliques |
| conversions | INTEGER | Conversoes (compras) |
| purchase_value | DECIMAL | Valor de compra reportado pelo pixel |
| cpc | DECIMAL | Custo por clique (BRL) |
| cpm | DECIMAL | Custo por mil impressoes (BRL) |
| ctr | DECIMAL | Taxa de cliques |
| link_clicks | INTEGER | Cliques no link |
| landing_page_views | INTEGER | Visualizacoes da landing page |
| initiate_checkouts | INTEGER | Inicios de checkout |

### 4.2 Relacionamentos

```
sync_schedules.user_id        -> auth.users(id) ON DELETE CASCADE
sync_logs.user_id              -> auth.users(id) ON DELETE CASCADE
sync_logs.sync_schedule_id     -> sync_schedules(id)
processing_jobs.user_id        -> auth.users(id) ON DELETE CASCADE
daily_ad_spend.user_id         -> auth.users(id) ON DELETE CASCADE
daily_ad_spend.campaign_id     -> campaigns(id) ON DELETE SET NULL
daily_ad_spend.ad_set_id       -> ad_sets(id) ON DELETE SET NULL
daily_ad_spend.ad_id           -> ads(id) ON DELETE SET NULL
```

### 4.3 Constraints e Defaults

- `sync_schedules.consecutive_errors` default 0
- `sync_schedules.is_active` default true
- `processing_jobs.progress` default 0
- RLS habilitado em todas as tabelas: usuarios so veem seus proprios registros

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/facebook/insights/sync` | JWT | Inicia sync manual (retorna job_id) |
| GET | `/api/facebook/insights/job/:jobId` | JWT | Consulta status do job de sync |
| POST | `/api/facebook/rematch` | JWT | Executa rematch de vendas |
| POST | `/api/admin/users/:id/force-sync` | JWT + Admin | Força sync para um usuario |

### 5.2 Logica do Service

**SyncService.handleAutoSync() - Cron `*/5 * * * *`**

1. Busca schedules devidos: `is_active=true`, `last_sync_status != 'running'`, `next_sync_at <= now`.
2. Para cada schedule, marca como `running`.
3. Busca todas as `facebook_connections` validas do usuario.
4. Se so existem conexoes invalidas, incrementa `consecutive_errors` e desativa se >= 3.
5. Para cada conexao valida, descriptografa o `access_token` via `EncryptionService.decryptIfNeeded()`.
6. Chama `InsightsService.performSyncForAutoSync()` que sincroniza campanhas (filtradas por `OUTCOME_SALES`), ad sets e ads.
7. Acumula resultados de todas as conexoes.
8. Executa `SaleMatcherService.rematchSales()`.
9. Atualiza schedule com status de sucesso e zera `consecutive_errors`.
10. Cria registro em `sync_logs` com duracao e contagens.

**InsightsService.performSync() - Sync Manual (4 etapas)**

1. **Etapa 0 (5%)**: Detecta moeda da conta via API do Facebook (`getAccountCurrency`) e obtem taxa de cambio (`getExchangeRate`).
2. **Etapa 1 (15%-30%)**: Busca TODAS as campanhas com `fetchAllPages()` (paginacao automatica). Constroi batch de upsert com `randomUUID()` para novos registros. Upsert em lotes de 200.
3. **Etapa 2 (30%-50%)**: Busca TODOS os ad sets. Filtra por `campaign_id` presente no `campaignIdMap`. Upsert em lotes de 200.
4. **Etapa 3 (50%-70%)**: Busca TODOS os ads. Filtra por `adset_id` presente no `adSetIdMap`. Upsert em lotes de 200.
5. **Etapa 4 (70%-100%)**: Busca insights diarios em 3 niveis (campaign, adset, ad) com `time_increment=1`. Deleta registros existentes do periodo. Insere em lotes de 500 em `daily_ad_spend`. Extrai metricas de funil: `link_clicks`, `landing_page_views`, `initiate_checkouts`.

**InsightsService.fetchAllPages() - Paginacao com Retry**

- Segue `json.paging.next` ate nao haver mais paginas.
- Retry em rate limit (codigos 32, 4 ou mensagens contendo "request limit", "rate limit", "too many calls").
- Backoff exponencial: 5s, 10s, 20s (maximo 30s), ate 3 tentativas.
- Lanca erro apos esgotar tentativas.

**SaleMatcherService.rematchSales()**

1. **Etapa 0**: Preenche `ad_id` faltante em vendas a partir de `utm_content` ou `utm_term`, extraindo IDs numericos longos (6+ digitos) de strings com separadores `|` ou `/`.
2. **Etapa 1**: Busca todos os ads do usuario com hierarquia (`ads -> ad_sets -> campaigns`). Constroi mapa em memoria: `facebook_ad_id -> { ad_internal_id, ad_set_id, campaign_id }`.
3. **Etapa 2**: Busca vendas nao-associadas que possuem `ad_id`, `utm_content` ou `utm_term` mas faltam `ad_internal_id` ou `campaign_id`.
4. **Etapa 3**: Para cada venda, extrai `effectiveAdId` e busca no mapa em memoria. Atualiza `campaign_id`, `ad_set_id` e `ad_internal_id`.
5. Retorna `{ total_unmatched, rematched, still_unmatched, errors }`.

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Campanhas (pagina) | `src/pages/Campaigns.tsx` | Contem botao de sincronizacao que dispara o hook |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useFacebookSync` | `src/hooks/useFacebookSync.ts` | `{ syncData, rematchSales, syncing, rematching, syncProgress, lastSyncResult, lastSyncPeriod, lastRematchResult, error }` |
| `useSyncSchedule` | `src/hooks/useSyncSchedule.ts` | Dados do agendamento de sync do usuario |

**useFacebookSync:**

- `syncData(options?)` aceita `period` (`today`, `7d`, `30d`), `since`/`until` para periodo customizado, e `silent` para suprimir toasts.
- Itera sobre todas as conexoes ativas de `ActiveConnectionContext`.
- Para cada conexao, chama `syncSingleConnection()` que faz POST para iniciar e polling para aguardar.
- Polling com backoff exponencial: delay inicial 3s, fator 1.3x, maximo 6s, timeout total 5 minutos.
- Controle de erros consecutivos no polling: 5 erros seguidos encerram o poll.
- Apos todas as conexoes, executa `rematchSales()`.
- Invalida caches: `campaigns`, `adSets`, `ads`, `sales`, `dashboard`, `sync-schedule`, `sync-logs`.
- Usa `connectionsRef` (useRef) para evitar closures com dados obsoletos.

### 6.3 Gerenciamento de Estado

| Estado | Tipo | Descricao |
|---|---|---|
| `syncing` | boolean | Indica se uma sincronizacao esta em andamento |
| `rematching` | boolean | Indica se o rematch esta em andamento |
| `syncProgress` | number | Progresso percentual (0-100) baseado em conexoes processadas |
| `lastSyncResult` | SyncResult | Resultado acumulado: { campaigns, adSets, ads } |
| `lastSyncPeriod` | SyncPeriod | Periodo do ultimo sync: { start, end } |
| `lastRematchResult` | RematchResult | Resultado do rematch: { total_unmatched, rematched, still_unmatched } |
| `error` | string ou null | Mensagem de erro do ultimo sync |

**Contexts envolvidos:**
- `ActiveConnectionContext` fornece a lista de conexoes do usuario.
- `RefetchContext` dispara `triggerRefetch()` apos sync bem-sucedido.
- `useQueryClient` do TanStack Query para invalidacao de caches.

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Facebook Graph API v22.0 | Externo | Fonte dos dados de campanhas, ad sets, ads e insights |
| EncryptionService | Seguranca | Descriptografa access_token, app_id e app_secret antes de usar |
| Currency Helper | Conversao | Detecta moeda da conta e converte valores para BRL |
| SaleMatcherService | Pos-sync | Vincula vendas a anuncios usando parametros UTM |
| processing_jobs | Job Tracking | Tabela de jobs para tracking de progresso no frontend |
| sync_schedules | Agendamento | Controla frequencia e estado do auto-sync |
| sync_logs | Auditoria | Registra historico de todas as sincronizacoes |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Nenhuma conexao Facebook configurada | Erro "Nenhuma conta de anuncios conectada" no frontend |
| Token expirado (erro 190) | Marca `facebook_connections.is_valid=false`; mensagem "Token do Facebook expirado" |
| Credenciais invalidas (conexao `is_valid=false`) | Incrementa `consecutive_errors`; mensagem "Credenciais do Facebook invalidas. Reconecte sua conta" |
| 3 erros consecutivos | Schedule desativado automaticamente (`is_active=false`) |
| Rate limit da API do Facebook (codigos 32, 4) | Retry com backoff exponencial: 5s, 10s, 20s, maximo 30s |
| Timeout no polling (5 min) | Erro "Sincronizacao expirou. Tente novamente." |
| 5 erros consecutivos no polling | Interrompe polling e reporta erro |
| Falha em uma conexao dentre varias | Continua com proxima conexao; registra warning no console |
| Nenhuma conexao sincronizou | Erro "Nenhuma conta sincronizou com sucesso" |
| Ad set sem campanha correspondente | Ad set e ignorado (skip) |
| Ad sem ad set correspondente | Ad e ignorado (skip) |
| Erro no upsert de batch | Registra erro no log; continua com proximo batch |
| Erro no fetch de daily insights | Capturado separadamente; sync de entidades nao e afetado |
| Venda sem parametros UTM | Ignorada pelo rematch (nao ha dados para vincular) |
| UTM content sem ID numerico valido | `extractNumericId` retorna null; venda nao e associada |

---

## 9. Checklist de Testes

- [ ] Verificar que cron executa a cada 5 minutos e busca schedules devidos
- [ ] Confirmar que schedules com `is_active=false` nao sao processados
- [ ] Confirmar que schedules com `last_sync_status=running` nao sao processados
- [ ] Testar incremento de `consecutive_errors` em caso de falha
- [ ] Testar desativacao automatica apos 3 erros consecutivos
- [ ] Testar reset de `consecutive_errors` apos sucesso
- [ ] Verificar deteccao de token expirado (erro 190) e marcacao de conexao invalida
- [ ] Testar sync manual com periodo padrao (30 dias)
- [ ] Testar sync manual com periodo customizado (since/until)
- [ ] Verificar que campanhas sao upserted corretamente (inserir novas, atualizar existentes)
- [ ] Testar batch upsert de ad sets e ads
- [ ] Verificar que insights diarios sao inseridos em `daily_ad_spend`
- [ ] Testar conversao de moeda para contas nao-BRL
- [ ] Verificar que rematch vincula vendas com `utm_content` contendo pipe (ex: `vid34|120245519580910309`)
- [ ] Testar `extractNumericId` com formatos: pipe, barra, somente numero, texto sem ID
- [ ] Confirmar que polling no frontend respeita backoff exponencial
- [ ] Testar timeout de 5 minutos no polling
- [ ] Verificar invalidacao de caches apos sync bem-sucedido
- [ ] Testar force sync pelo admin
- [ ] Confirmar criacao de registros em `sync_logs` para sucesso e erro

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Sync paralelo de conexoes | Atualmente conexoes sao sincronizadas sequencialmente. Para usuarios com muitas contas, sync paralelo pode reduzir tempo total |
| Q02 | Paginacao de insights diarios | Para contas com muitas campanhas e periodo longo, o volume de daily insights pode ser muito grande. Considerar limitar periodo ou implementar sync incremental |
| Q03 | Deduplicacao de daily_ad_spend | Atualmente deleta todos os registros do periodo antes de re-inserir. Um upsert com chave composta (date + facebook_id + level) seria mais eficiente |
| Q04 | Notificacao de desativacao | Quando o schedule e desativado por 3 erros, o usuario nao recebe notificacao ativa (apenas ve no proximo acesso) |
| Q05 | Limite de plano no sync | O `sync_interval_minutes` e definido por plano mas o enforcement no backend poderia ser mais explicito |
