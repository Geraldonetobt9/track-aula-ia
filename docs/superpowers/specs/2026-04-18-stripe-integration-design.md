# Stripe Integration — Design Spec

**Data:** 2026-04-18
**Status:** Aprovado para implementação
**Autor:** Matheus Valois (com assistência de Claude)
**Escopo:** Integrar o Sentinela com Stripe para cobrança das assinaturas (Pro, Starter, Enterprise), overage via Meter Events, e self-service via Customer Portal.

**Pré-requisito:** a refatoração de plan-limits (spec `2026-04-17-plan-limits-refactor-design.md`) está completa. As tabelas `subscriptions`, `usage_overage`, `sales.blocked_by_limit` e os TODO(stripe) markers existem e estão prontos.

---

## 1. Contexto e motivação

Hoje o sistema de limites e overage está 100% implementado no backend (fonte de verdade local), mas não há cobrança real — `subscriptions.stripe_customer_id` e `subscriptions.stripe_subscription_id` são NULL, e `usage_overage.reported_to_stripe_at` nunca é populado. Esta fase conecta o sistema com Stripe para:

1. Cobrar o preço mensal base de cada plano pago.
2. Cobrar automaticamente o overage de vendas acima do limite mensal.
3. Permitir que o usuário gerencie sua assinatura (trocar de plano, cancelar, atualizar cartão, ver invoices) via Customer Portal.

### 1.1 Requisitos de negócio

| Item | Valor |
|---|---|
| Planos pagos | Pro, Starter, Enterprise |
| Preço Pro | R$ 59,90 /mês |
| Preço Starter | R$ 119,90 /mês |
| Preço Enterprise | R$ 199,90 /mês |
| Plano Unlimited | **Não disponível para assinatura** — admin-grant somente |
| Plano Free | Entrada permanente, sem trial, sem cartão |
| Métodos de pagamento | Cartão de crédito somente |
| Ciclo de cobrança | Mensal, sem opção anual nesta fase |
| Overage (venda extra aprovada) | Pro: R$ 0,14 / Starter: R$ 0,12 / Enterprise: R$ 0,07 |
| Upgrade mid-cycle | Imediato com proration |
| Downgrade | Agendado pro fim do ciclo atual |
| Retentativas em falha de pagamento | 2 tentativas, depois cancela |

### 1.2 Fora de escopo

- Admin billing UI — admin usa Stripe Dashboard direto.
- Refund model: quando venda approved → refunded depois de meter event reportado, não desfazemos a cobrança (Stripe não tem "undo meter event"). Pra essa fase, refund é tratado manualmente caso necessário.
- Emails customizados (recibo custom, alerta de cartão falhando) — Stripe envia emails padrão.
- Stripe Tax, relatórios de MRR/churn.
- Plano anual/semestral, trials.
- Reativação automática de recursos arquivados após upgrade.

---

## 2. Decisões registradas

| # | Decisão | Racional |
|---|---|---|
| D01 | Escopo A2 | Produtos + Checkout + Webhooks + Overage + Customer Portal. Admin UI fora nesta fase. |
| D02 | Só plano mensal | Simplifica produto. Anual pode ser adicionado depois. |
| D03 | Só cartão de crédito | Cobre ~70% do mercado brasileiro. Pix/Boleto podem entrar se churn justificar. |
| D04 | Sem trial | Free é entrada permanente, zero fricção. |
| D05 | Overage via Stripe Meter Events | API oficial nova, idempotency key nativo, agregação automática no ciclo. |
| D06 | Upgrade imediato com proration; downgrade no fim do ciclo | Padrão SaaS; alinhado com `scheduled_plan_id`/`scheduled_changes_at` já existentes em `subscriptions`. |
| D07 | Stripe Checkout (hosted redirect) | Zero PCI no nosso código, 3DS automático, visual brandable via Dashboard. |
| D08 | Stripe customer lazy (criado no 1º upgrade) | Users Free nunca vão à Stripe. `profiles.cpf`, `email`, `name` populam customer no momento do upgrade. |
| D09 | Customer Portal full access | Stripe handles tudo self-service; nossa UI só redireciona. |
| D10 | Full programmatic setup via script | Produtos/prices/portal configurados via `stripe-sync.ts` idempotente. Test/live parity garantida, source-controlled. |
| D11 | 2 retries then cancel | Configurado no Stripe Dashboard. Default Stripe (4 retries) é excessivo pro nosso caso. |

---

## 3. Mudanças de schema

### 3.1 Novas colunas em `plan_rules`

```sql
ALTER TABLE public.plan_rules
  ADD COLUMN stripe_product_id        text,
  ADD COLUMN stripe_price_id_base     text,
  ADD COLUMN stripe_price_id_metered  text,
  ADD COLUMN stripe_meter_event_name  text;
```

- Todas nullable.
- Populadas pelo `stripe-sync.ts` para os 3 planos pagos (Pro, Starter, Enterprise).
- Free e Unlimited ficam com NULL — indicando "sem produto Stripe associado".

### 3.2 Nova tabela `stripe_webhook_events`

```sql
CREATE TABLE public.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);

CREATE INDEX idx_stripe_webhook_events_type_time
  ON public.stripe_webhook_events(type, processed_at DESC);
```

Propósito: idempotência absoluta. Cada webhook recebido tenta INSERT com `ON CONFLICT (id) DO NOTHING`. Se o evento já foi processado, skip — retornamos 200 sem re-processar.

### 3.3 Migrations

1. `20260419100000_plan_rules_add_stripe_columns.sql`
2. `20260419100001_create_stripe_webhook_events.sql`

Ambas aditivas. Podem rodar em qualquer ordem após as migrations do plan-limits refactor.

---

## 4. Arquitetura — módulo `stripe/`

Todo o código Stripe fica em um módulo dedicado em `packages/backend/src/modules/stripe/`. Nenhum outro módulo importa o SDK `stripe` diretamente — sempre via `StripeService` ou subservice.

### 4.1 Arquivos

```
packages/backend/src/modules/stripe/
├── stripe.module.ts
├── stripe.service.ts                      — thin wrapper sobre o SDK
├── stripe-signature.guard.ts              — verifica assinatura dos webhooks
├── stripe-webhook.controller.ts           — POST /api/stripe/webhook
├── stripe-webhook.service.ts              — idempotência + switch de event types
├── stripe-checkout.controller.ts          — POST /api/stripe/checkout + /portal
├── stripe-checkout.service.ts             — cria Checkout Session + Portal Session
├── stripe-overage.service.ts              — envia meter events
├── stripe-overage-reconciliation.cron.ts  — retry horário para meter events pendentes
└── __tests__/
    ├── stripe-webhook.service.spec.ts
    ├── stripe-checkout.service.spec.ts
    ├── stripe-overage.service.spec.ts
    └── stripe-signature.guard.spec.ts

packages/backend/scripts/
└── stripe-sync.ts                         — setup idempotente de produtos/prices/portal
```

### 4.2 Responsabilidades

| Arquivo | Papel |
|---|---|
| `stripe.service.ts` | `getClient(): Stripe` + helpers baixos (findOrCreateCustomer, resolveUserPlan). Sem lógica de negócio. |
| `stripe-signature.guard.ts` | NestJS guard. Usa `stripe.webhooks.constructEvent` com `STRIPE_WEBHOOK_SECRET`. Anexa evento parsed ao request ou lança 401. |
| `stripe-webhook.controller.ts` | Recebe POST, aplica guard, delega. Sempre retorna 200 (exceto 401 no guard). |
| `stripe-webhook.service.ts` | Idempotência via `stripe_webhook_events`. Switch por `event.type`. Handlers delegam pra `SubscriptionsService` quando necessário. |
| `stripe-checkout.controller.ts` | `POST /api/stripe/checkout` + `POST /api/stripe/portal`. Protegidos por AuthGuard. |
| `stripe-checkout.service.ts` | Cria Checkout Session (com 2 line items: base + metered) ou Portal Session. |
| `stripe-overage.service.ts` | `sendMeterEvent(overageId)` — envia meter event com `identifier=overageId` (idempotente) e atualiza `reported_to_stripe_at`. |
| `stripe-overage-reconciliation.cron.ts` | `@Cron('0 */6 * * *')` — busca overages pendentes (>1h sem reporte) e retenta. |

### 4.3 Mudanças em módulos existentes

| Arquivo | Mudança |
|---|---|
| `SalesService.upsertFromWebhook` | Após `INSERT usage_overage`, dispara `stripeOverage.sendMeterEvent(overageId).catch(logger)` fire-and-forget. |
| `SubscriptionsService.applyPlanChange` | Aceita params opcionais `periodStart, periodEnd`. Quando chamado pelo webhook Stripe, usa datas do evento em vez de `now() + 30d`. |
| `app.module.ts` | Registra `StripeModule`. |
| `main.ts` | Configura `fastify-raw-body` para rota `/api/stripe/webhook` (necessário para signature verification). |

### 4.4 Environment variables

| Var | Onde | Valor |
|---|---|---|
| `STRIPE_SECRET_KEY` | Backend (Render, local) | `sk_live_...` prod / `sk_test_...` outros |
| `STRIPE_WEBHOOK_SECRET` | Backend (Render, local) | `whsec_...` do webhook registrado |
| `FRONTEND_URL` | Backend | `https://app.sentinela.com` (success/cancel URLs do Checkout) |

---

## 5. Setup script — `stripe-sync.ts`

Script idempotente. Roda via `npm run stripe:sync`. Lê `STRIPE_SECRET_KEY` do env para decidir se está em test ou live mode.

### 5.1 Comportamento (por plano pago)

Para cada um de Pro, Starter, Enterprise, na ordem:

1. **Upsert Meter**
   - Nome: `sentinela_approved_sales_{slug}` (pro/starter/ent).
   - Aggregation: `sum` com default value `1` por evento.
   - Se existe: skip. Senão: `stripe.billing.meters.create(...)`.

2. **Upsert Product**
   - Nome: `"Sentinela Pro"` etc.
   - Busca por `metadata.plan_slug == <slug>`. Se existe e nome mudou, update. Senão, create com `metadata: { plan_slug }`.

3. **Upsert Price base**
   - Busca Price ativo com `metadata.plan_slug == <slug>` AND `metadata.type == 'base'`.
   - Se existe e `unit_amount` igual: skip.
   - Se existe mas `unit_amount` diferente: **não edita** (Stripe não permite). Cria novo Price e arquiva o antigo.
   - Se não existe: `prices.create({ product, currency: 'brl', unit_amount: <cents>, recurring: { interval: 'month' }, metadata: { plan_slug, type: 'base' } })`.

4. **Upsert Price metered**
   - Similar ao base, com:
     - `unit_amount: 14` (Pro) / `12` (Starter) / `7` (Enterprise) centavos por evento.
     - `recurring: { interval: 'month', usage_type: 'metered', meter: <meter_id> }`.
     - `billing_scheme: 'per_unit'`.
     - `metadata: { plan_slug, type: 'metered' }`.

5. **UPDATE `plan_rules`** com os 4 IDs + nome do meter event.

### 5.2 Customer Portal configuration

Após processar todos os planos:

```typescript
stripe.billingPortal.configurations.create({
  business_profile: { headline: 'Sentinela Billing' },
  features: {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products: [/* { product: productId, prices: [basePrice, meteredPrice] } para cada plano */],
    },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',
      cancellation_reason: { enabled: true, options: ['too_expensive','missing_features','switched_service','unused','other'] },
    },
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
  },
});
```

Se configuração já existe (busca por `business_profile.headline == 'Sentinela Billing'`), faz `update` em vez de `create`.

### 5.3 Output + checklist

O script finaliza com instruções manuais:

```
Após rodar, no Stripe Dashboard:
  [ ] Settings → Subscriptions → "Manage failed payment retries":
        Number of retries: 2
        After failed payments: Cancel subscription
  [ ] Developers → Webhooks → Add endpoint:
        URL: https://<backend>/api/stripe/webhook
        Events: checkout.session.completed,
                customer.subscription.created,
                customer.subscription.updated,
                customer.subscription.deleted,
                invoice.paid,
                invoice.payment_failed
        Copy signing secret → STRIPE_WEBHOOK_SECRET
  [ ] (Opcional) Branding da Checkout/Portal page
```

---

## 6. Fluxo de Checkout

### 6.1 Endpoint `POST /api/stripe/checkout`

- **Auth:** AuthGuard. Usa `userId` do token.
- **Body:** `{ planId: string }` (UUID em `plan_rules`).
- **Fluxo:**
  1. Validar que plano existe e tem `stripe_price_id_base IS NOT NULL` (senão 400).
  2. Buscar subscription atual do usuário.
  3. Se já tem subscription ativa em plano pago (`stripe_subscription_id IS NOT NULL`), retornar `{ redirectTo: '/api/stripe/portal' }` — upgrade de plano pago se faz via Portal.
  4. Resolver `stripe_customer_id`:
     - Se existe: usar.
     - Senão: `stripe.customers.create({ email: profiles.email, name: profiles.name, metadata: { user_id, cpf: profiles.cpf } })` e `UPDATE subscriptions SET stripe_customer_id = ...`.
  5. Criar Checkout Session:
     ```typescript
     stripe.checkout.sessions.create({
       mode: 'subscription',
       customer: stripe_customer_id,
       payment_method_types: ['card'],
       line_items: [
         { price: plan.stripe_price_id_base, quantity: 1 },
         { price: plan.stripe_price_id_metered },
       ],
       subscription_data: {
         metadata: { user_id, plan_id },
       },
       success_url: `${FRONTEND_URL}/settings?tab=plan&status=success&session_id={CHECKOUT_SESSION_ID}`,
       cancel_url: `${FRONTEND_URL}/settings?tab=plan&status=cancel`,
       locale: 'pt-BR',
     });
     ```
  6. Retornar `{ url: session.url }`.

### 6.2 Endpoint `POST /api/stripe/portal`

- **Auth:** AuthGuard.
- **Body:** vazio.
- **Fluxo:**
  1. Buscar `stripe_customer_id` do usuário. Se NULL: 400 "Nenhuma assinatura Stripe ativa".
  2. `stripe.billingPortal.sessions.create({ customer: stripe_customer_id, return_url: '${FRONTEND_URL}/settings?tab=plan', locale: 'pt-BR' })`.
  3. Retornar `{ url: session.url }`.

### 6.3 Frontend — Settings > aba Plano

**Backend:** o endpoint `GET /api/plan-limits/usage` já existente é **estendido** para incluir campos de subscription status. A resposta `UsageSnapshot` ganha um campo novo:

```typescript
subscription: {
  status: 'active' | 'past_due' | 'canceled' | null;   // null se não tem stripe_subscription_id
  next_billing_date: string | null;                    // subscriptions.current_period_end
  cancel_at_period_end: boolean;
  scheduled_plan: { slug: string; changes_at: string } | null; // só se scheduled_plan_id preenchido
  has_stripe_customer: boolean;                        // subscriptions.stripe_customer_id IS NOT NULL
};
```

Essa info é lida pelo `usePlanUsage` no frontend (nenhum hook novo necessário).

Estado renderizado por cenário:

| Cenário | UI |
|---|---|
| Plano Free | Card "Plano atual: Free". 3 cards Pro/Starter/Enterprise com preço + botão "Fazer upgrade" → chama `/checkout`, redireciona. |
| Plano pago ativo | Card "Plano atual: {plan} — R$ X/mês. Próxima cobrança: {date}". Botão "Gerenciar assinatura" → `/portal`, redireciona. |
| Plano pago + `cancel_at_period_end=true` | Aviso amber: "Assinatura cancelada. Vai virar Free em {date}." Botão "Reativar" → `/portal`. |
| Plano pago + `scheduled_plan_id` preenchido | Aviso: "Seu plano vira {scheduled} em {date}." Botão "Gerenciar" → `/portal`. |
| Plano Unlimited (admin-grant) | Card estático "Plano Unlimited — gerenciado pelo suporte. [entre em contato]". |

### 6.4 Retorno do Checkout

Ao voltar pra `/settings?tab=plan&status=success&session_id=cs_xxx`:

- Toast informativo: "Pagamento confirmado, atualizando assinatura…".
- Força `queryClient.invalidateQueries(['plan-usage', 'subscription-status'])` repetidamente com backoff (até 3 tentativas em 2/4/6 segundos) ou até `stripe_subscription_id` aparecer populado.
- Ao confirmar, toast "Plano {X} ativado".

Em `/settings?tab=plan&status=cancel`:

- Toast discreto: "Checkout cancelado, nenhuma cobrança realizada".

---

## 7. Fluxo de webhook

### 7.1 Endpoint `POST /api/stripe/webhook`

- Fastify `rawBody` habilitado pra essa rota via `fastify-raw-body`.
- Sem auth padrão (AuthGuard removido). Proteção: `StripeSignatureGuard`.

### 7.2 `StripeSignatureGuard`

```typescript
canActivate(ctx: ExecutionContext): boolean {
  const req = ctx.switchToHttp().getRequest();
  const signature = req.headers['stripe-signature'];
  const rawBody = req.rawBody;
  if (!signature || !rawBody) throw new UnauthorizedException('Missing signature');
  try {
    req.stripeEvent = this.stripe.webhooks.constructEvent(
      rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!,
    );
    return true;
  } catch {
    throw new UnauthorizedException('Invalid signature');
  }
}
```

### 7.3 Handler flow

```
POST /api/stripe/webhook
  ├─ Guard valida signature → injeta req.stripeEvent (Stripe.Event)
  │
  └─ StripeWebhookController.handle(req):
     ├─ Idempotência:
     │   INSERT INTO stripe_webhook_events (id, type, data)
     │   VALUES (event.id, event.type, event.data)
     │   ON CONFLICT (id) DO NOTHING;
     │   
     │   Se nenhuma row foi inserida (conflito), retorna 200 sem fazer nada.
     │
     ├─ Switch por event.type (StripeWebhookService.handle<Event>):
     │   - 'checkout.session.completed'    → handleCheckoutCompleted
     │   - 'customer.subscription.created' → handleSubscriptionCreated
     │   - 'customer.subscription.updated' → handleSubscriptionUpdated
     │   - 'customer.subscription.deleted' → handleSubscriptionDeleted
     │   - 'invoice.paid'                  → handleInvoicePaid
     │   - 'invoice.payment_failed'        → handlePaymentFailed
     │   - default                         → log e ignora
     │
     └─ Retornar 200 sempre que não for erro explícito.
```

### 7.4 Handlers detalhados

#### `checkout.session.completed`

- Informativo. Ativação real acontece em `customer.subscription.created`.
- Apenas log.

#### `customer.subscription.created`

1. Extrair `userId` de `subscription.metadata.user_id` e `planId` de `subscription.metadata.plan_id`.
2. Atualizar `subscriptions.stripe_subscription_id = subscription.id` e `stripe_customer_id = subscription.customer`.
3. Chamar `SubscriptionsService.applyPlanChange(userId, planId, { periodStart: new Date(subscription.current_period_start * 1000), periodEnd: new Date(subscription.current_period_end * 1000) })`.

#### `customer.subscription.updated`

Precisa interpretar o tipo de update:

| Tipo | Detecção | Ação |
|---|---|---|
| Cancelamento agendado | `cancel_at_period_end` virou `true` | `UPDATE subscriptions SET cancel_at_period_end = true`. Sem `applyPlanChange`. |
| Reativação | `cancel_at_period_end` virou `false` | `UPDATE subscriptions SET cancel_at_period_end = false`. |
| Troca de plano imediata (upgrade) | Current price != nosso `subscriptions.plan_id → stripe_price_id_base` | Resolver novo `plan_id` via lookup reverso (price → plan_rules). Chamar `applyPlanChange(userId, newPlanId, { periodStart, periodEnd })`. |
| Downgrade agendado | `pending_update` ou schedule info presente no evento | Resolver `scheduled_plan_id` e grava + `scheduled_changes_at`. Sem `applyPlanChange` agora. |
| Aplicação de downgrade agendado | Novos `current_period_start/end` + price do item mudou E tínhamos `scheduled_plan_id` preenchido | `applyPlanChange(userId, scheduled_plan_id, { periodStart, periodEnd })` e zera `scheduled_*`. |

Resolver `plan_id` a partir de `price_id`: query `SELECT id FROM plan_rules WHERE stripe_price_id_base = $1`.

Se o evento não encaixar em nenhuma categoria (ex: mudança de quantidade, metadata, etc.) — apenas log e retorna 200.

#### `customer.subscription.deleted`

1. Buscar user via `stripe_customer_id`.
2. Buscar ID do plano Free via `SELECT id FROM plan_rules WHERE plan = 'free'`.
3. Chamar `applyPlanChange(userId, freePlanId, { periodStart: now, periodEnd: now + 30d })`. Auto-trim roda.
4. `UPDATE subscriptions SET stripe_subscription_id = NULL, cancel_at_period_end = false`.

#### `invoice.paid`

- Apenas log. Subscription já estava ativa.
- Útil futuramente para registrar "último pagamento" e enviar email custom.

#### `invoice.payment_failed`

- Apenas log no Discord com `{ type: 'payment_failed', userId, invoiceId, amount, attemptCount: invoice.attempt_count }`.
- Sem ação destrutiva — Stripe gerencia retries (configurado para 2, depois cancela). Quando cancelar, `customer.subscription.deleted` entra.

### 7.5 Idempotência (defesa em múltiplas camadas)

| Camada | Mecanismo |
|---|---|
| Stripe event ID | `stripe_webhook_events.id` PRIMARY KEY — INSERT ON CONFLICT DO NOTHING |
| `applyPlanChange` | Natural idempotência — aplicar o mesmo plano 2x é no-op |
| `usage_overage` | `UNIQUE INDEX uq_usage_overage_sale` — venda nunca gera 2 rows de overage |
| Meter event | `identifier = overageId` no payload do Meter Event — Stripe dedupa |

---

## 8. Overage via Meter Events

### 8.1 Fluxo sincrono (hot path)

Em `SalesService.upsertFromWebhook`, **após** `INSERT usage_overage`:

```typescript
// Fire-and-forget — não bloqueia webhook de venda
this.stripeOverage
  .sendMeterEvent({ overageId: overageRow.id })
  .catch((err) => this.logger.warn(
    `Meter event delivery failed for overage ${overageRow.id}: ${err.message}. ` +
    `Reconciliation will retry.`
  ));
```

### 8.2 `StripeOverageService.sendMeterEvent`

```typescript
async sendMeterEvent(params: { overageId: string }): Promise<void> {
  const client = this.supabase.getClient();

  // 1. Load overage + user + plan data
  const { data: ctx } = await client
    .from('usage_overage')
    .select(`
      id, user_id, sale_id, price_cents,
      subscription:subscriptions!inner(stripe_customer_id),
      user:profiles!inner(plan:plan_rules!inner(stripe_meter_event_name))
    `)
    .eq('id', params.overageId)
    .maybeSingle();

  if (!ctx) throw new Error(`Overage ${params.overageId} not found`);
  if (!ctx.subscription.stripe_customer_id) {
    throw new Error(`No stripe_customer_id for user ${ctx.user_id}`);
  }
  if (!ctx.user.plan.stripe_meter_event_name) {
    throw new Error(`No meter event name for user's plan`);
  }

  // 2. Send Meter Event
  await this.stripe.getClient().v1.billing.meterEvents.create({
    event_name: ctx.user.plan.stripe_meter_event_name,
    identifier: params.overageId,  // idempotency key
    timestamp: Math.floor(Date.now() / 1000),
    payload: {
      value: '1',
      stripe_customer_id: ctx.subscription.stripe_customer_id,
    },
  });

  // 3. Mark reported
  await client.from('usage_overage').update({
    reported_to_stripe_at: new Date().toISOString(),
    stripe_usage_record_id: params.overageId,
  }).eq('id', params.overageId);
}
```

### 8.3 Reconciliation cron

```typescript
@Injectable()
export class StripeOverageReconciliationCron {
  @Cron('0 */6 * * *')  // a cada 6h
  async retryPendingMeterEvents() {
    const { data: pending } = await this.supabase.getClient()
      .from('usage_overage')
      .select('id')
      .is('reported_to_stripe_at', null)
      .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(500);

    for (const row of pending ?? []) {
      try {
        await this.stripeOverage.sendMeterEvent({ overageId: row.id });
      } catch (err) {
        this.logger.warn(`Retry failed for overage ${row.id}: ${err.message}`);
      }
    }

    if ((pending?.length ?? 0) > 100) {
      await this.discord.logApiError({
        endpoint: 'overage-reconciliation',
        error: `High pending count: ${pending?.length} overage events unreported`,
      } as any);
    }
  }
}
```

### 8.4 Edge cases

| Cenário | Tratamento |
|---|---|
| Venda inserida, overage criado, process morre antes do meter event | Linha fica `reported_to_stripe_at IS NULL`. Cron pega em até 6h. |
| Free com overage (não deveria acontecer) | `sendMeterEvent` lança (sem `stripe_customer_id`). Log alto. |
| Meter event fora do prazo de 24h após fim do ciclo | Stripe ignora. Aceitável dado cron de 6h. |
| Refund de venda já reportada | Meter event permanece → user é cobrado. Tratamento de refund fora de escopo; ver §1.2. |

---

## 9. Testing strategy

### 9.1 Unit tests (todos com Stripe mockado)

- `stripe-signature.guard.spec.ts`: rejeita signature inválida, aceita válida (mocka `stripe.webhooks.constructEvent`).
- `stripe-webhook.service.spec.ts`: pra cada event type, mocka `event.data.object` e verifica delegações corretas.
- `stripe-checkout.service.spec.ts`: verifica line_items, customer resolution, success/cancel URLs.
- `stripe-overage.service.spec.ts`: verifica payload do meter event, atualização de `reported_to_stripe_at`.
- `stripe-overage-reconciliation.cron.spec.ts`: mocka Supabase com N pending rows, verifica N calls a `sendMeterEvent`.

### 9.2 Integration tests (smoke test manual em test mode)

Rodados após `stripe-sync.ts` provisionar produtos em test mode. Fluxos:

1. **Upgrade Free → Pro**: clica "Upgrade Pro" → Stripe Checkout → paga com card `4242 4242 4242 4242` → webhook dispara → `subscription` populada → `usePlanUsage` reflete Pro.
2. **Change plan Pro → Starter (via Portal)**: user vai no Portal, troca → Stripe aplica proration imediatamente → webhook → `applyPlanChange` roda → plan reflete Starter.
3. **Cancelamento**: Portal → Cancel → `cancel_at_period_end=true` no webhook → UI mostra aviso. Avanço de tempo no Stripe Dashboard → `subscription.deleted` → `applyPlanChange` pra Free + auto-trim.
4. **Overage**: user Pro, simular 1001 vendas aprovadas via webhook de checkout → ver 1 row em `usage_overage` com `reported_to_stripe_at` populado → conferir meter event recebido no Stripe Dashboard → fim do ciclo invoice inclui base + overage.
5. **Payment fail**: usar card `4000 0000 0000 0341` (attach-ok, charge-fail) → `invoice.payment_failed` disparado → 2 retries ao longo de 10 dias → na 3ª falha `subscription.deleted` → user vira Free.

### 9.3 CI

- Unit tests só. Zero calls reais à Stripe em CI.

---

## 10. Rollout

### Fase A — Implementação (sem Stripe real)
- Migrations aditivas.
- Módulo `stripe/` completo com tests unitários.
- Mudanças em `SalesService`, `SubscriptionsService`.
- Script `stripe-sync.ts`.
- Frontend: botões upgrade, "Gerenciar assinatura".
- Docs.
- Build + tests passam.

### Fase B — Smoke test em test mode
- User fornece `sk_test_...`.
- Roda `npm run stripe:sync` em test mode.
- Registra webhook via Stripe CLI, roda os 5 fluxos de integration test.
- Ajustes se necessário.

### Fase C — Produção
- Merge em `main`.
- Deploy backend (Render) + frontend (Vercel).
- User configura conta live (KYC, banco).
- User fornece `sk_live_...` e whsec de live.
- Roda `stripe-sync` em live mode. Registra webhook em live.
- Dashboard manual: 2 retries + cancel, branding opcional.
- Soft launch com usuário de teste antes de liberar pra todos.

---

## 11. Segurança

- `STRIPE_SECRET_KEY` nunca no frontend nem logs. Só em env vars de backend.
- `StripeSignatureGuard` bloqueia qualquer webhook sem assinatura válida.
- Idempotência via `stripe_webhook_events` previne replay.
- `/checkout` e `/portal` exigem AuthGuard — usuário só cria sessão pra si.
- `subscription.metadata.user_id` verificado contra o cliente (user_id do auth token precisa bater com o metadata) — defesa em profundidade no handler.

---

## 12. Observabilidade

### Discord logs
- `stripe_webhook_received` (sucesso) — event type, id, user_id.
- `stripe_webhook_failed` — erro, severity alta.
- `meter_event_sent_ok` / `meter_event_send_failed` / `meter_event_reconciled`.
- `stripe_subscription_canceled` — user volta pro Free.
- `payment_failed` — user + amount + attempt.

### Alertas (Discord)
- `count(stripe_webhook_events WHERE type = 'invoice.payment_failed' AND processed_at > now() - 1 day)` > 5 — churn spike.
- Reconciliation cron: se >100 overages pendentes, alerta alto.

---

## 13. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Webhook chega antes do `applyPlanChange` conseguir rodar (DB momentaneamente off) | Stripe retenta até 3 dias; `applyPlanChange` é idempotente. |
| Meter event cai em momento de alta venda | Fire-and-forget + cron de 6h + Stripe aceita até 24h após fim do ciclo. |
| User cancela e tenta reativar no mesmo dia (edge case) | Portal lida com isso nativamente. `cancel_at_period_end=false` pelo webhook `updated`. |
| Webhook duplicado (network retry) | `stripe_webhook_events` PRIMARY KEY garante processamento único. |
| Prices de `plan_rules` desynced com Stripe (ex: ambiente test vs live) | `stripe-sync` idempotente força parity. Admin roda sempre que houver mudança. |
| User faz upgrade imediato mas backend não conseguiu atualizar `subscriptions` | Stripe re-dispara `customer.subscription.created` nas retentativas. Idempotência em `stripe_webhook_events` + idempotência em `applyPlanChange`. |
| Stripe API retorna 500 no `checkout.sessions.create` | Endpoint retorna 500, frontend mostra erro, user tenta de novo. |
