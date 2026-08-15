# Subscriptions (Assinaturas)

> **Modulo:** `packages/backend/src/modules/subscriptions/`
> **Ultima atualizacao:** 2026-04-17
> **Status:** Aprovado

---

## 1. Proposito

A tabela `subscriptions` e a fonte de verdade do plano e do ciclo de faturamento de cada usuario. Cada usuario tem exatamente uma linha que guarda qual `plan_rules` esta ativo e qual o intervalo de periodo corrente (`current_period_start` / `current_period_end`). A coluna `profiles.plan_id` e um valor derivado — sincronizado atomicamente pela funcao `apply_plan_change` — e existe apenas para queries de leitura rapida sem necessidade de join. O `PlanLimitsService` sempre parte de `subscriptions` para resolver o plano de um usuario.

O ciclo atual e fixo em 30 dias para usuarios Free. Para usuarios em planos pagos, as datas do periodo vem dos webhooks Stripe (`customer.subscription.created` / `customer.subscription.updated`).

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Qualquer verificacao de limite | `PlanLimitsService.resolveUserPlan` busca a subscription do usuario |
| Admin troca o plano | `AdminService.updateUser` chama `SubscriptionsService.applyPlanChange` |
| GET /api/plan-limits/usage | Retorna `period.start` / `period.end` da subscription corrente |

### 2.2 Fluxo

1. Na criacao da conta, o backfill `20260417100002_backfill_subscriptions.sql` cria a linha com base em `profiles.subscription_start` (ou `profiles.created_at`) + 30 dias de periodo.
2. A cada mudanca de plano (via admin ou Stripe webhook), `apply_plan_change` atualiza a linha atomicamente: novo `plan_id`, e datas de periodo (`periodStart`, `periodEnd`). Quando chamado pelo webhook Stripe, usa as datas reais do evento; quando chamado pelo admin, usa `now() + 30 days`.
3. O `PlanLimitsService` le a subscription em cada verificacao de limite, com cache de 30 s por usuario.

### Integracao com Stripe

`stripe_customer_id` e `stripe_subscription_id` sao populados quando o usuario completa um Checkout Session. Fluxo:

1. User no Free clica "Fazer upgrade" no Settings → aba Plano → `POST /api/stripe/checkout` → redirect pro Stripe Checkout.
2. User paga com cartao → Stripe dispara `customer.subscription.created`.
3. Handler em `StripeWebhookService.handleSubscriptionCreated` atualiza `stripe_subscription_id` e chama `SubscriptionsService.applyPlanChange(userId, planId, { periodStart, periodEnd })` com datas reais do evento Stripe.

`cancel_at_period_end`, `scheduled_plan_id` e `scheduled_changes_at` espelham estado da assinatura Stripe, populados via webhook `customer.subscription.updated`. O frontend usa esses campos via `GET /api/plan-limits/usage` para exibir avisos de cancelamento agendado / downgrade agendado na aba Plano do Settings.

Quando assinatura e cancelada (via Customer Portal ou falha de pagamento), Stripe dispara `customer.subscription.deleted` e o handler chama `applyPlanChange(userId, FREE_PLAN_ID)` — auto-trim roda normalmente.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Leitura da propria subscription | Usuario autenticado (RLS SELECT policy) |
| Escrita / atualizacao | Somente via `SECURITY DEFINER` function `apply_plan_change` ou service role no backend |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | 1 subscription por usuario | `UNIQUE(user_id)` | INSERT em duplicata falha com conflito |
| RN-02 | `profiles.plan_id` e valor derivado | Toda troca de plano | `apply_plan_change` atualiza `subscriptions` e `profiles` na mesma transacao |
| RN-03 | Ciclo de 30 dias | `apply_plan_change` | `current_period_start = now()`, `current_period_end = now() + interval '30 days'` |
| RN-04 | Backfill usa `subscription_start` | Migracao inicial | `COALESCE(p.subscription_start::timestamptz, p.created_at)` como period_start |
| RN-05 | Campos Stripe lazy | Users Free nao tem customer Stripe | `stripe_customer_id` e `stripe_subscription_id` sao NULL ate o 1o upgrade via Checkout |
| RN-06 | Scheduled plan nullable | Sem downgrade agendado | `scheduled_plan_id` e `scheduled_changes_at` sao NULL quando nao ha mudanca de plano agendada no Customer Portal |

---

## 4. Modelo de Dados

### 4.1 Tabela Principal: `subscriptions`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | — | Referencia `auth.users(id)`. UNIQUE — 1 por usuario |
| plan_id | UUID | Nao | — | Referencia `plan_rules(id)`. Plano corrente |
| status | TEXT | Nao | 'active' | active / trialing / past_due / canceled / paused |
| current_period_start | TIMESTAMPTZ | Nao | — | Inicio do ciclo corrente |
| current_period_end | TIMESTAMPTZ | Nao | — | Fim do ciclo corrente |
| cancel_at_period_end | BOOLEAN | Nao | false | Marcado quando usuario cancelou mas ainda esta no ciclo pago |
| stripe_customer_id | TEXT | Sim | NULL | Preenchido no 1o upgrade (lazy); fonte: webhook `customer.subscription.created` |
| stripe_subscription_id | TEXT | Sim | NULL | Preenchido por `customer.subscription.created`; zerado em `subscription.deleted` |
| scheduled_plan_id | UUID | Sim | NULL | Plano a vigorar na proxima renovacao; populado via `customer.subscription.updated` (Customer Portal) |
| scheduled_changes_at | TIMESTAMPTZ | Sim | NULL | Data da transicao agendada; populado junto com `scheduled_plan_id` |
| created_at | TIMESTAMPTZ | Nao | now() | — |
| updated_at | TIMESTAMPTZ | Nao | now() | Atualizado a cada `apply_plan_change` |

### 4.2 Indexes

| Index | Colunas | Tipo | Motivo |
|---|---|---|---|
| `idx_subscriptions_user` | `user_id` | B-tree | Lookup principal por usuario |
| `idx_subscriptions_period_end` | `current_period_end` | B-tree | Job futuro de renovacao Stripe |
| `idx_subscriptions_scheduled_changes` | `scheduled_changes_at WHERE NOT NULL` | Partial B-tree | Job futuro de aplicacao de downgrades agendados |

### 4.3 Relacionamentos

```
subscriptions.user_id   -> auth.users(id)     ON DELETE CASCADE
subscriptions.plan_id   -> plan_rules(id)
subscriptions.scheduled_plan_id -> plan_rules(id)
profiles.plan_id        -> plan_rules(id)      (valor derivado, sincronizado por apply_plan_change)
usage_overage.subscription_id -> subscriptions(id) ON DELETE CASCADE
```

### 4.4 RLS

- `ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY`
- Policy `"Users can read own subscription"` TO authenticated USING `(SELECT auth.uid()) = user_id`.
- Escritas sao restritas ao service role (backend NestJS) ou via `SECURITY DEFINER` function.

---

## 5. API / Backend

### 5.1 Endpoints

Nao ha endpoint REST publico para `subscriptions` diretamente. O dado e exposto de forma derivada em:

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/plan-limits/usage` | JWT | Inclui `period.start` / `period.end` da subscription corrente |

Troca de plano e acionada pelo admin:

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| PATCH | `/api/admin/users/:id` | JWT + Admin | Campo `plan_id` aciona `SubscriptionsService.applyPlanChange` |

### 5.2 Logica do Service

**`SubscriptionsService.applyPlanChange(userId, newPlanId, options?)`**
- Aceita parametros opcionais `periodStart?: Date` e `periodEnd?: Date`. Quando chamado por webhooks Stripe, usa as datas reais do evento; quando chamado pelo admin sem datas, usa `now() + 30 days` (padrao do RPC Postgres).
- Chama RPC `apply_plan_change(p_user_id, p_new_plan_id, p_period_start?, p_period_end?)` via Supabase client.
- Em caso de erro, loga no Discord e relanca a excecao.
- Apos sucesso, chama `PlanLimitsService.invalidate(userId)` para limpar o cache.
- Retorna `ApplyPlanChangeResult`: `{ unblocked_sales, trimmed: { workspaces, ad_accounts, integrations, rules }, old_plan, new_plan }`.

**`PlanLimitsService.resolveUserPlan(userId)` (interno)**
- Busca `subscriptions` + `plan_rules` do usuario num par de queries sequenciais.
- Resultado cacheado por 30 s com chave `plan_limits:user:{userId}:plan`.

---

## 6. Implementacao no Frontend

### 6.1 Exposicao do Periodo

O hook `usePlanUsage` expoe `usage.period.start` e `usage.period.end` vindos da subscription. O `PlanUsageCard` usa essas datas para exibir "Ciclo atual: DD/MM/YYYY – DD/MM/YYYY".

### 6.2 Hooks

| Hook | Dado de Subscription |
|---|---|
| `usePlanUsage` | `usage.period.{ start, end }` e `usage.plan` |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| `plan_rules` | Tabela | `subscriptions.plan_id` referencia os limites do plano |
| `usage_overage` | Tabela | Cada linha de overage referencia `subscriptions.id` e o periodo em que ocorreu |
| `apply_plan_change` | RPC Postgres | Atualiza subscription atomicamente na troca de plano |
| `profiles` | Tabela | `profiles.plan_id` e sincronizado por `apply_plan_change` |
| Stripe | Webhook externo | `customer.subscription.created/updated/deleted` alimentam `stripe_customer_id`, `stripe_subscription_id`, `cancel_at_period_end`, `scheduled_plan_id` e chamam `applyPlanChange` |
| `StripeCheckoutService` | Service | Cria Checkout Session (upgrade Free→pago) e Portal Session (auto-servico usuario pago) |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Usuario sem subscription | `resolveUserPlan` lanca `Error('No subscription for user X')` — retorna 500 |
| Backfill: usuario sem `subscription_start` | `COALESCE(p.subscription_start::timestamptz, p.created_at)` usa `created_at` como fallback |
| Troca de plano concorrente | `apply_plan_change` faz `SELECT ... FOR UPDATE` na subscription antes de modificar |
| `apply_plan_change` falha no Postgres | Transacao completa e revertida; `SubscriptionsService` loga no Discord e relanca o erro |

---

## 9. Checklist de Testes

- [ ] Todo usuario criado tem exatamente uma linha em `subscriptions` apos backfill
- [ ] `PlanLimitsService.resolveUserPlan` busca plano correto da subscription
- [ ] `SubscriptionsService.applyPlanChange` atualiza `plan_id` e `updated_at` em `subscriptions`
- [ ] `profiles.plan_id` e sincronizado apos `applyPlanChange`
- [ ] `PlanLimitsService.invalidate` e chamado apos troca de plano
- [ ] Tentativa de criar segunda subscription para mesmo usuario falha (UNIQUE constraint)
- [ ] `GET /api/plan-limits/usage` retorna `period.start` e `period.end` corretos
- [ ] Campos Stripe retornam NULL para usuarios Free (pre-upgrade)
- [ ] Campos Stripe populados corretamente apos webhook `customer.subscription.created`
- [ ] `cancel_at_period_end` espelha estado do Stripe via `customer.subscription.updated`

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | `invoice.paid` — renovacao de ciclo | Evento logado mas nao atualiza `current_period_start/end` automaticamente; datas vem do webhook `subscription.updated` que acompanha cada renovacao |
| Q02 | `customer.subscription.trial_will_end` | Trial nao e suportado (Free e entrada permanente); evento ignorado se ocorrer |
| Q03 | Refund model | Venda approved→refunded depois de meter event reportado nao desfaz cobranca; tratado manualmente caso a caso (ver `stripe-integration.md` Q01) |
| Q04 | Emails customizados em falha de pagamento | Stripe envia email padrao; email personalizado fora de escopo nesta fase |
