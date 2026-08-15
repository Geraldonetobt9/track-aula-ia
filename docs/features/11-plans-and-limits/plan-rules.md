# Regras de Planos e Limites (Plan Rules)

> **Modulo:** `packages/backend/src/modules/plan-limits/` | `packages/backend/src/modules/plans/`
> **Pagina:** `packages/frontend/src/pages/admin/AdminPlans.tsx` | Settings > Plano
> **Ultima atualizacao:** 2026-04-17
> **Status:** Aprovado

---

## 1. Proposito

O sistema de regras de planos define os limites numericos que controlam quantos recursos cada usuario pode criar/ativar no Sentinela de acordo com seu plano de assinatura. Ha 5 planos (free, pro, starter, enterprise, unlimited) com limites progressivos para vendas mensais, ad accounts ativas, integracoes de checkout, workspaces e regras de automacao ativas. Planos pagos possuem cobranca por overage (vendas acima do limite) em vez de bloqueio. O enforcement ocorre 100% no backend via `PlanLimitsService`; o frontend consome `GET /api/plan-limits/usage` via hook `usePlanUsage` apenas para exibir contadores e desabilitar botoes preventivamente.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Qualquer fluxo de criacao/ativacao | Workspace, integracao, ad account, regra de automacao — todos sao verificados no backend antes de persistir |
| Settings > Plano | Exibe `PlanUsageCard` com uso atual vs. limite de cada recurso e total de vendas em overage |
| WorkspaceSwitcher | Grupo "Arquivados" lista workspaces com `archived_at IS NOT NULL` com cadeado |
| Admin > Planos (`/admin/plans`) | Admin edita limites de cada plano via `PATCH /api/plans/rules/:plan` |

### 2.2 Fluxo de UI

1. Ao montar a aplicacao, o hook `usePlanUsage` busca `GET /api/plan-limits/usage` com staleTime de 30 segundos.
2. Botoes de "Criar workspace", "Adicionar integracao", "Ativar ad account" e "Ativar regra" consultam `canCreate()` / `canActivate()` do hook e ficam desabilitados quando o limite ja foi atingido.
3. Se o usuario tentar a acao mesmo assim (ou via API direta), o backend retorna HTTP 402 com body `{ resource, current, limit, plan }`.
4. O frontend intercepta o 402 e exibe `PlanLimitModal` com mensagem de bloqueio e call-to-action de upgrade.
5. Vendas via webhook nao bloqueiam a requisicao — o webhook sempre retorna 200 imediatamente. O campo `blocked_by_limit` e `overage` sao aplicados de forma assincrona no processamento.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Consultar uso proprio (`GET /api/plan-limits/usage`) | Qualquer usuario autenticado |
| Editar regras de planos (`PATCH /api/plans/rules/:plan`) | Somente admin (role = admin) |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | 5 planos fixos | Tabela `plan_rules` | free, pro, starter, enterprise, unlimited |
| RN-02 | Limite -1 = ilimitado | `max_* = -1` | Verificacoes de limite sao ignoradas para esse recurso |
| RN-03 | Free bloqueia venda excedente | `plan = 'free'` e `overage_price_cents = 0` e `sales >= max_sales_monthly` | Venda persistida com `blocked_by_limit = true`; nao aparece em metricas |
| RN-04 | Plano pago registra overage | `overage_price_cents > 0` e `sales >= max_sales_monthly` | Venda persistida normalmente + linha inserida em `usage_overage` |
| RN-05 | Criar recurso acima do limite | Qualquer create/activate quando `current >= limit` | Backend lanca HTTP 402 (`PlanLimitExceededException`) |
| RN-06 | Upgrade libera vendas bloqueadas | `new_plan.max_sales_monthly > old_plan.max_sales_monthly` | `blocked_by_limit = false` para vendas dos ultimos 30 dias |
| RN-07 | Downgrade faz auto-trim | `new_plan.max_* < current count` | Recursos excedentes recebem soft-disable (ver `downgrade-auto-trim.md`) |
| RN-08 | Whitelist de campos no PATCH | Admin atualiza regra via API | Somente `max_sales_monthly, max_active_ad_accounts, max_checkout_integrations, max_workspaces, max_active_rules, overage_price_cents` sao aceitos |
| RN-09 | Cache de contagens | `PlanLimitsService` | Plano cacheado por 30 s; contagens por 10 s — invalidados apos troca de plano |
| RN-10 | Contagem filtra por `source` | Query mensal de vendas em `PlanLimitsService` | Apenas vendas com `source='webhook'` sao contadas. Imports retroativos (`source='import'`) sao explicitamente excluidos |

> **Webhook vs import na contagem do plano.** A contagem mensal considerada pelo `max_sales_monthly` inclui apenas vendas com `source='webhook'`. Vendas inseridas pela funcionalidade de importacao retroativa (`source='import'`) sao explicitamente excluidas para que o usuario possa popular seu historico sem consumir a cota do plano. Um refund posterior em uma venda importada nao altera `source`, de modo que imports permanecem fora do plan-limit para sempre. Detalhes do fluxo em `docs/features/15-import-sales/import-sales.md`.

### 3.1 Matriz de Limites por Plano

| Plano | Vendas/mes | Ad accounts ativas | Integracoes | Workspaces | Regras ativas | Overage/venda extra |
|---|---|---|---|---|---|---|
| free | 30 | 1 | 1 | 1 | 0 | — (bloqueia) |
| pro | 1.000 | 3 | 3 | 3 | 3 | R$ 0,14 |
| starter | 2.500 | 7 | 7 | 7 | 7 | R$ 0,12 |
| enterprise | 5.000 | ilimitado | ilimitado | ilimitado | ilimitado | R$ 0,07 |
| unlimited | ilimitado | ilimitado | ilimitado | ilimitado | ilimitado | — |

> Valores persistidos no seed `20260417100007_seed_plan_rules_values.sql`. Admin pode editar via `/admin/plans`.

---

## 4. Modelo de Dados

### 4.1 Tabelas Principais

#### `plan_rules`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| plan | TEXT | Nao | — | Nome do plano: free, pro, starter, enterprise, unlimited |
| max_sales_monthly | INTEGER | Nao | — | Limite de vendas aprovadas por ciclo. -1 = ilimitado |
| max_active_ad_accounts | INTEGER | Nao | — | Limite de ad accounts com is_active=true. -1 = ilimitado |
| max_checkout_integrations | INTEGER | Nao | — | Limite de integracoes de checkout. -1 = ilimitado |
| max_workspaces | INTEGER | Nao | — | Limite de workspaces ativos (archived_at IS NULL). -1 = ilimitado |
| max_active_rules | INTEGER | Nao | — | Limite de regras de automacao ativas. -1 = ilimitado |
| overage_price_cents | INTEGER | Nao | 0 | Centavos por venda extra. 0 = bloqueia em vez de cobrar |
| updated_at | TIMESTAMPTZ | Sim | now() | Ultima atualizacao |

> Colunas removidas no refactor de 2026-04-17: `max_campaigns`, `sync_interval_minutes`, `feature_sales_globe`, `feature_advanced_reports`, `feature_conversion_funnel`, `feature_auto_sync`, `feature_api_access`.

#### Colunas relacionadas em outras tabelas

| Tabela | Coluna | Descricao |
|---|---|---|
| `sales` | `blocked_by_limit` boolean NOT NULL DEFAULT false | Venda acima do limite Free; nao conta em metricas nem receita |
| `workspaces` | `archived_at` timestamptz | Workspace soft-disabled. NULL = ativo |
| `workspaces` | `archived_by_system` boolean NOT NULL DEFAULT false | true = arquivado pelo auto-trim de downgrade |

### 4.2 Relacionamentos

```
subscriptions.plan_id -> plan_rules(id)   -- fonte de verdade do plano por usuario
profiles.plan_id      -> plan_rules(id)   -- valor derivado; sincronizado por apply_plan_change
usage_overage.subscription_id -> subscriptions(id)
usage_overage.sale_id -> sales(id)
```

### 4.3 Constraints e Defaults

- `plan` UNIQUE: cada plano tem exatamente um registro de regras.
- `overage_price_cents >= 0` (CHECK implicito via INTEGER NOT NULL).
- `UNIQUE INDEX uq_usage_overage_sale ON usage_overage(sale_id)` — garante idempotencia de overage por venda.

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/plan-limits/usage` | JWT | Retorna `UsageSnapshot` (uso/limite de cada recurso + bloqueadas + overage) |
| GET | `/api/plans/rules` | JWT + Admin | Lista regras de todos os planos (admin UI) |
| PATCH | `/api/plans/rules/:plan` | JWT + Admin | Atualiza limites de um plano especifico |

**Shape do `UsageSnapshot`** (resposta de `GET /api/plan-limits/usage`):

```ts
{
  plan: string;
  period: { start: string; end: string };
  sales:        { used: number; limit: number; blocked: number };
  workspaces:   { used: number; limit: number };
  adAccounts:   { used: number; limit: number };
  integrations: { used: number; limit: number };
  activeRules:  { used: number; limit: number };
  overage:      { count: number; totalCents: number };
}
```

### 5.2 Logica do Service

**`PlanLimitsService`** (`packages/backend/src/modules/plan-limits/plan-limits.service.ts`):

| Metodo | Descricao |
|---|---|
| `resolveUserPlan(userId)` | Busca `subscriptions` + `plan_rules` do usuario. Cacheado 30 s |
| `assertCanCreateWorkspace(userId)` | Lanca HTTP 402 se `workspaces.count >= max_workspaces` |
| `assertCanCreateIntegration(userId)` | Lanca HTTP 402 se `integrations.count >= max_checkout_integrations` |
| `assertCanActivateAdAccount(userId, adAccountId)` | Lanca HTTP 402 se `ad_accounts.count >= max_active_ad_accounts` |
| `assertCanActivateRule(userId, ruleId)` | Lanca HTTP 402 se `rules.count >= max_active_rules` |
| `checkSaleAcceptance(userId)` | Retorna `SaleDecision`: `{ blocked_by_limit: true }` para Free acima do limite; `{ overage: true, pricePerSaleCents }` para pagos; normal caso contrario |
| `getUsageSnapshot(userId)` | Monta e retorna `UsageSnapshot` completo |
| `invalidate(userId)` | Invalida todos os caches do usuario (chamado apos troca de plano) |

**Services que delegam a `PlanLimitsService`:**

| Service | Metodo | Limit verificado |
|---|---|---|
| `WorkspacesService` | `create()` | `assertCanCreateWorkspace` |
| `IntegrationsService` | `create()` | `assertCanCreateIntegration` |
| `AutomationRulesService` | `toggleRule()` ao ativar | `assertCanActivateRule` |
| `FacebookService` | `toggleActive()` ao ativar | `assertCanActivateAdAccount` |
| `SalesService` | `upsertFromWebhook()` (14 processadores) | `checkSaleAcceptance` |
| `AdminService` | `updateUser()` / `createUser()` | Via `SubscriptionsService.applyPlanChange` |

**`PlansService.update(plan, updates)`** — usado pelo endpoint admin PATCH:
- Filtra `updates` pela whitelist `ALLOWED_FIELDS`.
- Invalida cache `plan_rules:*` apos sucesso.

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Arquivo | Descricao |
|---|---|
| `src/hooks/usePlanUsage.ts` | Hook principal — busca e expoe contadores |
| `src/components/PlanLimitModal.tsx` | Modal exibida ao receber HTTP 402 de qualquer endpoint |
| `src/components/PlanUsageCard.tsx` | Card em Settings > Plano mostrando uso por recurso |
| `src/pages/admin/AdminPlans.tsx` | Pagina admin para editar limites de planos |
| `src/components/WorkspaceSwitcher.tsx` | Exibe grupo "Arquivados" para workspaces com archived_at |

### 6.2 Hooks

| Hook | Arquivo | Retorno Principal |
|---|---|---|
| `usePlanUsage` | `src/hooks/usePlanUsage.ts` | `{ usage, isLoading, canCreate, canActivate, isAtLimit, isNearLimit, remaining }` |

**Metodos do `usePlanUsage`:**

- `canCreate(resource)` — true se ainda ha slots disponiveis para `workspace` ou `integration`.
- `canActivate(resource)` — true se ainda ha slots para `adAccount` ou `rule`.
- `isAtLimit(resource)` — true se `used === limit`.
- `isNearLimit(resource, threshold=0.9)` — true se `used/limit >= threshold`.
- `remaining(resource)` — numero de slots restantes, ou `Infinity` se limite = -1.

### 6.3 Gerenciamento de Estado

| Estado | Descricao |
|---|---|
| TanStack Query key `['plan-usage']` | Cache de 30 s; invalida ao receber 402 |
| staleTime: 30.000 ms | Evita refetch frequente nos fluxos de criacao |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| `subscriptions` | Tabela | Fonte de verdade do plano/ciclo do usuario — ver `subscriptions.md` |
| `usage_overage` | Tabela | Registro de vendas excedentes para cobranca futura — ver `overage-billing.md` |
| Downgrade auto-trim | RPC `apply_plan_change` | Soft-disable de recursos ao reduzir plano — ver `downgrade-auto-trim.md` |
| Admin > Planos | UI | Administradores editam limites via `PATCH /api/plans/rules/:plan` |
| 14 webhook processors | Enforcement | `SalesService.upsertFromWebhook` chama `checkSaleAcceptance` em todos os processadores |
| WorkspaceSwitcher | Frontend | Lista workspaces arquivados com cadeado em grupo separado |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Subscription nao encontrada para o usuario | `PlanLimitsService.resolveUserPlan` lanca `Error('No subscription for user X')` — retorna 500 |
| Limite -1 | `assertLimit` retorna imediatamente sem consultar contagens |
| Contagens no cache durante limite exato | Possivel race (user no exato limite): 10 s de TTL minimiza; enforcement duplo no banco previne duplicatas |
| Free com `max_active_rules = 0` | `checkSaleAcceptance` nao e afetado; `assertCanActivateRule` lanca 402 imediatamente pois `0 >= 0` |
| Campo fora da whitelist no PATCH admin | Silenciosamente ignorado; nao lanca erro |
| Overage inserido em duplicata (webhook retentado) | `UNIQUE INDEX uq_usage_overage_sale` lanca conflito; `SalesService` usa upsert que ignora o insert do overage |

---

## 9. Checklist de Testes

- [ ] `GET /api/plan-limits/usage` retorna shape completo de `UsageSnapshot` para usuario autenticado
- [ ] `PlanLimitsService.assertCanCreateWorkspace` lanca 402 quando `workspaces.count >= limit`
- [ ] `PlanLimitsService.assertCanCreateIntegration` lanca 402 quando `integrations.count >= limit`
- [ ] `PlanLimitsService.assertCanActivateAdAccount` lanca 402 quando `ad_accounts.count >= limit`
- [ ] `PlanLimitsService.assertCanActivateRule` lanca 402 quando `rules.count >= limit`
- [ ] `checkSaleAcceptance` retorna `blocked_by_limit=true` para Free acima de 30 vendas
- [ ] `checkSaleAcceptance` retorna `overage=true, pricePerSaleCents=14` para Pro acima de 1.000 vendas
- [ ] Venda bloqueada nao aparece em metricas (dashboard exclui `blocked_by_limit=true`)
- [ ] `PATCH /api/plans/rules/:plan` aceita apenas campos da whitelist
- [ ] `PATCH /api/plans/rules/:plan` retorna 403 para usuario nao-admin
- [ ] `PlanLimitModal` e exibida ao receber HTTP 402
- [ ] Botoes de criar workspace/integracao ficam desabilitados quando `isAtLimit` e true
- [ ] `usePlanUsage.remaining` retorna `Infinity` para limite -1
- [ ] Cache e invalidado apos `SubscriptionsService.applyPlanChange`

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Stripe IDs em plan_rules | `stripe_product_id`, `stripe_price_id_base`, `stripe_price_id_metered`, `stripe_meter_event_name` populados pelo `stripe-sync.ts`. Ver `stripe-integration.md` para detalhes. |
| Q02 | Auditoria de mudancas admin | Nao ha log quando admin altera limites de plano via PATCH |
| Q03 | Reativacao de workspace arquivado | Em upgrade o sistema nao rearquiva workspaces automaticamente; usuario escolhe manualmente qual reativar |
| Q04 | Alertas de overage | Nao ha notificacao para o usuario quando overage comeca a ser acumulado no ciclo corrente |
