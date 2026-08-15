# Downgrade e Auto-Trim

> **Modulo:** `packages/backend/src/modules/subscriptions/` | **Implementacao:** `SubscriptionsService.applyPlanChange` (TypeScript)
> **Ultima atualizacao:** 2026-04-17
> **Status:** Aprovado

---

## 1. Proposito

Quando um usuario troca de plano (upgrade ou downgrade), o sistema executa a mudanca via `SubscriptionsService.applyPlanChange` (TypeScript puro). Se o novo plano tem limites mais apertados (downgrade), o sistema automaticamente arquiva/desativa os recursos em excesso usando heuristicas baseadas em uso recente — preserva os mais relevantes, "soft-disable" do resto. Se o novo plano libera mais vendas (upgrade em `max_sales_monthly`), vendas que estavam bloqueadas nos ultimos 30 dias sao desbloqueadas. Nenhum dado e deletado; tudo fica reversivel via reativacao manual apos novo upgrade.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Admin > Usuarios (`/admin/users/:id`) | Admin altera campo `plan` do usuario; `AdminService` chama `SubscriptionsService.applyPlanChange`. |
| Webhook Stripe `customer.subscription.updated` | **Futuro.** Apos integracao com Stripe, o handler do webhook vai chamar `applyPlanChange` com `period_start`/`period_end` vindos do payload. |

### 2.2 Fluxo de UI

1. Admin altera o plano de um usuario no dashboard.
2. Backend chama `SubscriptionsService.applyPlanChange(userId, newPlanId)`.
3. Em sequencia (sem transacao — ver secao 4.3):
   - Se upgrade em `max_sales_monthly`: vendas com `blocked_by_limit=true` dos ultimos 30 dias sao liberadas (`blocked_by_limit=false`).
   - Se algum limite apertou: auto-trim arquiva/desativa os recursos em excesso (passos 3-6).
   - `subscriptions.plan_id`, `current_period_start`, `current_period_end` sao atualizados APOS os trims (periodo reinicia em `now()` + 30 dias).
   - `profiles.plan_id` e sincronizado.
4. Cache de `PlanLimitsService` e invalidado.
5. Usuario ve os recursos arquivados em:
   - `WorkspaceSwitcher` — grupo "Arquivados" com cadeado 🔒.
   - `Settings > Plano` — `PlanUsageCard` mostra uso atualizado.
6. Para reativar apos novo upgrade: usuario escolhe manualmente quais recursos reativar (nao ha reativacao automatica).

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Trocar plano via admin | Somente admin |
| Trocar plano via Stripe webhook (futuro) | Somente assinatura valida pela signature Stripe |
| Reativar workspace/integracao/regra manualmente apos upgrade | Dono do recurso |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Troca de plano usa ordenacao segura | Chamada de `applyPlanChange` | Os passos 2-6 (unblock/trim) sao executados antes do passo 7 (subscription + profile). Se falha intermediaria, a identidade de plano nao muda e o admin pode retentar. Cada passo e idempotente. |
| RN-02 | Upgrade libera vendas bloqueadas | `newPlan.max_sales_monthly > oldPlan.max_sales_monthly` ou `newPlan.max_sales_monthly = -1` | `UPDATE sales SET blocked_by_limit=false WHERE user_id=$1 AND blocked_by_limit=true AND sold_at >= now() - 30 days` |
| RN-03 | Downgrade nao deleta dados | Qualquer downgrade | Soft-disable: `archived_at=now()` para workspaces; `is_active=false` para ad accounts, integracoes e regras. |
| RN-04 | Workspaces: mantem os de maior receita | `newPlan.max_workspaces <> -1` e user tem mais workspaces que o limite | Ordena por receita aprovada do ultimo ciclo (desc), tiebreaker `created_at DESC`. Arquiva os excedentes com `archived_at=now(), archived_by_system=true`. |
| RN-05 | Ad accounts: mantem os mais recentes | `newPlan.max_active_ad_accounts <> -1` e user tem mais ad accounts ativas que o limite | Ordena por `created_at DESC`. Seta `is_active=false` nos excedentes. |
| RN-06 | Integracoes: mantem as mais usadas | `newPlan.max_checkout_integrations <> -1` e user tem mais integracoes que o limite | Ordena por vendas aprovadas no ultimo ciclo (desc), tiebreaker `created_at DESC`. Seta `is_active=false` nos excedentes. |
| RN-07 | Regras: mantem as mais executadas | `newPlan.max_active_rules <> -1` e user tem mais regras ativas que o limite | Ordena por `last_executed_at DESC NULLS LAST`, tiebreaker `created_at DESC`. Seta `is_active=false` nos excedentes. |
| RN-08 | Workspace arquivado e visivel mas inativo | `workspaces.archived_at IS NOT NULL` | Aparece em `GET /api/workspaces/archived`, mostrado no `WorkspaceSwitcher` com cadeado; nao aparece em listas de workspaces ativos. |
| RN-09 | Reativacao manual apos upgrade | Usuario faz upgrade e quer voltar a usar workspace arquivado | Sistema NAO reativa automaticamente. Usuario chama endpoint de reativacao (quando implementado) ou admin faz manualmente. |
| RN-10 | `profiles.plan_id` e derivado | Qualquer troca de plano | `apply_plan_change` atualiza tanto `subscriptions.plan_id` quanto `profiles.plan_id` na mesma transacao. `subscriptions` e fonte de verdade. |

---

## 4. Modelo de Dados

### 4.1 Implementacao Central: `SubscriptionsService.applyPlanChange`

Arquivo: `packages/backend/src/modules/subscriptions/subscriptions.service.ts`

**Assinatura TypeScript:**
```typescript
applyPlanChange(userId: string, newPlanId: string): Promise<ApplyPlanChangeResult>
```

**Retorno (`ApplyPlanChangeResult`):**
```json
{
  "unblocked_sales": 12,
  "trimmed": {
    "workspaces": 3,
    "ad_accounts": 2,
    "integrations": 1,
    "rules": 0
  },
  "old_plan": "enterprise",
  "new_plan": "pro"
}
```

**Os 7 passos em ordem:**

| Passo | Operacao | Tabela |
|-------|----------|--------|
| 1 | Busca subscription + new plan (paralelo), depois old plan | `subscriptions`, `plan_rules` |
| 2 | Unblock vendas bloqueadas (so se upgrade em `max_sales_monthly`) | `sales` |
| 3 | Arquiva workspaces em excesso por receita dos ultimos 30d | `workspaces`, `sales` |
| 4 | Desativa ad accounts em excesso por `created_at DESC` | `facebook_connections` |
| 5 | Desativa integracoes em excesso por vendas dos ultimos 30d | `checkout_integrations`, `sales` |
| 6 | Desativa regras em excesso por `last_executed_at DESC NULLS LAST` | `automation_rules` |
| 7 | Atualiza `subscriptions.plan_id` e `profiles.plan_id` (ULTIMO) | `subscriptions`, `profiles` |

**Metodos privados auxiliares:**
- `archiveExcessWorkspaces` — passo 3
- `deactivateExcessAdAccounts` — passo 4
- `fetchActiveWorkspaceIds` — reutilizado nos passos 5 e 6
- `deactivateExcessIntegrations` — passo 5
- `deactivateExcessRules` — passo 6

### 4.2 Atomicidade

A implementacao original era uma funcao Postgres (`apply_plan_change`) dentro de
uma transacao para garantir atomicidade estrita. Devido a problemas repetidos com
o parser PL/pgSQL do Supabase SQL Editor (ERROR 42P01 em todas as variaveis), a
logica foi movida para TypeScript.

Consequencias:
- Nao ha transacao cross-query: se um passo falhar, passos anteriores nao sao
  desfeitos automaticamente.
- Mitigacao: os passos 2-6 (unblock/trim) sao executados ANTES do passo 7
  (update subscription + profile). Se qualquer passo intermediario falhar, a
  identidade do plano no `subscriptions.plan_id` permanece a antiga; o admin
  pode re-executar com seguranca.
- Cada passo individual e idempotente (UPDATE por ID e seguro de retentar).
- Erros sao logados via `DiscordLoggerService.logApiError` com contexto
  completo (`endpoint`, `userId`, `newPlanId`).

### 4.3 Colunas relevantes

| Tabela | Coluna | Uso |
|---|---|---|
| `workspaces` | `archived_at timestamptz` | `NOT NULL` = workspace arquivado. Indice parcial `idx_workspaces_active` filtra os ativos. |
| `workspaces` | `archived_by_system boolean` | `true` se arquivado pelo auto-trim. `false` se arquivamento manual. |
| `facebook_connections` | `is_active boolean` | `false` = ad account desativada pelo trim. |
| `checkout_integrations` | `is_active boolean` | `false` = integracao desativada pelo trim. |
| `automation_rules` | `is_active boolean` | `false` = regra desativada pelo trim. |
| `sales` | `blocked_by_limit boolean` | `true` = venda Free bloqueada por limite. Upgrade pode setar pra `false` retroativamente. |
| `subscriptions` | `scheduled_plan_id`, `scheduled_changes_at` | Espelham agendamento do Customer Portal Stripe; populados por `customer.subscription.updated` webhook. |

---

## 5. API / Backend

### 5.1 Endpoints Relacionados

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| PATCH | `/api/admin/users/:id` | JWT + Admin | Altera plano de usuario (entre outras coisas). `AdminService` chama `applyPlanChange` se o plano foi trocado. |
| POST | `/api/admin/users` | JWT + Admin | Cria usuario; se dto inclui `plan != 'starter'`, chama `applyPlanChange` apos criar profile. |
| GET | `/api/workspaces/archived` | JWT | Lista workspaces com `archived_at IS NOT NULL` do usuario atual. |

> `POST /api/stripe/webhook` com handler `customer.subscription.updated` chama `applyPlanChange(userId, newPlanId, { periodStart, periodEnd })` com datas reais do payload Stripe. Ver `stripe-integration.md` para detalhes completos.

### 5.2 Logica do Service

**`SubscriptionsService.applyPlanChange(userId, newPlanId)`**
- Implementacao TypeScript pura com queries Supabase diretas (sem RPC).
- Executa os 7 passos em sequencia (ver secao 4.1).
- Em erro: loga via `DiscordLoggerService.logApiError` com `{ endpoint, userId, newPlanId, error }` e re-throw.
- Em sucesso: chama `PlanLimitsService.invalidate(userId)` e retorna `ApplyPlanChangeResult`.
- Sem transacao — usa ordenacao segura (subscription/profile update por ultimo).

---

## 6. Implementacao no Frontend

### 6.1 Componentes que exibem efeito do trim

| Componente | Arquivo | Comportamento |
|---|---|---|
| `WorkspaceSwitcher` | `src/components/WorkspaceSwitcher.tsx` | Variant sidebar: mostra grupo "Arquivados" abaixo dos workspaces ativos com cadeado 🔒 (disabled). |
| `PlanUsageCard` | `src/components/PlanUsageCard.tsx` | Usado em Settings > Plano: barras de uso refletem contagens apos o trim. |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `usePlanUsage` | `src/hooks/usePlanUsage.ts` | `{ usage, canCreate, canActivate, isAtLimit, isNearLimit, remaining, isLoading }` — reflete estado atualizado apos trim. |

### 6.3 Gerenciamento de Estado

Apos um trim (disparado pelo admin no backend), o frontend do usuario **nao recebe invalidacao automatica** do cache TanStack Query. O proximo fetch (apos `staleTime` de 30s) refletira o estado novo. Em produto, isto e aceitavel porque:
- Trocas de plano via admin sao raras.
- Trocas via Stripe webhook futuro tambem sao raras.
- Usuario provavelmente ve a mudanca ao recarregar a pagina.

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| `AdminService.updateUser/createUser` | Caller | Chama `applyPlanChange` quando plano muda. |
| `SubscriptionsService` | Orquestrador | Executa os 7 passos em TypeScript e invalida cache de `PlanLimitsService`. |
| `PlanLimitsService.invalidate` | Invalidation | Limpa cache por usuario apos trim. |
| `StripeWebhookService` | Caller | Chama `applyPlanChange` a partir dos eventos `customer.subscription.created/updated/deleted`. |
| Discord Logs | Observability | Erros de RPC sao logados via `DiscordLoggerService.logApiError`. |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| `newPlanId` nao existe em `plan_rules` | `throw new Error('Plan X not found')` — nenhuma escrita ocorreu. |
| Usuario nao tem `subscriptions` | `throw new Error('Subscription not found for user X')` — nenhuma escrita ocorreu. |
| Novo plano e igual ao atual (sem mudanca) | Todos os passos executam mas todos os `if` sao `false`. `unblocked_sales=0, trimmed={0,0,0,0}`. Periodo reinicia mesmo assim (behavior aceitavel). |
| Upgrade Pro → Enterprise (sem tightening) | Apenas unblock opera se `max_sales_monthly` subiu. Nenhum trim dispara. |
| Downgrade Enterprise → Unlimited-with-lower-limits | Nao existe — `unlimited` tem todos os limites em `-1`. Nenhum trim dispara. |
| Workspace arquivado tem integracoes ativas | `fetchActiveWorkspaceIds` filtra `archived_at IS NULL`, entao integracoes de workspaces arquivados ficam como estavam. Queries do frontend tambem filtram `archived_at IS NULL`. |
| Race entre webhook Stripe e admin simultaneo | Sem `FOR UPDATE` — pode ocorrer double-write. Mitigation futura: lock otimista ou idempotency key via `scheduled_plan_id`. |

---

## 9. Checklist de Testes

- [ ] Admin troca plano Pro → Free: apos `applyPlanChange`, `subscriptions.plan_id` aponta para free, `profiles.plan_id` idem.
- [ ] Downgrade com 5 workspaces para um plano que permite 1: exatamente 4 workspaces ficam com `archived_at NOT NULL`. O de maior receita no ultimo ciclo permanece ativo.
- [ ] Downgrade com 5 ad accounts ativas para um plano que permite 1: 4 ficam com `is_active=false`. O mais recente (ordenado por `created_at DESC`) permanece ativo.
- [ ] Upgrade Free (30 vendas/mes) → Pro (1000 vendas/mes) com 5 vendas bloqueadas: `blocked_by_limit` das 5 vendas (se dentro dos ultimos 30 dias) vira `false` na mesma transacao.
- [ ] Upgrade nao gera overage retroativo: se Free tinha 50 vendas bloqueadas e vira Pro, nao aparecem 50 linhas em `usage_overage`.
- [ ] Plano invalido: `applyPlanChange` lanca `'Plan X not found'` e nenhuma escrita ocorreu.
- [ ] `WorkspaceSwitcher` exibe "Arquivados" com cadeado apos downgrade.
- [ ] `PlanLimitsService.invalidate` e chamado apos o passo 7 (cache zerado).
- [ ] Dois admins chamam `applyPlanChange` simultaneamente para o mesmo usuario: sem `FOR UPDATE`, race pode causar double-write — monitorar via Discord log.

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Reativacao em batch | Apos upgrade, user pode querer reativar "os 3 workspaces de maior receita" de uma vez. Hoje precisa reativar um por um. |
| Q02 | Reativacao automatica de recursos apos upgrade | Hoje recursos arquivados nao sao reativados automaticamente quando user faz upgrade. User precisa reativar manualmente. |
| Q03 | Notificacao ao usuario | Nao ha email/banner informando "seu plano foi alterado, X workspaces arquivados". Esta intencionalmente fora de escopo nesta fase. |
| Q04 | Reconciliacao Stripe | Job que compara subscriptions locais com Stripe para detectar webhook perdido — fase futura. |
| Q05 | Historico de mudancas | Nao ha tabela `subscription_changes` com auditoria das trocas. Pode ser util pra support/analytics futuramente. |
