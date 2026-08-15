# Plan Limits Refactor — Design Spec

**Data:** 2026-04-17
**Status:** Aprovado para implementação
**Autor:** Matheus Valois (com assistência de Claude)
**Escopo:** Reescrever o sistema de limites de planos do Sentinela para suportar 5 planos com enforcement real no backend, ciclo de assinatura preparado para Stripe, overage billing e downgrade com auto-trim.

---

## 1. Contexto e motivação

### 1.1 Estado atual (abril/2026)

O sistema tem uma tabela `plan_rules` com 13 colunas. Apenas **2** são realmente validadas em runtime:

- `max_checkout_integrations` — em `integrations.service.ts:34-61`.
- `max_active_rules` — em `automation-rules.service.ts:130-166`.

As demais colunas (`max_campaigns`, `max_sales`, `max_ad_accounts`, `max_workspaces`, `sync_interval_minutes`, e **5 feature flags** `feature_*`) são só armazenadas e lidas via endpoint de admin — nenhum componente do frontend as consome e nenhum service do backend as valida. São código morto.

Há também um bug: `max_active_rules` é validada mas está **fora** do `ALLOWED_FIELDS` de `plans.service.ts:5-17`, logo o admin não consegue editar via PATCH.

### 1.2 Requisitos dos novos planos

| Plano | Vendas/mês | Ad accounts ativas | Integrações | Workspaces | Regras ativas | Overage por venda extra |
|---|---|---|---|---|---|---|
| Free | 30 | 1 | 1 | 1 | 0 | — (bloqueia) |
| Pro | 1.000 | 3 | 3 | 3 | 3 | R$ 0,14 |
| Starter | 2.500 | 7 | 7 | 7 | 7 | R$ 0,12 |
| Enterprise | 5.000 | ∞ | ∞ | ∞ | ∞ | R$ 0,07 |
| Unlimited | ∞ | ∞ | ∞ | ∞ | ∞ | — |

Todos os limites são **por conta de usuário** (somados entre workspaces do mesmo usuário). O limite mensal de vendas segue o **ciclo da assinatura** (Stripe, futuramente — interino usa `subscription_start` ou `created_at`).

### 1.3 Objetivos deste refactor

1. Remover colunas mortas de `plan_rules`.
2. Centralizar enforcement em um `PlanLimitsService` único.
3. Introduzir tabela `subscriptions` preparada para Stripe (campos nullable).
4. Introduzir tabela `usage_overage` para registrar vendas extras nos planos pagos.
5. Adicionar `sales.blocked_by_limit` para o comportamento do Free (persiste mas não contabiliza).
6. Adicionar archive columns em `workspaces` para permitir soft-disable em downgrades.
7. Implementar `applyPlanChange(userId, newPlanId)` como única função de transição — chamada pelo webhook Stripe (futuro) e pelo admin (agora).
8. Frontend: hook `usePlanUsage` com `used/limit/remaining`, banners em Configurações, modal HTTP 402.
9. Deixar marcadores `// TODO(stripe):` em todos os pontos de extensão para facilitar a integração futura com Stripe.

### 1.4 Explicitamente **fora** de escopo

- Integração real com Stripe (API calls, webhooks, Customer Portal, checkout session).
- Job de reporting de `usage_overage` → Stripe Meter Events.
- Job de reconciliação com a API da Stripe.
- Notificações por email / banners de uso (usuário optou por "só exibir na tela de Configurações").
- Reativação automática de recursos arquivados após upgrade (é manual).
- Proration ou upgrade mid-cycle com rateio (upgrade é imediato e sem proration).

---

## 2. Mudanças de schema

### 2.1 `plan_rules`: remover, renomear e adicionar

**Remover:**
- `max_campaigns`
- `sync_interval_minutes`
- `feature_sales_globe`
- `feature_advanced_reports`
- `feature_conversion_funnel`
- `feature_auto_sync`
- `feature_api_access`

**Renomear:**
- `max_sales` → `max_sales_monthly`
- `max_ad_accounts` → `max_active_ad_accounts`

**Manter:**
- `max_checkout_integrations`
- `max_workspaces`
- `max_active_rules`

**Adicionar:**
- `overage_price_cents INTEGER NOT NULL DEFAULT 0`

**Seed final (valores aplicados via UPDATE após renomeação):**

| plan | max_sales_monthly | max_active_ad_accounts | max_checkout_integrations | max_workspaces | max_active_rules | overage_price_cents |
|---|---|---|---|---|---|---|
| free | 30 | 1 | 1 | 1 | 0 | 0 |
| pro | 1000 | 3 | 3 | 3 | 3 | 14 |
| starter | 2500 | 7 | 7 | 7 | 7 | 12 |
| enterprise | 5000 | -1 | -1 | -1 | -1 | 7 |
| unlimited | -1 | -1 | -1 | -1 | -1 | 0 |

> Convenção mantida: `-1 = ilimitado`.

### 2.2 Nova tabela `subscriptions`

```sql
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plan_rules(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','trialing','past_due','canceled','paused')),
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,

  -- TODO(stripe): campos populados pelo handler de customer.subscription.* webhooks
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text UNIQUE,

  -- TODO(stripe): downgrade agendado é fonte de verdade da Stripe.
  -- Essas colunas espelham o scheduled change para o banner no frontend.
  scheduled_plan_id    uuid REFERENCES public.plan_rules(id),
  scheduled_changes_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_period_end ON subscriptions(current_period_end);
CREATE INDEX idx_subscriptions_scheduled_changes
  ON subscriptions(scheduled_changes_at)
  WHERE scheduled_changes_at IS NOT NULL;
```

**RLS:** `user_id = (SELECT auth.uid())` para SELECT; somente service role pode INSERT/UPDATE/DELETE.

**Backfill inicial:** uma linha por profile:

```sql
INSERT INTO public.subscriptions (user_id, plan_id, current_period_start, current_period_end)
SELECT
  p.user_id,
  p.plan_id,
  COALESCE(p.subscription_start::timestamptz, p.created_at) AS start,
  COALESCE(p.subscription_start::timestamptz, p.created_at) + interval '30 days' AS end
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;
```

**`profiles.plan_id` continua existindo** como valor derivado (mantém read path atual). Regra: `subscriptions.plan_id` é a fonte de verdade; `profiles.plan_id` é atualizado em sincronia pela função `applyPlanChange`.

### 2.3 Nova tabela `usage_overage`

```sql
CREATE TABLE public.usage_overage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  price_cents integer NOT NULL,

  -- TODO(stripe): populado pelo job que envia meter events para a Stripe
  reported_to_stripe_at   timestamptz,
  stripe_usage_record_id  text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotência: uma venda gera no máximo uma linha de overage
CREATE UNIQUE INDEX uq_usage_overage_sale ON usage_overage(sale_id);
CREATE INDEX idx_usage_overage_user_period ON usage_overage(user_id, period_start, period_end);
CREATE INDEX idx_usage_overage_unreported
  ON usage_overage(subscription_id)
  WHERE reported_to_stripe_at IS NULL;
```

**RLS:** `user_id = (SELECT auth.uid())` para SELECT; somente service role pode INSERT/UPDATE/DELETE.

### 2.4 `sales.blocked_by_limit`

```sql
ALTER TABLE public.sales
  ADD COLUMN blocked_by_limit boolean NOT NULL DEFAULT false;

CREATE INDEX CONCURRENTLY idx_sales_blocked_by_limit
  ON sales(user_id) WHERE blocked_by_limit = true;
```

**Todos os queries existentes** em dashboards, campaigns, sales, financial, attribution etc. que filtram `status = 'approved'` precisam ganhar `AND blocked_by_limit = false`. Lista completa em §7.3.

### 2.5 `workspaces` — archive columns

```sql
ALTER TABLE public.workspaces
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by_system boolean NOT NULL DEFAULT false;

CREATE INDEX CONCURRENTLY idx_workspaces_active
  ON workspaces(user_id) WHERE archived_at IS NULL;
```

Todos os queries que listam workspaces ativos ganham `AND archived_at IS NULL`. A UI do workspace switcher mostra um grupo "Arquivados" separado, com cadeado, que redireciona para billing quando selecionado.

---

## 3. `PlanLimitsService` — o novo módulo central

Localização: `packages/backend/src/modules/plan-limits/` com `plan-limits.module.ts`, `plan-limits.service.ts` e exports adequados.

### 3.1 API pública

```ts
@Injectable()
export class PlanLimitsService {
  // ---- Assertions (lançam PlanLimitExceededException — HTTP 402) ----
  assertCanCreateWorkspace(userId: string): Promise<void>;
  assertCanActivateAdAccount(userId: string, adAccountId: string): Promise<void>;
  assertCanCreateIntegration(userId: string): Promise<void>;
  assertCanActivateRule(userId: string, ruleId: string): Promise<void>;

  // ---- Webhook de venda (não lança — retorna decisão estruturada) ----
  checkSaleAcceptance(userId: string): Promise<SaleDecision>;

  // ---- Leitura para o frontend ----
  getUsageSnapshot(userId: string): Promise<UsageSnapshot>;

  // ---- Invalidação de cache ----
  invalidate(userId: string): Promise<void>;
}

type SaleDecision =
  | { allowed: true; blocked_by_limit: false; overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: false; overage: true; pricePerSaleCents: number;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: true;  overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string };

type UsageSnapshot = {
  plan: string;
  period: { start: string; end: string };
  sales:        { used: number; limit: number; blocked: number };
  workspaces:   { used: number; limit: number };
  adAccounts:   { used: number; limit: number };  // ativas
  integrations: { used: number; limit: number };
  activeRules:  { used: number; limit: number };
  overage:      { count: number; totalCents: number };
};
```

### 3.2 Exception

```ts
// packages/backend/src/modules/plan-limits/plan-limit-exceeded.exception.ts
export class PlanLimitExceededException extends HttpException {
  constructor(public readonly detail: {
    resource: 'workspace' | 'ad_account' | 'integration' | 'active_rule';
    current: number;
    limit: number;
    plan: string;
  }) {
    super({ message: 'Plan limit exceeded', ...detail }, HttpStatus.PAYMENT_REQUIRED);
  }
}
```

Frontend trata HTTP 402 via interceptor global.

### 3.3 Cache

`PlanLimitsService` usa o `CacheService` existente:

| Chave | TTL | Invalidado quando |
|---|---|---|
| `plan_limits:user:<userId>:plan` | 30s | subscription ou plan_id muda |
| `plan_limits:user:<userId>:counts` | 10s | criação/ativação/desativação de recurso ou venda persistida |

`invalidate(userId)` limpa ambas.

### 3.4 Queries de contagem (por userId)

| Recurso | Query de contagem |
|---|---|
| Workspaces | `SELECT count(*) FROM workspaces WHERE user_id = $1 AND archived_at IS NULL` |
| Ad accounts ativas | `SELECT count(*) FROM facebook_ad_accounts a JOIN facebook_connections c ON c.id = a.connection_id WHERE c.user_id = $1 AND a.is_active = true` *(nomes exatos de tabela/coluna a confirmar durante implementação)* |
| Integrações checkout | `SELECT count(*) FROM checkout_integrations ci JOIN workspaces w ON w.id = ci.workspace_id WHERE w.user_id = $1 AND w.archived_at IS NULL` |
| Regras ativas | `SELECT count(*) FROM automation_rules ar JOIN workspaces w ON w.id = ar.workspace_id WHERE w.user_id = $1 AND ar.is_active = true AND w.archived_at IS NULL` |
| Vendas do ciclo | `SELECT count(*) FROM sales WHERE user_id = $1 AND status = 'approved' AND blocked_by_limit = false AND sold_at >= $periodStart AND sold_at < $periodEnd` |

### 3.5 Comportamento em falha de leitura

- **Assertions** (`assertCan*`) em falha: lança `ServiceUnavailableException` (HTTP 503). Usuário tenta de novo.
- **`checkSaleAcceptance`** em falha: retorna `{ allowed: true, blocked_by_limit: false, overage: false }` (fail-open) e grava `discord-log` com severidade alta. Não perdemos vendas por falha de infra.

---

## 4. Enforcement points — onde cada assertion é chamada

### 4.1 Matriz

| Ação | Arquivo atual | O que chamar |
|---|---|---|
| Criar workspace | `workspaces.service.ts` (método `create`) | `assertCanCreateWorkspace(userId)` antes do INSERT |
| Ativar ad account (flip `is_active=false → true`) | Service de ad accounts Facebook (confirmar nome durante implementação) | `assertCanActivateAdAccount(userId, adAccountId)` antes do UPDATE |
| Criar integração de checkout | `integrations.service.ts:34-61` | `assertCanCreateIntegration(userId)` — substitui a validação inline atual |
| Ativar regra de automação | `automation-rules.service.ts:130-166` | `assertCanActivateRule(userId, ruleId)` — substitui a validação inline atual |
| Webhook de venda `status='approved'` | `sales.service.ts` (ou service equivalente que persiste `sale`) | `checkSaleAcceptance(userId)` no início do fluxo (ver §5.1) |

**Nota:** desativação (`is_active=true → false`) não passa pelo limit service — só ativação consome cota.

### 4.2 Invalidação de cache após mutação

Cada service chama `planLimits.invalidate(userId)` **depois** de: criar/deletar workspace, ativar/desativar ad account, criar/deletar integração, ativar/desativar regra, persistir venda aprovada, atualizar subscription.

---

## 5. Fluxo do webhook de venda

### 5.1 Handler em `sales.service.ts`

```ts
async upsertFromWebhook(sale: NormalizedSale): Promise<Sale> {
  // 1. Status !== 'approved' → persiste sem passar pelo limit service
  if (sale.status !== 'approved') {
    return this.persist(sale);
  }

  // 2. Idempotência — retry de webhook não repete decisão
  const existing = await this.findByExternalId(sale.external_id, sale.platform);
  if (existing) return existing;

  // 3. Consulta o limit service
  const decision = await this.planLimits.checkSaleAcceptance(sale.user_id);

  // 4. Free acima do limite
  if (decision.blocked_by_limit) {
    return this.persist({ ...sale, blocked_by_limit: true });
  }

  // 5. Persiste venda normal (dentro de transação)
  return this.supabase.transaction(async (trx) => {
    const saved = await this.persist(sale, trx);

    // 6. Se excedeu o limite num plano pago, registra overage
    if (decision.overage) {
      // TODO(stripe): quando a integração entrar, adicionar chamada síncrona
      // (ou enfileirar job) para enviar meter event. Por ora só persistimos.
      await trx.from('usage_overage').insert({
        user_id: sale.user_id,
        subscription_id: decision.subscriptionId,
        sale_id: saved.id,
        period_start: decision.periodStart,
        period_end: decision.periodEnd,
        price_cents: decision.pricePerSaleCents,
      });
    }

    // 7. Invalida contagens
    await this.planLimits.invalidate(sale.user_id);
    return saved;
  });
}
```

**Garantias:**
- Idempotência: `findByExternalId` + `UNIQUE INDEX uq_usage_overage_sale`.
- Atomicidade: venda + overage em uma transação.
- Sempre 200 no happy path (inclusive bloqueadas — evita retry da plataforma).

### 5.2 Mudança de status depois da venda persistida

| Mudança | Efeito |
|---|---|
| `pending → approved` via webhook de update | Re-avalia: se passou do limite agora, insere em `usage_overage`. Se já era approved (idempotente), não faz nada. |
| `approved → refunded` ou `approved → chargeback` | Remove linha de `usage_overage` se `reported_to_stripe_at IS NULL`. Se já reportada, grava `refunded_after_report_at` *(campo a adicionar quando a integração Stripe entrar — não faz parte deste refactor)*. |

### 5.3 Vendas bloqueadas do Free visíveis ao usuário

Na página de Configurações → aba Plano, o card "Uso do plano" mostra:

> **Vendas aprovadas este ciclo:** 30 / 30 ⚠️
> **Vendas bloqueadas por limite:** 12 — faça upgrade para recuperar

Query: `count(*) from sales where user_id=$1 and status='approved' and blocked_by_limit=true and sold_at >= $periodStart`.

Vendas com `blocked_by_limit=true` **não entram** em métricas de receita, atribuição, ROAS, campanhas, financeiro.

### 5.4 Upgrade mid-cycle libera vendas bloqueadas dos últimos 30 dias

Dentro da transação de `applyPlanChange`, quando `newPlan.max_sales_monthly > oldPlan.max_sales_monthly`:

```sql
UPDATE sales
SET blocked_by_limit = false
WHERE user_id = $1
  AND blocked_by_limit = true
  AND sold_at >= (now() - interval '30 days');
```

**Regras:**
- Janela fixa de 30 dias corridos a partir do momento do upgrade.
- Liberação não gera overage retroativo.
- Cache de dashboards é invalidado.

---

## 6. Downgrade, scheduling e `applyPlanChange`

### 6.1 Propriedade do agendamento

Stripe é a fonte de verdade sobre "quando vai virar". As colunas `scheduled_plan_id` e `scheduled_changes_at` em `subscriptions` são **espelhos** populados pelo webhook `customer.subscription.updated` quando o usuário agenda um downgrade via Customer Portal (futuro).

**Não há cron interno** dirigindo a transição — o webhook Stripe é o relógio.

### 6.2 `applyPlanChange(userId, newPlanId)` — função central

Um único método em `SubscriptionsService` (novo módulo). Chamado por:

| Gatilho | Quando |
|---|---|
| Handler Stripe `customer.subscription.updated` | **Futuro.** Deploy com integração Stripe. Recebe o evento no momento real da virada. |
| `PATCH /api/admin/users/:id/plan` | **Agora.** Admin altera manualmente o plano (interino sem Stripe e intervenções de suporte). |

Ambos caminhos executam o mesmo fluxo transacional:

```ts
async applyPlanChange(userId: string, newPlanId: string): Promise<void> {
  return this.supabase.transaction(async (trx) => {
    const oldSub = await this.getSubscription(userId, trx);
    // Obs: `getRulesForPlanId` é método novo a adicionar em PlansService
    // (hoje existe apenas `getRulesForPlan(plan: string)` por nome).
    const [oldPlan, newPlan] = await Promise.all([
      this.plansService.getRulesForPlanId(oldSub.plan_id),
      this.plansService.getRulesForPlanId(newPlanId),
    ]);

    // 1. Upgrade libera vendas bloqueadas dos últimos 30 dias
    if (isUpgradeInSalesLimit(oldPlan, newPlan)) {
      await this.unblockRecentSales(userId, trx);  // §5.4
    }

    // 2. Downgrade dispara auto-trim
    if (hasAnyTightening(oldPlan, newPlan)) {
      await this.autoTrim.run(userId, newPlan, trx);  // §6.3
    }

    // 3. Atualiza subscription (period recomeça agora)
    // TODO(stripe): quando o gatilho for o webhook Stripe, use as datas do evento
    // (current_period_start/end vindos do payload) em vez de now().
    await trx.from('subscriptions').update({
      plan_id: newPlanId,
      current_period_start: new Date().toISOString(),
      current_period_end: addDays(new Date(), 30).toISOString(),
      scheduled_plan_id: null,
      scheduled_changes_at: null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);

    // 4. Sincroniza profiles.plan_id (valor derivado)
    await trx.from('profiles').update({ plan_id: newPlanId }).eq('user_id', userId);

    // 5. Invalida cache e registra log
    await this.planLimits.invalidate(userId);
    await this.discord.log('plan_change', { userId, oldPlan: oldPlan.plan, newPlan: newPlan.plan, ... });
  });
}
```

### 6.3 Auto-trim — heurísticas confirmadas

`AutoTrimService.run(userId, newPlan, trx)`:

| Recurso | Ordenação desc (mantém os top-N) | Ação nos excedentes |
|---|---|---|
| Workspaces | Receita aprovada no último ciclo (`SUM(sales.amount) WHERE status='approved' AND blocked_by_limit=false`) | `archived_at = now()`, `archived_by_system = true` |
| Ad accounts ativas | Spend total no último ciclo (via Facebook Insights) | `is_active = false` |
| Integrações checkout | Vendas aprovadas no último ciclo | `is_active = false` |
| Regras automação ativas | Nº de execuções no último ciclo (tabela `automation_rule_executions`) | `is_active = false` |

**N = limite do novo plano.** Se `newPlan.max_workspaces = 3` e usuário tem 6, mantém os 3 de maior receita e arquiva os outros 3.

> "Último ciclo" = janela `[current_period_start, current_period_end)` da subscription atual. Para usuários muito novos (primeiro ciclo recém-criado, pouca/nenhuma atividade), os recursos empatam em 0 e a ordenação cai nos tiebreakers: `created_at DESC` (mantém os mais recentes). Tiebreaker documentado aqui evita não-determinismo na hora do trim.

### 6.4 Reativação manual após upgrade

Se o usuário volta para um plano maior (upgrade), o sistema **não** reativa recursos automaticamente. Usuário escolhe na UI quais workspaces/ad_accounts/integrações/regras reativar, respeitando o novo limite.

---

## 7. Migração, cleanup e ordem de execução

### 7.1 Migrations SQL (ordem)

Cada migration em arquivo próprio em `supabase/migrations/`, com timestamp do dia da execução.

| # | Migration | Natureza |
|---|---|---|
| 1 | `add_plan_rules_overage_column` | Aditiva |
| 2 | `create_subscriptions_table` | Aditiva |
| 3 | `backfill_subscriptions` | Aditiva (INSERT a partir de profiles) |
| 4 | `create_usage_overage_table` | Aditiva |
| 5 | `sales_add_blocked_by_limit` | Aditiva (index com `CONCURRENTLY`) |
| 6 | `workspaces_add_archive_columns` | Aditiva (index com `CONCURRENTLY`) |
| 7 | `rename_plan_rules_columns` | Breaking (`max_sales` → `max_sales_monthly`, `max_ad_accounts` → `max_active_ad_accounts`) |
| 8 | `seed_plan_rules_values` | UPDATE (seed final dos 5 planos) |
| 9 | `drop_plan_rules_dead_columns` | Breaking (DROP `max_campaigns`, `sync_interval_minutes`, 5× `feature_*`) |

### 7.2 Ordem de deploy

1. **Deploy backend — fase aditiva:** migrations 1–6 + `PlanLimitsService`, `SubscriptionsService`, `AutoTrimService` implementados. Backend ainda usa `max_sales` / `max_ad_accounts` (nomes antigos).
2. **Deploy coordenado backend+frontend:** migrations 7 e 8 + backend atualizado para nomes novos + frontend com `usePlanUsage` e `AdminPlans` nova.
3. **Deploy backend — cleanup:** migration 9 (DROP das colunas mortas).

> Alternativa mais simples se o ambiente suporta down-time curto: rodar tudo de uma vez com deploy coordenado. Decisão do executor do plano.

### 7.3 Cleanup de código — arquivos alterados

**Backend:**

| Arquivo | Ação |
|---|---|
| `packages/backend/src/modules/plans/plans.service.ts` | Atualiza `ALLOWED_FIELDS` (nova lista com `max_active_rules` e `overage_price_cents`); atualiza SELECTs com nomes novos; remove colunas mortas. |
| `packages/backend/src/modules/plans/dto/update-plan.dto.ts` | Reescreve com campos sobreviventes + `overage_price_cents` + `class-validator`. |
| `packages/backend/src/modules/plan-limits/` | **Novo módulo** — `plan-limits.module.ts`, `plan-limits.service.ts`, `plan-limit-exceeded.exception.ts`. |
| `packages/backend/src/modules/subscriptions/` | **Novo módulo** — `subscriptions.module.ts`, `subscriptions.service.ts`, `auto-trim.service.ts`. Contém `applyPlanChange`. |
| `packages/backend/src/modules/integrations/integrations.service.ts` | Remove validação inline; chama `assertCanCreateIntegration`. |
| `packages/backend/src/modules/automation-rules/automation-rules.service.ts` | Remove validação inline; chama `assertCanActivateRule`. |
| `packages/backend/src/modules/workspaces/workspaces.service.ts` | Adiciona `assertCanCreateWorkspace` no create; aplica `archived_at IS NULL` em todos os SELECTs. |
| Service de Facebook ad accounts (nome exato a confirmar) | Adiciona `assertCanActivateAdAccount` no toggle. |
| `packages/backend/src/modules/sales/sales.service.ts` | Implementa fluxo §5.1 (decisão + persistência + overage em transação). |
| `packages/backend/src/modules/admin/admin.service.ts` | Endpoints 589 e 634 passam a chamar `applyPlanChange` em vez de UPDATE direto em `profiles.plan_id`. |
| Queries com `status='approved'` em dashboards/campaigns/sales/financial/attribution | Adicionam `AND blocked_by_limit = false`. |
| Queries que listam workspaces do usuário | Adicionam `AND archived_at IS NULL`. |

**Frontend:**

| Arquivo | Ação |
|---|---|
| `packages/frontend/src/hooks/usePlanRules.ts` | **Deletado.** |
| `packages/frontend/src/hooks/usePlanUsage.ts` | **Novo.** Consome `GET /api/plan-limits/usage` via TanStack Query com `staleTime: 30_000`. Expõe `canCreate`, `canActivate`, `isAtLimit`, `isNearLimit`, `remaining`, `usage`. |
| `packages/frontend/src/pages/admin/AdminPlans.tsx` | Remove `limitLabels`/`featureLabels` das colunas mortas; adiciona campo `overage_price_cents` com máscara em reais. |
| `packages/frontend/src/pages/settings/...` (aba Plano) | Novo card "Uso do plano" com barras de progresso por recurso + card de vendas bloqueadas + card de overage do ciclo. |
| `packages/frontend/src/components/layout/` (ou equivalente) | Novo `<PlanLimitModal />` renderizado quando interceptor HTTP detecta 402. |
| `packages/frontend/src/lib/api-client.ts` | Interceptor global para HTTP 402 → emite evento → modal. |
| `packages/frontend/src/components/workspaces/WorkspaceSwitcher.tsx` | Botão "Criar workspace" desabilitado quando `!canCreate('workspace')`. Grupo "Arquivados" com cadeado para workspaces com `archived_at IS NOT NULL`. |
| Componentes de ativação de ad accounts / rules | Toggle desabilitado quando `!canActivate(...)`. |
| `packages/frontend/src/types/...` (onde `PlanRules` é declarado) | Reescreve tipo alinhado ao novo schema. |

### 7.4 Documentação obrigatória (Rule 1 do CLAUDE.md)

- `SQL_DATABASE.md` — atualiza `plan_rules`; adiciona `subscriptions`, `usage_overage`; atualiza `workspaces` (novas colunas) e `sales` (`blocked_by_limit`).
- `docs/features/11-plans-and-limits/plan-rules.md` — reescrita completa alinhada ao novo design.
- `docs/features/11-plans-and-limits/subscriptions.md` — **novo.** Documenta ciclo de assinatura, backfill, preparação para Stripe.
- `docs/features/11-plans-and-limits/overage-billing.md` — **novo.** Documenta `usage_overage` e processo de reporting futuro.
- `docs/features/11-plans-and-limits/downgrade-auto-trim.md` — **novo.** Documenta heurísticas e fluxo `applyPlanChange`.

---

## 8. Comentários e marcadores para integração Stripe futura

**Convenção:** todo ponto de extensão para a integração Stripe fica marcado com o comment `// TODO(stripe):` seguido de uma linha curta explicando o que precisa ser feito.

**Locais que recebem esses marcadores:**

1. Colunas `stripe_customer_id`, `stripe_subscription_id`, `scheduled_plan_id`, `scheduled_changes_at` na tabela `subscriptions` (já no SQL, via `COMMENT ON COLUMN`).
2. Colunas `reported_to_stripe_at`, `stripe_usage_record_id` na tabela `usage_overage`.
3. `sales.service.ts:upsertFromWebhook` — ponto onde enfileirar meter event ao inserir em `usage_overage`.
4. `subscriptions.service.ts:applyPlanChange` — ponto onde as datas vêm do payload Stripe em vez de `now()`.
5. `subscriptions.service.ts` — comentário de módulo indicando "webhook handler entra aqui" com caminho esperado (`stripe.controller.ts` / `stripe-webhook.controller.ts`).
6. `SubscriptionsModule` — comment de classe listando os eventos Stripe que precisarão ser tratados: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `customer.subscription.trial_will_end`.
7. Tratamento de refund em sales (`approved → refunded`) — comment indicando onde adicionar `refunded_after_report_at` e disparo de crédito reverso.

Consulta rápida futura: `grep -r "TODO(stripe):" packages/backend/src` lista todos os pontos.

---

## 9. Testes críticos

Checklist que o plano de implementação vai detalhar:

- Free: 30ª venda approved persiste com `blocked_by_limit=true`; dashboard não conta.
- Pro: 1001ª venda approved cria linha em `usage_overage` com `price_cents=14`.
- Starter: 2501ª venda approved cria linha com `price_cents=12`.
- Enterprise: 5001ª venda approved cria linha com `price_cents=7`.
- Unlimited: nenhuma venda gera overage.
- Downgrade Pro→Free via `applyPlanChange` arquiva workspaces / desativa ad_accounts, integrações e rules excedentes pela heurística correta.
- Upgrade Free→Pro libera `blocked_by_limit=true` dos últimos 30 dias dentro da mesma transação.
- Admin não consegue editar campos fora da whitelist; consegue editar `max_active_rules` (bug atual corrigido).
- HTTP 402 em criação de workspace com limite atingido dispara modal com `resource: 'workspace'`.
- Webhook idempotente: mesma venda recebida 2x não duplica overage (`uq_usage_overage_sale`).
- Cache invalidation: após criar workspace, `getUsageSnapshot` reflete contagem atualizada em ≤10s.
- Queries de receita/métricas ignoram vendas com `blocked_by_limit=true`.
- Queries de workspace ignoram `archived_at IS NOT NULL` em listagens de usuário.

---

## 10. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Downtime da RENAME em `plan_rules` em produção | RENAME em Postgres é metadata-only (rápido). Schedule em janela baixa, mas deploy coordenado backend+frontend resolve qualquer race. |
| Adicionar `blocked_by_limit` em `sales` (tabela grande) bloqueia writes | Coluna com DEFAULT false é fast path (metadata); index criado `CONCURRENTLY`. |
| Fail-open em `checkSaleAcceptance` pode gastar cota silenciosamente | Discord-log com severidade alta + alertas, permite reconciliar depois. |
| Bug no auto-trim arquiva workspace errado | Ação é soft (archived_at), reversível. Log detalhado com `discord-log` mostra o que foi feito. |
| Stripe não integrada ainda, subscription period pode "expirar" | `current_period_end` é só informativo durante interino; nada usa ele como gatilho. Contagem de vendas usa a janela `[current_period_start, now())` enquanto `current_period_end` não for renovado. |

---

## 11. Decisões registradas

| # | Decisão | Racional |
|---|---|---|
| D01 | Limites são por usuário, não por workspace | Escolha do produto (Pergunta 1, opção A). |
| D02 | Ciclo mensal segue assinatura Stripe (interino: 30 dias a partir de `subscription_start`/`created_at`) | Stripe vai ser fonte de verdade; backfill é provisório (Pergunta 2, opção B). |
| D03 | Free: venda acima de 30 persiste com `blocked_by_limit=true` (não é descartada) | Usuário pode ver quanto perdeu e decidir upgrade (Pergunta 3, opção a.2). |
| D04 | Pagos: venda extra processa normal e registra overage em `usage_overage` | Cobrança é pós-paga via Stripe meter events (Pergunta 3, opção b.1). |
| D05 | Downgrade agendado: grace period com auto-trim na virada | Usuário tem tempo de ajustar manualmente; sistema faz o resto (Pergunta 4, solução customizada do usuário). |
| D06 | Auto-trim usa soft-disable, não hard-delete | Preserva histórico de vendas, campanhas e dados financeiros (Pergunta 5, opção a.2). |
| D07 | Heurísticas de auto-trim por receita / spend / vendas / execuções | Maximiza valor retido para o usuário. |
| D08 | Preço de overage é coluna `overage_price_cents` em `plan_rules` | Admin pode ajustar sem deploy (Pergunta 6, opção A). |
| D09 | Sem notificações por email nesta fase | Escopo reduzido, só exibir uso na tela de Configurações (Pergunta 7, opção E). |
| D10 | `applyPlanChange` é única função de transição, chamada por webhook Stripe OU admin | Elimina duplicação e mantém caminho único testável. Sem cron de virada — Stripe é o relógio. |
| D11 | Upgrade libera vendas bloqueadas dos últimos 30 dias na mesma transação | Decisão explícita do usuário durante o brainstorming. |
| D12 | Card "Uso do plano" só em Configurações, não no Dashboard | Evita poluir o dashboard principal. |
| D13 | Comentários `// TODO(stripe):` nos pontos de extensão | Facilita grep na próxima fase de integração. |
