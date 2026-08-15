# Self-serve billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer cancelamento de assinatura e adição de cartão pra dentro do app (sem redirect pra Stripe), e mudar o modelo de cobrança no upgrade de proration pra diferença cheia entre planos.

**Architecture:** Backend NestJS continua sendo o orquestrador da Stripe. Frontend ganha Stripe Elements (PaymentElement) pra coletar cartões via SetupIntent. Upgrade passa a cobrar `(targetPrice - currentPrice)` via invoice avulsa antes de trocar a subscription (`proration_behavior: 'none'`). Customer Portal continua disponível como fallback, mas não é o caminho principal pras operações cobertas aqui.

**Tech Stack:** NestJS 10 + Fastify + Stripe Node SDK; React 18 + Vite + TanStack Query + `@stripe/stripe-js` + `@stripe/react-stripe-js`; Jest (backend) + Vitest (frontend); Stripe webhooks já configurados.

**Spec:** `docs/superpowers/specs/2026-05-08-self-serve-billing-design.md`

---

## File Structure

### Backend — modificados

| Arquivo | O que muda |
|---|---|
| `packages/backend/src/modules/stripe/stripe-checkout.service.ts` | `previewPlanChange` retorna novo DTO; `changeExistingPlan` reescrito (cobra→troca em upgrade, `proration_behavior: 'none'` em downgrade); novo método `cancelSubscription`. |
| `packages/backend/src/modules/stripe/stripe-checkout.controller.ts` | Novo endpoint `POST /cancel`. |
| `packages/backend/src/modules/stripe/stripe-billing.service.ts` | Novos métodos `createSetupIntent` e `attachPaymentMethod`. Remove `createUpdatePaymentMethodPortalSession`. |
| `packages/backend/src/modules/stripe/stripe-billing.controller.ts` | Novos endpoints `POST /setup-intent` e `POST /payment-methods/attach`. Remove `POST /payment-methods/setup-portal`. |
| `packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts` | Testes pros novos comportamentos. |

### Backend — criados

| Arquivo | Responsabilidade |
|---|---|
| `packages/backend/src/modules/stripe/__tests__/stripe-billing.service.spec.ts` | Testes do `StripeBillingService` (não existe ainda). |

### Frontend — criados

| Arquivo | Responsabilidade |
|---|---|
| `packages/frontend/src/lib/stripe.ts` | Singleton `getStripePromise()` com `loadStripe` lazy + leitura da env. |
| `packages/frontend/src/components/PlanTab/AddCardDialog.tsx` | Modal com `<Elements>` + `PaymentElement` + submit (`confirmSetup` → `attach`). |
| `packages/frontend/src/components/PlanTab/CancelSubscriptionDialog.tsx` | `AlertDialog` de confirmação de cancelamento. |
| `packages/frontend/src/hooks/useStripeSetupIntent.ts` | Mutation `POST /stripe/setup-intent`. |
| `packages/frontend/src/hooks/useAttachPaymentMethod.ts` | Mutation `POST /stripe/payment-methods/attach`. |
| `packages/frontend/src/hooks/useStripeCancel.ts` | Mutation `POST /stripe/cancel`. |
| `packages/frontend/src/components/PlanTab/__tests__/AddCardDialog.test.tsx` | Testes do dialog. |
| `packages/frontend/src/components/PlanTab/__tests__/CancelSubscriptionDialog.test.tsx` | Testes do dialog. |
| `packages/frontend/src/components/PlanTab/__tests__/PlanSwitchDialog.test.tsx` | Testes da nova copy/DTO. |

### Frontend — modificados

| Arquivo | O que muda |
|---|---|
| `packages/frontend/package.json` | Adiciona `@stripe/stripe-js` e `@stripe/react-stripe-js`. |
| `packages/frontend/.env.example` | Documenta `VITE_STRIPE_PUBLISHABLE_KEY`. |
| `packages/frontend/vite.config.ts` | Adiciona `stripe-js` no `manualChunks`. |
| `packages/frontend/src/hooks/useStripeBilling.ts` | Remove `useAddPaymentMethod` (popup). |
| `packages/frontend/src/components/PlanTab/PaymentMethodsCard.tsx` | "Adicionar cartão" abre `AddCardDialog` em vez de chamar mutation legada. |
| `packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx` | Adiciona botão "Cancelar assinatura" + `CancelSubscriptionDialog`. |
| `packages/frontend/src/components/PlanTab/PlanSwitchDialog.tsx` | Novo DTO `PlanChangePreview`; copy reescrita pra "Diferença a pagar agora" / "Vai virar plano X em DD/MM". |

### Docs — modificados

| Arquivo | O que muda |
|---|---|
| `docs/features/11-plans-and-limits/stripe-integration.md` | Reescrever 2.3, 5.1, 5.3, 6, RN-06, 11. Detalhes na Task 17. |
| `docs/features/11-plans-and-limits/subscriptions.md` | Atualizar cancelamento se descrever passagem pelo Portal. |

---

## Conventions usadas neste plano

- **Backend tests:** Jest. Mock do Stripe SDK via factory inline (padrão já em `stripe-checkout.service.spec.ts`). Sem chamadas de rede.
- **Frontend tests:** Vitest + Testing Library. Mock de hooks via `vi.mock(...)`. Mock do Stripe.js via stub que resolve `confirmSetup` com payload fake.
- **Commits:** Convencional commits (`feat`, `fix`, `refactor`, `test`, `docs`). Co-author do Claude no rodapé conforme `CLAUDE.md`.
- **Build/lint check antes de cada commit:** `npm run lint` na raiz do monorepo (Turborepo roda em paralelo). Os testes rodam por workspace (`npm run test --workspace=@sentinel/backend` ou `--workspace=@sentinel/frontend`).
- **Idempotency keys** em chamadas mutativas Stripe: o SDK aceita `{ idempotencyKey }` como segundo argumento.

---

## Task 1: Backend — `cancelSubscription` service + endpoint

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-checkout.service.ts`
- Modify: `packages/backend/src/modules/stripe/stripe-checkout.controller.ts`
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts`

- [ ] **Step 1: Write failing test for `cancelSubscription` happy path**

Em `packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts`, adiciona ao final do arquivo:

```ts
describe('cancelSubscription', () => {
  let subscriptionsUpdate: jest.Mock;
  let subscriptionsRetrieve: jest.Mock;

  beforeEach(() => {
    subscriptionsUpdate = jest.fn();
    subscriptionsRetrieve = jest.fn();
    stripeMock.getClient = () => ({
      customers: { create: customersCreate },
      checkout: { sessions: { create: sessionsCreate } },
      subscriptions: { update: subscriptionsUpdate, retrieve: subscriptionsRetrieve },
    });
  });

  it('marks cancel_at_period_end=true and returns ends_at', async () => {
    supabaseMock.getClient().from = jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: {
          stripe_subscription_id: 'sub_123',
          cancel_at_period_end: false,
          plan_rules: { plan: 'pro' },
        },
        error: null,
      })})}),
    }));
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_123',
      cancel_at_period_end: false,
      current_period_end: 1714300000,
    });
    subscriptionsUpdate.mockResolvedValue({
      id: 'sub_123',
      cancel_at_period_end: true,
      current_period_end: 1714300000,
    });

    const result = await service.cancelSubscription('user-1');

    expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_123', { cancel_at_period_end: true });
    expect(result).toEqual({
      canceled_at: expect.any(String),
      ends_at: new Date(1714300000 * 1000).toISOString(),
      already_scheduled: false,
    });
  });

  it('is idempotent when already scheduled', async () => {
    supabaseMock.getClient().from = jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: {
          stripe_subscription_id: 'sub_123',
          cancel_at_period_end: true,
          plan_rules: { plan: 'pro' },
        },
        error: null,
      })})}),
    }));
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_123',
      cancel_at_period_end: true,
      current_period_end: 1714300000,
    });

    const result = await service.cancelSubscription('user-1');

    expect(subscriptionsUpdate).not.toHaveBeenCalled();
    expect(result.already_scheduled).toBe(true);
  });

  it('rejects user without subscription', async () => {
    supabaseMock.getClient().from = jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { stripe_subscription_id: null, cancel_at_period_end: false, plan_rules: { plan: 'free' } },
        error: null,
      })})}),
    }));

    await expect(service.cancelSubscription('user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects unlimited plan', async () => {
    supabaseMock.getClient().from = jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: {
          stripe_subscription_id: 'sub_123',
          cancel_at_period_end: false,
          plan_rules: { plan: 'unlimited' },
        },
        error: null,
      })})}),
    }));

    await expect(service.cancelSubscription('user-1')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx jest stripe-checkout.service.spec.ts -t cancelSubscription
```

Expected: FAIL — "service.cancelSubscription is not a function".

- [ ] **Step 3: Implement `cancelSubscription` in service**

No final de `packages/backend/src/modules/stripe/stripe-checkout.service.ts`, adiciona método dentro da classe:

```ts
async cancelSubscription(userId: string): Promise<{
  canceled_at: string;
  ends_at: string;
  already_scheduled: boolean;
}> {
  const { data: sub, error } = await this.supabase.getClient()
    .from('subscriptions')
    .select('stripe_subscription_id, cancel_at_period_end, plan_rules:plan_id(plan)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!sub?.stripe_subscription_id) {
    throw new BadRequestException('Nenhuma assinatura Stripe ativa');
  }
  const planSlug = (sub.plan_rules as { plan?: string } | null)?.plan ?? '';
  if (planSlug === 'unlimited') {
    throw new BadRequestException('Plano Unlimited é gerenciado pelo suporte');
  }

  const stripe = this.stripe.getClient();
  const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  const endsAtIso = new Date(current.current_period_end * 1000).toISOString();
  const nowIso = new Date().toISOString();

  if (current.cancel_at_period_end) {
    return { canceled_at: nowIso, ends_at: endsAtIso, already_scheduled: true };
  }

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    cancel_at_period_end: true,
  });
  this.logger.log(`Scheduled cancel for subscription ${sub.stripe_subscription_id} (user ${userId})`);

  return { canceled_at: nowIso, ends_at: endsAtIso, already_scheduled: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx jest stripe-checkout.service.spec.ts -t cancelSubscription
```

Expected: 4 tests pass.

- [ ] **Step 5: Add controller endpoint**

Em `packages/backend/src/modules/stripe/stripe-checkout.controller.ts`, adiciona dentro da classe (depois de `reactivate`):

```ts
@Post('cancel')
async cancel(@CurrentUser('id') userId: string) {
  return this.checkout.cancelSubscription(userId);
}
```

- [ ] **Step 6: Run full backend test suite**

```bash
cd packages/backend && npm run test
```

Expected: PASS, sem regressões.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "$(cat <<'EOF'
feat(stripe): add in-app subscription cancellation

POST /stripe/cancel marca cancel_at_period_end=true. Idempotente quando
o cancelamento já está agendado. Rejeita Unlimited e users sem sub.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — `previewPlanChange` retorna novo DTO

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-checkout.service.ts:11-18` (DTO export)
- Modify: `packages/backend/src/modules/stripe/stripe-checkout.service.ts:133-203` (método inteiro)
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts`

- [ ] **Step 1: Write failing tests pra classificação upgrade/downgrade/same**

Adiciona ao arquivo de teste:

```ts
describe('previewPlanChange (new DTO)', () => {
  let pricesRetrieve: jest.Mock;
  let subscriptionsRetrieve: jest.Mock;

  beforeEach(() => {
    pricesRetrieve = jest.fn();
    subscriptionsRetrieve = jest.fn();
    stripeMock.getClient = () => ({
      prices: { retrieve: pricesRetrieve },
      subscriptions: { retrieve: subscriptionsRetrieve },
    });
  });

  function mockSubscriptionAndPlanLookups(opts: {
    targetSlug: string;
    targetPriceBase: string;
    currentPriceBase: string;
    currentSlug: string;
    currentPeriodEnd: number;
  }) {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: {
            id: 'plan-target',
            plan: opts.targetSlug,
            stripe_price_id_base: opts.targetPriceBase,
            stripe_price_id_metered: 'price_metered_target',
          },
          error: null,
        })})})};
      }
      if (table === 'subscriptions') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: {
            plan_id: 'plan-current',
            stripe_customer_id: 'cus_1',
            stripe_subscription_id: 'sub_1',
            plan_rules: { plan: opts.currentSlug, stripe_price_id_base: opts.currentPriceBase },
          },
          error: null,
        })})})};
      }
      return {};
    });
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      current_period_end: opts.currentPeriodEnd,
      currency: 'brl',
    });
  }

  it('classifies upgrade and computes diff cheio', async () => {
    mockSubscriptionAndPlanLookups({
      targetSlug: 'starter',
      targetPriceBase: 'price_starter',
      currentSlug: 'pro',
      currentPriceBase: 'price_pro',
      currentPeriodEnd: 1714300000,
    });
    pricesRetrieve.mockImplementation(async (id: string) => {
      if (id === 'price_starter') return { id, unit_amount: 11990, currency: 'brl' };
      if (id === 'price_pro')     return { id, unit_amount: 5990,  currency: 'brl' };
      throw new Error(`unexpected price ${id}`);
    });

    const result = await service.previewPlanChange('user-1', 'plan-target');

    expect(result).toEqual({
      kind: 'upgrade',
      currentPlan: 'pro',
      targetPlan: 'starter',
      chargeNowCents: 6000,
      nextChargeCents: 11990,
      effectiveDate: new Date(1714300000 * 1000).toISOString(),
      currency: 'brl',
    });
  });

  it('classifies downgrade with chargeNowCents=0', async () => {
    mockSubscriptionAndPlanLookups({
      targetSlug: 'pro',
      targetPriceBase: 'price_pro',
      currentSlug: 'starter',
      currentPriceBase: 'price_starter',
      currentPeriodEnd: 1714300000,
    });
    pricesRetrieve.mockImplementation(async (id: string) => {
      if (id === 'price_starter') return { id, unit_amount: 11990, currency: 'brl' };
      if (id === 'price_pro')     return { id, unit_amount: 5990,  currency: 'brl' };
      throw new Error(`unexpected price ${id}`);
    });

    const result = await service.previewPlanChange('user-1', 'plan-target');

    expect(result.kind).toBe('downgrade');
    expect(result.chargeNowCents).toBe(0);
    expect(result.nextChargeCents).toBe(5990);
  });

  it('rejects same plan', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: 'plan-same', plan: 'pro', stripe_price_id_base: 'price_pro', stripe_price_id_metered: 'pm' },
          error: null,
        })})})};
      }
      if (table === 'subscriptions') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { plan_id: 'plan-same', stripe_customer_id: 'cus', stripe_subscription_id: 'sub',
                  plan_rules: { plan: 'pro', stripe_price_id_base: 'price_pro' } },
          error: null,
        })})})};
      }
      return {};
    });

    await expect(service.previewPlanChange('user-1', 'plan-same'))
      .rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx jest stripe-checkout.service.spec.ts -t "previewPlanChange (new DTO)"
```

Expected: FAIL — DTO não bate com o atual (`prorationCents`).

- [ ] **Step 3: Atualiza tipo `PlanChangePreview`**

Em `packages/backend/src/modules/stripe/stripe-checkout.service.ts`, substitui a definição de `PlanChangePreview` (linhas ~11-18):

```ts
export type PlanChangePreview = {
  kind: 'upgrade' | 'downgrade' | 'same';
  currentPlan: string;
  targetPlan: string;
  chargeNowCents: number;
  nextChargeCents: number;
  effectiveDate: string;
  currency: string;
};
```

- [ ] **Step 4: Reescreve `previewPlanChange`**

Substitui o método inteiro (linhas ~133-203):

```ts
async previewPlanChange(userId: string, planId: string): Promise<PlanChangePreview> {
  const client = this.supabase.getClient();

  const { data: target, error: targetErr } = await client
    .from('plan_rules')
    .select('id, plan, stripe_price_id_base, stripe_price_id_metered')
    .eq('id', planId)
    .maybeSingle();
  if (targetErr) throw targetErr;
  if (!target) throw new BadRequestException('Plan not found');
  if (!target.stripe_price_id_base || !target.stripe_price_id_metered) {
    throw new BadRequestException(`Plan ${target.plan} is not available for subscription`);
  }

  const { data: sub, error: subErr } = await client
    .from('subscriptions')
    .select('plan_id, stripe_customer_id, stripe_subscription_id, plan_rules:plan_id(plan, stripe_price_id_base)')
    .eq('user_id', userId)
    .maybeSingle();
  if (subErr) throw subErr;
  if (!sub?.stripe_subscription_id || !sub.stripe_customer_id) {
    throw new BadRequestException('Sem assinatura Stripe ativa');
  }
  if (sub.plan_id === target.id) {
    throw new BadRequestException('Você já está neste plano');
  }
  const currentRule = sub.plan_rules as { plan: string; stripe_price_id_base: string } | null;
  if (!currentRule?.stripe_price_id_base) {
    throw new BadRequestException('Plano atual sem price ID configurado');
  }

  const stripe = this.stripe.getClient();
  const [targetPrice, currentPrice, current] = await Promise.all([
    stripe.prices.retrieve(target.stripe_price_id_base),
    stripe.prices.retrieve(currentRule.stripe_price_id_base),
    stripe.subscriptions.retrieve(sub.stripe_subscription_id),
  ]);

  const targetUnit = targetPrice.unit_amount ?? 0;
  const currentUnit = currentPrice.unit_amount ?? 0;
  const diff = targetUnit - currentUnit;

  const kind: PlanChangePreview['kind'] =
    diff > 0 ? 'upgrade' : diff < 0 ? 'downgrade' : 'same';

  return {
    kind,
    currentPlan: currentRule.plan,
    targetPlan: target.plan,
    chargeNowCents: kind === 'upgrade' ? diff : 0,
    nextChargeCents: targetUnit,
    effectiveDate: new Date(current.current_period_end * 1000).toISOString(),
    currency: targetPrice.currency ?? 'brl',
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/backend && npx jest stripe-checkout.service.spec.ts -t "previewPlanChange (new DTO)"
```

Expected: 3 tests pass.

- [ ] **Step 6: Run full suite — checa que testes legados quebraram**

```bash
cd packages/backend && npm run test
```

Expected: testes legados de `previewPlanChange` que afirmavam `prorationCents` falham. **Esperado** — vamos remover esses testes legados.

- [ ] **Step 7: Remove ou ajusta testes legados de `previewPlanChange`**

No mesmo arquivo, encontra blocos `describe('previewPlanChange', ...)` antigos (não o novo) e remove. Se estiverem fundidos com o novo, substitui pelo novo bloco.

- [ ] **Step 8: Run full suite again**

```bash
cd packages/backend && npm run test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "$(cat <<'EOF'
refactor(stripe): previewPlanChange retorna kind/chargeNow/nextCharge

Novo DTO classifica upgrade/downgrade/same comparando unit_amount dos
prices base e expõe a cobrança imediata e próxima fatura no formato
direto que o frontend precisa.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend — `changeExistingPlan` reescrito (upgrade path)

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-checkout.service.ts:205-238` (método inteiro)
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts`

- [ ] **Step 1: Write failing test — upgrade ordem cobra → troca**

Adiciona no spec:

```ts
describe('changeExistingPlan (upgrade)', () => {
  let invoiceItemsCreate: jest.Mock;
  let invoiceItemsDelete: jest.Mock;
  let invoicesCreate: jest.Mock;
  let invoicesFinalize: jest.Mock;
  let invoicesPay: jest.Mock;
  let subscriptionsRetrieve: jest.Mock;
  let subscriptionsUpdate: jest.Mock;
  let pricesRetrieve: jest.Mock;
  let customersRetrieve: jest.Mock;

  beforeEach(() => {
    invoiceItemsCreate = jest.fn();
    invoiceItemsDelete = jest.fn();
    invoicesCreate = jest.fn();
    invoicesFinalize = jest.fn();
    invoicesPay = jest.fn();
    subscriptionsRetrieve = jest.fn();
    subscriptionsUpdate = jest.fn();
    pricesRetrieve = jest.fn();
    customersRetrieve = jest.fn();
    stripeMock.getClient = () => ({
      customers: { create: customersCreate, retrieve: customersRetrieve },
      checkout: { sessions: { create: sessionsCreate } },
      invoiceItems: { create: invoiceItemsCreate, del: invoiceItemsDelete },
      invoices: {
        create: invoicesCreate,
        finalizeInvoice: invoicesFinalize,
        pay: invoicesPay,
      },
      subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
      prices: { retrieve: pricesRetrieve },
    });
  });

  function mockUpgradeContext() {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: {
            id: 'plan-starter',
            plan: 'starter',
            stripe_price_id_base: 'price_starter_base',
            stripe_price_id_metered: 'price_starter_metered',
          },
          error: null,
        })})})};
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: 'sub-row',
              plan_id: 'plan-pro',
              stripe_customer_id: 'cus_1',
              stripe_subscription_id: 'sub_1',
              plan_rules: { plan: 'pro', stripe_price_id_base: 'price_pro_base' },
            },
            error: null,
          })})}),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return {};
    });
    customersRetrieve.mockResolvedValue({
      id: 'cus_1',
      invoice_settings: { default_payment_method: 'pm_default' },
    });
    pricesRetrieve.mockImplementation(async (id: string) => {
      if (id === 'price_starter_base') return { id, unit_amount: 11990, currency: 'brl' };
      if (id === 'price_pro_base')     return { id, unit_amount: 5990,  currency: 'brl' };
      throw new Error(`unexpected price ${id}`);
    });
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      cancel_at_period_end: false,
      status: 'active',
      current_period_end: 1714300000,
      items: { data: [
        { id: 'si_base',    price: { id: 'price_pro_base',    recurring: { usage_type: 'licensed' } } },
        { id: 'si_metered', price: { id: 'price_pro_metered', recurring: { usage_type: 'metered'  } } },
      ]},
    });
  }

  it('cobra antes de trocar e preserva billing cycle', async () => {
    mockUpgradeContext();
    invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
    invoicesCreate.mockResolvedValue({ id: 'in_1' });
    invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
    invoicesPay.mockResolvedValue({ id: 'in_1', status: 'paid' });
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' });

    const result = await service.createCheckoutSession('user-1', 'plan-starter');

    // Ordem: invoice item → invoice → finalize → pay → subscription update
    const calls: string[] = [];
    invoiceItemsCreate.mock.invocationCallOrder.forEach(() => calls.push('item'));
    invoicesCreate.mock.invocationCallOrder.forEach(() => calls.push('inv'));
    invoicesPay.mock.invocationCallOrder.forEach(() => calls.push('pay'));
    subscriptionsUpdate.mock.invocationCallOrder.forEach(() => calls.push('sub'));

    expect(invoiceItemsCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_1',
      amount: 6000,
      currency: 'brl',
      description: expect.stringContaining('pro'),
    }));
    expect(invoicesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        auto_advance: false,
        collection_method: 'charge_automatically',
        pending_invoice_items_behavior: 'include',
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('upgrade:user-1:plan-starter') }),
    );
    expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_1', expect.objectContaining({
      proration_behavior: 'none',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'si_base',    price: 'price_starter_base' }),
        expect.objectContaining({ id: 'si_metered', price: 'price_starter_metered' }),
      ]),
    }));
    // Não passa billing_cycle_anchor (preserva)
    expect(subscriptionsUpdate.mock.calls[0][1]).not.toHaveProperty('billing_cycle_anchor');
    expect(result).toEqual({ changed: true, plan: 'starter' });
  });

  it('rolls back invoice item se invoices.pay falha — sub não muda', async () => {
    mockUpgradeContext();
    invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
    invoicesCreate.mockResolvedValue({ id: 'in_1' });
    invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
    invoicesPay.mockRejectedValue(Object.assign(new Error('Card declined'), { code: 'card_declined' }));

    await expect(service.createCheckoutSession('user-1', 'plan-starter'))
      .rejects.toMatchObject({ status: 402 });

    expect(invoiceItemsDelete).toHaveBeenCalledWith('ii_1');
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('bloqueia upgrade sem default payment method', async () => {
    mockUpgradeContext();
    customersRetrieve.mockResolvedValue({
      id: 'cus_1',
      invoice_settings: { default_payment_method: null },
    });

    await expect(service.createCheckoutSession('user-1', 'plan-starter'))
      .rejects.toThrow(/cartão/i);
    expect(invoiceItemsCreate).not.toHaveBeenCalled();
  });

  it('bloqueia upgrade quando sub está past_due', async () => {
    mockUpgradeContext();
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      cancel_at_period_end: false,
      status: 'past_due',
      current_period_end: 1714300000,
      items: { data: [] },
    });

    await expect(service.createCheckoutSession('user-1', 'plan-starter'))
      .rejects.toThrow(/pendente|past[_ ]due/i);
  });

  it('reativa cancel_at_period_end antes de cobrar', async () => {
    mockUpgradeContext();
    subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      cancel_at_period_end: true,
      status: 'active',
      current_period_end: 1714300000,
      items: { data: [
        { id: 'si_base',    price: { id: 'price_pro_base',    recurring: { usage_type: 'licensed' } } },
        { id: 'si_metered', price: { id: 'price_pro_metered', recurring: { usage_type: 'metered'  } } },
      ]},
    });
    invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
    invoicesCreate.mockResolvedValue({ id: 'in_1' });
    invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
    invoicesPay.mockResolvedValue({ id: 'in_1', status: 'paid' });
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' });

    await service.createCheckoutSession('user-1', 'plan-starter');

    // Reativação acontece antes da invoice
    const reactivateCall = subscriptionsUpdate.mock.calls.find(
      ([, body]) => body.cancel_at_period_end === false,
    );
    expect(reactivateCall).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx jest stripe-checkout.service.spec.ts -t "changeExistingPlan (upgrade)"
```

Expected: FAIL.

- [ ] **Step 3: Reescreve `changeExistingPlan`**

Em `packages/backend/src/modules/stripe/stripe-checkout.service.ts`, substitui o método `changeExistingPlan` inteiro por:

```ts
private async changeExistingPlan(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  targetPlan: { id: string; plan: string; basePriceId: string; meteredPriceId: string },
): Promise<void> {
  const stripe = this.stripe.getClient();

  // 1. Lê estado atual: customer (pra default PM), subscription (pra status + items + cancel flag)
  const [customer, current] = await Promise.all([
    stripe.customers.retrieve(stripeCustomerId),
    stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ['items.data.price'] }),
  ]);
  if ((customer as Stripe.Customer).deleted) {
    throw new BadRequestException('Customer Stripe foi removido');
  }
  const customerObj = customer as Stripe.Customer;

  if (current.status === 'past_due') {
    throw new BadRequestException(
      'Sua assinatura está com pagamento pendente. Resolva a fatura aberta antes de trocar de plano.',
    );
  }

  const existingBase = current.items.data.find(
    (item) => item.price.recurring?.usage_type === 'licensed',
  );
  const existingMetered = current.items.data.find(
    (item) => item.price.recurring?.usage_type === 'metered',
  );
  const currentBasePriceId =
    typeof existingBase?.price === 'string'
      ? existingBase.price
      : existingBase?.price.id;
  if (!currentBasePriceId) {
    throw new BadRequestException('Subscription sem price base');
  }

  // 2. Classifica upgrade/downgrade comparando unit_amount
  const [targetPriceObj, currentPriceObj] = await Promise.all([
    stripe.prices.retrieve(targetPlan.basePriceId),
    stripe.prices.retrieve(currentBasePriceId),
  ]);
  const diffCents = (targetPriceObj.unit_amount ?? 0) - (currentPriceObj.unit_amount ?? 0);

  const targetItems: Array<{ id?: string; price: string }> = [];
  if (existingBase) targetItems.push({ id: existingBase.id, price: targetPlan.basePriceId });
  else targetItems.push({ price: targetPlan.basePriceId });
  if (existingMetered) targetItems.push({ id: existingMetered.id, price: targetPlan.meteredPriceId });
  else targetItems.push({ price: targetPlan.meteredPriceId });

  if (diffCents <= 0) {
    // DOWNGRADE: troca itens sem cobrança/crédito.
    await stripe.subscriptions.update(stripeSubscriptionId, {
      items: targetItems,
      proration_behavior: 'none',
    });
    this.logger.log(
      `Downgraded subscription ${stripeSubscriptionId} → ${targetPlan.plan} (proration: none)`,
    );
    return;
  }

  // UPGRADE
  // 2a. Pré-condição: customer tem default PM
  const defaultPmId =
    typeof customerObj.invoice_settings?.default_payment_method === 'string'
      ? customerObj.invoice_settings.default_payment_method
      : customerObj.invoice_settings?.default_payment_method?.id ?? null;
  if (!defaultPmId) {
    throw new BadRequestException('Adicione um cartão antes de fazer upgrade');
  }

  // 2b. Reativa cancel_at_period_end se aplicável (descarta agendamento de cancel)
  if (current.cancel_at_period_end) {
    await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: false });
    this.logger.log(
      `Reactivated subscription ${stripeSubscriptionId} (was canceling) before upgrade`,
    );
  }

  // 2c. Cria invoice item da diff
  let invoiceItem: Stripe.InvoiceItem;
  try {
    invoiceItem = await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      amount: diffCents,
      currency: targetPriceObj.currency ?? 'brl',
      description: `Upgrade plano ${targetPlan.plan} (diferença)`,
      metadata: {
        kind: 'plan_upgrade_diff',
        user_id: userId,
        target_plan_id: targetPlan.id,
      },
    });
  } catch (err) {
    this.logger.error(`Failed to create invoice item for upgrade ${stripeSubscriptionId}`, err);
    throw err;
  }

  // 2d. Cria + finaliza + paga invoice avulsa, com idempotency key derivada do estado
  const idempotencyKey = `upgrade:${userId}:${targetPlan.id}:${current.current_period_end}`;
  try {
    const invoice = await stripe.invoices.create(
      {
        customer: stripeCustomerId,
        auto_advance: false,
        collection_method: 'charge_automatically',
        pending_invoice_items_behavior: 'include',
        metadata: {
          kind: 'plan_upgrade_diff',
          user_id: userId,
          target_plan_id: targetPlan.id,
        },
      },
      { idempotencyKey },
    );
    if (!invoice.id) {
      throw new Error('Stripe did not return invoice id');
    }
    await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.pay(invoice.id);
  } catch (err) {
    // Roll back invoice item órfã
    try {
      if (invoiceItem.id) await stripe.invoiceItems.del(invoiceItem.id);
    } catch (delErr) {
      this.logger.error(`Failed to delete orphan invoice item ${invoiceItem.id}`, delErr);
    }
    const declineCode =
      typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : undefined;
    throw new HttpException(
      {
        statusCode: 402,
        message: 'Não foi possível cobrar a diferença do upgrade. Verifique seu cartão.',
        declineCode,
      },
      402,
    );
  }

  // 2e. Troca itens da subscription (preserva billing_cycle_anchor)
  await stripe.subscriptions.update(stripeSubscriptionId, {
    items: targetItems,
    proration_behavior: 'none',
  });
  this.logger.log(
    `Upgraded subscription ${stripeSubscriptionId} → ${targetPlan.plan} (charged ${diffCents} cents)`,
  );
}
```

- [ ] **Step 4: Atualiza imports e o caller**

No topo do arquivo, garante imports:

```ts
import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
```

E no `createCheckoutSession`, troca a chamada antiga `this.changeExistingPlan(sub.stripe_subscription_id, plan.stripe_price_id_base, plan.stripe_price_id_metered)` (linhas ~58-62) por:

```ts
await this.changeExistingPlan(
  userId,
  sub.stripe_customer_id!,
  sub.stripe_subscription_id,
  {
    id: plan.id,
    plan: plan.plan,
    basePriceId: plan.stripe_price_id_base,
    meteredPriceId: plan.stripe_price_id_metered,
  },
);
```

Garante que `sub.stripe_customer_id` está sendo selecionado. Olhando linhas ~46-48 do método, já é (`select('id, plan_id, stripe_customer_id, stripe_subscription_id')`).

- [ ] **Step 5: Run tests pra ver se passam**

```bash
cd packages/backend && npx jest stripe-checkout.service.spec.ts -t "changeExistingPlan"
```

Expected: PASS pros 5 testes do bloco.

- [ ] **Step 6: Run full backend suite**

```bash
cd packages/backend && npm run test
```

Expected: PASS. Se algum teste antigo de `changeExistingPlan` (que afirmava `proration_behavior: 'create_prorations'`) falhou, remove.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "$(cat <<'EOF'
feat(stripe): upgrade cobra diff cheia via invoice avulsa

changeExistingPlan no upgrade: cria invoice item com (target − current)
unit_amount, finaliza+paga, e só então troca os items da subscription
com proration_behavior: 'none'. Preserva billing_cycle_anchor.

Pré-condições: cartão default presente, sub não está past_due. Reativa
cancel_at_period_end antes de cobrar. Em falha de cobrança: rollback
do invoice item e 402 com declineCode.

Downgrade muda pra proration_behavior: 'none' (sem cobrança/crédito;
plano novo passa a valer na próxima renovação).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Backend — `createSetupIntent` em `StripeBillingService`

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-billing.service.ts`
- Modify: `packages/backend/src/modules/stripe/stripe-billing.controller.ts`
- Create: `packages/backend/src/modules/stripe/__tests__/stripe-billing.service.spec.ts`

- [ ] **Step 1: Cria arquivo de teste do `StripeBillingService`**

Cria `packages/backend/src/modules/stripe/__tests__/stripe-billing.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StripeBillingService } from '../stripe-billing.service';
import { StripeService } from '../stripe.service';
import { SupabaseService } from '../../../shared/services/supabase.service';

describe('StripeBillingService', () => {
  let service: StripeBillingService;
  let supabaseMock: any;
  let stripeMock: any;
  let setupIntentsCreate: jest.Mock;

  beforeEach(async () => {
    setupIntentsCreate = jest.fn();
    stripeMock = {
      getClient: () => ({
        setupIntents: { create: setupIntentsCreate },
        customers: { retrieve: jest.fn() },
        paymentMethods: { list: jest.fn(), retrieve: jest.fn(), detach: jest.fn() },
      }),
    };
    supabaseMock = { getClient: () => ({ from: jest.fn() }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeBillingService,
        { provide: StripeService, useValue: stripeMock },
        { provide: SupabaseService, useValue: supabaseMock },
      ],
    }).compile();
    service = module.get(StripeBillingService);
  });

  describe('createSetupIntent', () => {
    it('cria SetupIntent atrelado ao customer e retorna client_secret', async () => {
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_customer_id: 'cus_1' }, error: null,
        })})}),
      }));
      setupIntentsCreate.mockResolvedValue({
        id: 'seti_1',
        client_secret: 'seti_1_secret_xyz',
      });

      const result = await service.createSetupIntent('user-1');

      expect(setupIntentsCreate).toHaveBeenCalledWith({
        customer: 'cus_1',
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: { user_id: 'user-1' },
      });
      expect(result).toEqual({ clientSecret: 'seti_1_secret_xyz' });
    });

    it('rejeita user sem stripe_customer_id', async () => {
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_customer_id: null }, error: null,
        })})}),
      }));

      await expect(service.createSetupIntent('user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run test pra confirmar que falha**

```bash
cd packages/backend && npx jest stripe-billing.service.spec.ts
```

Expected: FAIL — `service.createSetupIntent is not a function`.

- [ ] **Step 3: Implementa `createSetupIntent`**

Em `packages/backend/src/modules/stripe/stripe-billing.service.ts`, adiciona dentro da classe (depois de `listPaymentMethods`):

```ts
async createSetupIntent(userId: string): Promise<{ clientSecret: string }> {
  const customerId = await this.requireCustomerId(userId);

  const intent = await this.stripe.getClient().setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
    metadata: { user_id: userId },
  });

  if (!intent.client_secret) {
    throw new Error('Stripe did not return client_secret');
  }
  return { clientSecret: intent.client_secret };
}
```

- [ ] **Step 4: Run test pra ver passar**

```bash
cd packages/backend && npx jest stripe-billing.service.spec.ts -t createSetupIntent
```

Expected: 2 tests pass.

- [ ] **Step 5: Adiciona endpoint no controller**

Em `packages/backend/src/modules/stripe/stripe-billing.controller.ts`, adiciona depois de `listPaymentMethods`:

```ts
@Post('setup-intent')
async createSetupIntent(@CurrentUser('id') userId: string): Promise<{ clientSecret: string }> {
  return this.billing.createSetupIntent(userId);
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "$(cat <<'EOF'
feat(stripe): POST /stripe/setup-intent

Cria SetupIntent atrelado ao customer pra adição de cartão via
Stripe Elements no frontend. usage='off_session' pra cobranças
recorrentes futuras.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Backend — `attachPaymentMethod` + remover `setup-portal`

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-billing.service.ts`
- Modify: `packages/backend/src/modules/stripe/stripe-billing.controller.ts`
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-billing.service.spec.ts`

- [ ] **Step 1: Write failing tests pra `attachPaymentMethod`**

Adiciona ao `stripe-billing.service.spec.ts`:

```ts
describe('attachPaymentMethod', () => {
  let paymentMethodsRetrieve: jest.Mock;
  let paymentMethodsList: jest.Mock;
  let customersUpdate: jest.Mock;

  beforeEach(() => {
    paymentMethodsRetrieve = jest.fn();
    paymentMethodsList = jest.fn();
    customersUpdate = jest.fn();
    stripeMock.getClient = () => ({
      setupIntents: { create: setupIntentsCreate },
      customers: { retrieve: jest.fn(), update: customersUpdate },
      paymentMethods: { retrieve: paymentMethodsRetrieve, list: paymentMethodsList, detach: jest.fn() },
    });
  });

  function mockCustomerLookup(customerId: string) {
    supabaseMock.getClient().from = jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { stripe_customer_id: customerId }, error: null,
      })})}),
    }));
  }

  it('valida ownership e marca primeiro PM como default', async () => {
    mockCustomerLookup('cus_1');
    paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_1' });
    paymentMethodsList.mockResolvedValue({ data: [{ id: 'pm_1' }] }); // só esse
    customersUpdate.mockResolvedValue({ id: 'cus_1' });

    const result = await service.attachPaymentMethod('user-1', 'pm_1', { setAsDefault: false });

    expect(customersUpdate).toHaveBeenCalledWith('cus_1', {
      invoice_settings: { default_payment_method: 'pm_1' },
    });
    expect(result).toEqual({ success: true, is_default: true });
  });

  it('marca como default quando setAsDefault=true mesmo com outros PMs', async () => {
    mockCustomerLookup('cus_1');
    paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_2', customer: 'cus_1' });
    paymentMethodsList.mockResolvedValue({ data: [{ id: 'pm_1' }, { id: 'pm_2' }] });
    customersUpdate.mockResolvedValue({ id: 'cus_1' });

    const result = await service.attachPaymentMethod('user-1', 'pm_2', { setAsDefault: true });

    expect(customersUpdate).toHaveBeenCalledWith('cus_1', {
      invoice_settings: { default_payment_method: 'pm_2' },
    });
    expect(result.is_default).toBe(true);
  });

  it('não toca em default quando setAsDefault=false e já tem outros PMs', async () => {
    mockCustomerLookup('cus_1');
    paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_2', customer: 'cus_1' });
    paymentMethodsList.mockResolvedValue({ data: [{ id: 'pm_1' }, { id: 'pm_2' }] });

    const result = await service.attachPaymentMethod('user-1', 'pm_2', { setAsDefault: false });

    expect(customersUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, is_default: false });
  });

  it('rejeita PM de outro customer', async () => {
    mockCustomerLookup('cus_1');
    paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_x', customer: 'cus_2' });

    await expect(service.attachPaymentMethod('user-1', 'pm_x', { setAsDefault: false }))
      .rejects.toThrow(/não pertence/i);
  });
});
```

- [ ] **Step 2: Run pra ver falhar**

```bash
cd packages/backend && npx jest stripe-billing.service.spec.ts -t attachPaymentMethod
```

Expected: FAIL.

- [ ] **Step 3: Implementa método**

Em `packages/backend/src/modules/stripe/stripe-billing.service.ts`, adiciona dentro da classe:

```ts
async attachPaymentMethod(
  userId: string,
  paymentMethodId: string,
  opts: { setAsDefault: boolean },
): Promise<{ success: true; is_default: boolean }> {
  const customerId = await this.requireCustomerId(userId);
  await this.assertPaymentMethodOwnedBy(paymentMethodId, customerId);

  // Lista PMs antes pra detectar "primeiro PM"
  const list = await this.stripe.getClient().paymentMethods.list({
    customer: customerId,
    type: 'card',
  });
  const isFirstPm = list.data.length === 1 && list.data[0]?.id === paymentMethodId;
  const shouldBeDefault = opts.setAsDefault || isFirstPm;

  if (shouldBeDefault) {
    await this.stripe.getClient().customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    this.logger.log(`Set ${paymentMethodId} as default for ${customerId}`);
  }

  return { success: true, is_default: shouldBeDefault };
}
```

- [ ] **Step 4: Run pra ver passar**

```bash
cd packages/backend && npx jest stripe-billing.service.spec.ts -t attachPaymentMethod
```

Expected: 4 tests pass.

- [ ] **Step 5: Remove `createUpdatePaymentMethodPortalSession` do service**

No mesmo arquivo, remove o método `createUpdatePaymentMethodPortalSession` por inteiro.

- [ ] **Step 6: Atualiza controller — adiciona `attach`, remove `setup-portal`**

Em `packages/backend/src/modules/stripe/stripe-billing.controller.ts`:

(a) Adiciona DTO no topo (depois dos imports):

```ts
import { Body } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

class AttachPaymentMethodDto {
  @IsString() paymentMethodId!: string;
  @IsOptional() @IsBoolean() setAsDefault?: boolean;
}
```

(b) Substitui o handler `setupPortal` (que chamava `createUpdatePaymentMethodPortalSession`) pelo novo:

```ts
@Post('payment-methods/attach')
async attach(
  @CurrentUser('id') userId: string,
  @Body() dto: AttachPaymentMethodDto,
): Promise<{ success: true; is_default: boolean }> {
  return this.billing.attachPaymentMethod(userId, dto.paymentMethodId, {
    setAsDefault: dto.setAsDefault ?? false,
  });
}
```

(c) Remove import de `PaymentMethodsResponse` se ficou órfão; remove o handler `setupPortal` antigo.

- [ ] **Step 7: Run full backend suite**

```bash
cd packages/backend && npm run test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "$(cat <<'EOF'
feat(stripe): POST /stripe/payment-methods/attach

Substitui o flow de setup-portal (popup do Customer Portal) por
attach direto: front confirma SetupIntent via Elements e chama o
endpoint pra (1) validar ownership server-side e (2) marcar como
default quando for o primeiro PM ou quando setAsDefault=true.

Remove createUpdatePaymentMethodPortalSession e o endpoint
POST /stripe/payment-methods/setup-portal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — Setup Stripe.js

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/frontend/.env.example`
- Modify: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/src/lib/stripe.ts`

- [ ] **Step 1: Instala dependências**

```bash
cd packages/frontend && npm install --save @stripe/stripe-js@^4.0.0 @stripe/react-stripe-js@^3.0.0
```

- [ ] **Step 2: Adiciona env var no `.env.example`**

Em `packages/frontend/.env.example`, adiciona ao final:

```
# Required quando há fluxo de cartão in-app — Stripe publishable key (pk_test_... ou pk_live_...).
# Safe pra frontend: chave publicável só permite operações que a Stripe valida server-side.
VITE_STRIPE_PUBLISHABLE_KEY=
```

- [ ] **Step 3: Adiciona env var no `.env` local (instrução pro dev)**

Anotação no plano (não commitar): pedir ao desenvolvedor que execute o setup local — adicionar `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` no `packages/frontend/.env` (esse arquivo NÃO entra no commit, já está em `.gitignore`).

- [ ] **Step 4: Cria `lib/stripe.ts`**

Cria `packages/frontend/src/lib/stripe.ts`:

```ts
import { loadStripe, Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      throw new Error('VITE_STRIPE_PUBLISHABLE_KEY não configurada');
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}
```

- [ ] **Step 5: Atualiza `vite.config.ts` pra separar Stripe em chunk próprio**

Em `packages/frontend/vite.config.ts`, dentro de `manualChunks`, adiciona:

```ts
'vendor-stripe': ['@stripe/stripe-js', '@stripe/react-stripe-js'],
```

Final:

```ts
manualChunks: {
  'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
  'vendor-ui':      ['lucide-react'],
  'vendor-charts':  ['recharts'],
  'vendor-query':   ['@tanstack/react-query'],
  'vendor-stripe':  ['@stripe/stripe-js', '@stripe/react-stripe-js'],
},
```

- [ ] **Step 6: Sanity check — build do frontend**

```bash
cd packages/frontend && npm run build
```

Expected: PASS. O bundle deve ter um `vendor-stripe-*.js` separado em `dist/assets/`.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/package.json packages/frontend/package-lock.json packages/frontend/.env.example packages/frontend/vite.config.ts packages/frontend/src/lib/stripe.ts
# (root package-lock também pode ter mexido em monorepo)
git add package-lock.json 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(frontend): instala Stripe.js + Elements

Adiciona @stripe/stripe-js e @stripe/react-stripe-js. lib/stripe.ts
expõe getStripePromise singleton lazy (só carrega quando algum
componente chama). manualChunks isola vendor-stripe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend — Hooks de SetupIntent, Attach e Cancel

**Files:**
- Create: `packages/frontend/src/hooks/useStripeSetupIntent.ts`
- Create: `packages/frontend/src/hooks/useAttachPaymentMethod.ts`
- Create: `packages/frontend/src/hooks/useStripeCancel.ts`

- [ ] **Step 1: Cria `useStripeSetupIntent.ts`**

```ts
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useStripeSetupIntent() {
  return useMutation({
    mutationFn: () => api.post<{ clientSecret: string }>('/stripe/setup-intent', {}),
  });
}
```

- [ ] **Step 2: Cria `useAttachPaymentMethod.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type AttachInput = { paymentMethodId: string; setAsDefault?: boolean };
type AttachResponse = { success: true; is_default: boolean };

export function useAttachPaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation<AttachResponse, Error, AttachInput>({
    mutationFn: (input) => api.post<AttachResponse>('/stripe/payment-methods/attach', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stripe', 'payment-methods'] });
    },
  });
}
```

- [ ] **Step 3: Cria `useStripeCancel.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type CancelResponse = {
  canceled_at: string;
  ends_at: string;
  already_scheduled: boolean;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function useStripeCancel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation<CancelResponse, Error>({
    mutationFn: () => api.post<CancelResponse>('/stripe/cancel', {}),
    onSuccess: async (data) => {
      toast({
        title: data.already_scheduled
          ? 'Cancelamento já estava agendado'
          : `Cancelamento agendado para ${formatDate(data.ends_at)}`,
      });
      await queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
    },
    onError: (err) => {
      toast({
        title: 'Erro ao cancelar assinatura',
        description: err.message ?? 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 4: Roda lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useStripeSetupIntent.ts \
        packages/frontend/src/hooks/useAttachPaymentMethod.ts \
        packages/frontend/src/hooks/useStripeCancel.ts
git commit -m "$(cat <<'EOF'
feat(frontend): hooks pra SetupIntent, attach PM, cancel

useStripeSetupIntent → POST /stripe/setup-intent.
useAttachPaymentMethod → POST /stripe/payment-methods/attach + invalida
queries de PM.
useStripeCancel → POST /stripe/cancel + invalida plan-usage com toast
da data de encerramento.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend — `AddCardDialog`

**Files:**
- Create: `packages/frontend/src/components/PlanTab/AddCardDialog.tsx`
- Create: `packages/frontend/src/components/PlanTab/__tests__/AddCardDialog.test.tsx`

- [ ] **Step 1: Write failing test**

Cria `packages/frontend/src/components/PlanTab/__tests__/AddCardDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddCardDialog } from '../AddCardDialog';

const setupIntentMutate = vi.fn();
const attachMutate = vi.fn();
const confirmSetup = vi.fn();

vi.mock('@/hooks/useStripeSetupIntent', () => ({
  useStripeSetupIntent: () => ({
    mutateAsync: setupIntentMutate,
    isPending: false,
    reset: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAttachPaymentMethod', () => ({
  useAttachPaymentMethod: () => ({
    mutateAsync: attachMutate,
    isPending: false,
  }),
}));

vi.mock('@/lib/stripe', () => ({
  getStripePromise: () => Promise.resolve({
    confirmSetup,
  }),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-testid="elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useElements: () => ({ submit: vi.fn().mockResolvedValue({ error: undefined }) }),
  useStripe: () => ({
    confirmSetup,
  }),
}));

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AddCardDialog', () => {
  beforeEach(() => {
    setupIntentMutate.mockReset();
    attachMutate.mockReset();
    confirmSetup.mockReset();
  });

  it('chama setup-intent ao abrir e renderiza Elements quando recebe clientSecret', async () => {
    setupIntentMutate.mockResolvedValue({ clientSecret: 'seti_1_secret' });
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(setupIntentMutate).toHaveBeenCalled();
      expect(screen.getByTestId('elements')).toBeInTheDocument();
      expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    });
  });

  it('confirma setup e chama attach com paymentMethodId', async () => {
    setupIntentMutate.mockResolvedValue({ clientSecret: 'seti_1_secret' });
    confirmSetup.mockResolvedValue({
      setupIntent: { payment_method: 'pm_new' },
      error: undefined,
    });
    attachMutate.mockResolvedValue({ success: true, is_default: true });
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />);
    await waitFor(() => screen.getByTestId('payment-element'));
    fireEvent.click(screen.getByRole('button', { name: /salvar cartão/i }));
    await waitFor(() => {
      expect(attachMutate).toHaveBeenCalledWith({
        paymentMethodId: 'pm_new',
        setAsDefault: false,
      });
    });
  });

  it('exibe erro inline quando confirmSetup falha', async () => {
    setupIntentMutate.mockResolvedValue({ clientSecret: 'seti_1_secret' });
    confirmSetup.mockResolvedValue({
      error: { message: 'Cartão recusado' },
    });
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />);
    await waitFor(() => screen.getByTestId('payment-element'));
    fireEvent.click(screen.getByRole('button', { name: /salvar cartão/i }));
    await waitFor(() => {
      expect(screen.getByText(/cartão recusado/i)).toBeInTheDocument();
      expect(attachMutate).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run pra ver falhar**

```bash
cd packages/frontend && npx vitest run src/components/PlanTab/__tests__/AddCardDialog.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Cria `AddCardDialog.tsx`**

Cria `packages/frontend/src/components/PlanTab/AddCardDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';
import { getStripePromise } from '@/lib/stripe';
import { useStripeSetupIntent } from '@/hooks/useStripeSetupIntent';
import { useAttachPaymentMethod } from '@/hooks/useAttachPaymentMethod';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess?: () => void;
};

export function AddCardDialog({ open, onOpenChange, onSuccess }: Props) {
  const setupIntent = useStripeSetupIntent();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    if (open && !clientSecret && !setupIntent.isPending) {
      setupIntent
        .mutateAsync()
        .then((data) => setClientSecret(data.clientSecret))
        .catch(() => {});
    }
    if (!open) {
      setClientSecret(null);
      setupIntent.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar cartão</DialogTitle>
          <DialogDescription>
            Os dados do seu cartão são processados diretamente pela Stripe.
            Não armazenamos dados do cartão.
          </DialogDescription>
        </DialogHeader>

        {!clientSecret ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Preparando formulário...
          </div>
        ) : (
          <Elements
            stripe={getStripePromise()}
            options={{
              clientSecret,
              appearance: { theme: 'night' },
              locale: 'pt-BR',
            }}
          >
            <CardForm
              onSuccess={() => {
                onSuccess?.();
                onOpenChange(false);
              }}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const attach = useAttachPaymentMethod();
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setError(null);
    setSubmitting(true);

    const submitResult = await elements.submit();
    if (submitResult.error) {
      setError(submitResult.error.message ?? 'Erro ao validar cartão');
      setSubmitting(false);
      return;
    }

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message ?? 'Erro ao confirmar cartão');
      setSubmitting(false);
      return;
    }

    const paymentMethodId =
      typeof setupIntent?.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id ?? null;

    if (!paymentMethodId) {
      setError('Stripe não retornou método de pagamento');
      setSubmitting(false);
      return;
    }

    try {
      await attach.mutateAsync({ paymentMethodId, setAsDefault });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar cartão');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={setAsDefault}
          onCheckedChange={(c) => setSetAsDefault(c === true)}
        />
        Definir como cartão padrão
      </label>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={submitting || !stripe || !elements}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            'Salvar cartão'
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}
```

- [ ] **Step 4: Run testes**

```bash
cd packages/frontend && npx vitest run src/components/PlanTab/__tests__/AddCardDialog.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/PlanTab/AddCardDialog.tsx \
        packages/frontend/src/components/PlanTab/__tests__/AddCardDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): AddCardDialog com Stripe Elements

Modal pega clientSecret do SetupIntent e renderiza PaymentElement.
Submit faz elements.submit + stripe.confirmSetup → POST attach com
setAsDefault opcional. Erros do confirmSetup aparecem inline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — Wire `AddCardDialog` em `PaymentMethodsCard`

**Files:**
- Modify: `packages/frontend/src/components/PlanTab/PaymentMethodsCard.tsx`
- Modify: `packages/frontend/src/hooks/useStripeBilling.ts`

- [ ] **Step 1: Atualiza `PaymentMethodsCard.tsx`**

Em `packages/frontend/src/components/PlanTab/PaymentMethodsCard.tsx`:

(a) Remove import `useAddPaymentMethod` (vai sumir):

```ts
import {
  PaymentMethod,
  useDetachPaymentMethod,
  usePaymentMethods,
  useSetDefaultPaymentMethod,
} from '@/hooks/useStripeBilling';
```

(b) Adiciona import e estado pro novo dialog. No topo do arquivo:

```ts
import { useState } from 'react';
import { AddCardDialog } from '@/components/PlanTab/AddCardDialog';
```

(c) Dentro do componente `PaymentMethodsCard`, substitui:

```ts
const addPM = useAddPaymentMethod();
```

por:

```ts
const [addOpen, setAddOpen] = useState(false);
```

(d) Substitui a expressão `addPM.isPending` em `mutating`:

```ts
const mutating = setDefault.isPending || detach.isPending;
```

(e) Substitui o botão de "Adicionar cartão":

```tsx
<Button
  size="sm"
  onClick={() => setAddOpen(true)}
  className="shrink-0"
>
  <Plus className="mr-2 h-4 w-4" />
  Adicionar cartão
</Button>
```

(f) Antes do `</div>` que fecha o container, adiciona o dialog:

```tsx
<AddCardDialog open={addOpen} onOpenChange={setAddOpen} />
```

(g) Remove o ícone `Loader2` do import se não for mais usado em outro lugar.

- [ ] **Step 2: Remove `useAddPaymentMethod` de `useStripeBilling.ts`**

Em `packages/frontend/src/hooks/useStripeBilling.ts`, remove o export `useAddPaymentMethod` por inteiro (e o import de `openExternalWindow` se ficou órfão).

- [ ] **Step 3: Roda lint pra confirmar que ninguém mais chama**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Roda testes do frontend**

```bash
cd packages/frontend && npm run test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/PlanTab/PaymentMethodsCard.tsx \
        packages/frontend/src/hooks/useStripeBilling.ts
git commit -m "$(cat <<'EOF'
refactor(frontend): PaymentMethodsCard abre AddCardDialog in-app

Substitui o popup do Customer Portal por um modal in-app com
Stripe Elements. Remove useAddPaymentMethod (popup helper).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — `CancelSubscriptionDialog`

**Files:**
- Create: `packages/frontend/src/components/PlanTab/CancelSubscriptionDialog.tsx`
- Create: `packages/frontend/src/components/PlanTab/__tests__/CancelSubscriptionDialog.test.tsx`

- [ ] **Step 1: Write failing test**

Cria `packages/frontend/src/components/PlanTab/__tests__/CancelSubscriptionDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CancelSubscriptionDialog } from '../CancelSubscriptionDialog';

const cancelMutate = vi.fn();

vi.mock('@/hooks/useStripeCancel', () => ({
  useStripeCancel: () => ({
    mutateAsync: cancelMutate,
    isPending: false,
  }),
}));

describe('CancelSubscriptionDialog', () => {
  beforeEach(() => cancelMutate.mockReset());

  it('mostra a data de fim formatada', () => {
    render(
      <CancelSubscriptionDialog
        open
        onOpenChange={() => {}}
        endsAtIso="2026-06-15T00:00:00Z"
        planName="pro"
      />,
    );
    expect(screen.getByText(/15 de jun/i)).toBeInTheDocument();
    expect(screen.getByText(/pro/i)).toBeInTheDocument();
  });

  it('chama mutation ao confirmar', async () => {
    cancelMutate.mockResolvedValue({});
    render(
      <CancelSubscriptionDialog
        open
        onOpenChange={() => {}}
        endsAtIso="2026-06-15T00:00:00Z"
        planName="pro"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sim, cancelar/i }));
    await waitFor(() => expect(cancelMutate).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run pra ver falhar**

```bash
cd packages/frontend && npx vitest run src/components/PlanTab/__tests__/CancelSubscriptionDialog.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Cria `CancelSubscriptionDialog.tsx`**

Cria `packages/frontend/src/components/PlanTab/CancelSubscriptionDialog.tsx`:

```tsx
import { useStripeCancel } from '@/hooks/useStripeCancel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  endsAtIso: string;
  planName: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

export function CancelSubscriptionDialog({ open, onOpenChange, endsAtIso, planName }: Props) {
  const cancel = useStripeCancel();

  async function handleConfirm() {
    try {
      await cancel.mutateAsync();
      onOpenChange(false);
    } catch {
      // toast já foi disparado pelo hook
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar sua assinatura?</AlertDialogTitle>
          <AlertDialogDescription>
            Sua assinatura <span className="capitalize">{planName}</span> continua ativa até {formatDate(endsAtIso)}.
            Depois dessa data, sua conta volta para o plano Grátis automaticamente.
            Você pode reativar a qualquer momento antes do encerramento.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancel.isPending}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={cancel.isPending}
            onClick={handleConfirm}
            className="!bg-destructive !text-destructive-foreground hover:!bg-destructive/90"
          >
            {cancel.isPending ? 'Cancelando...' : 'Sim, cancelar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Run testes**

```bash
cd packages/frontend && npx vitest run src/components/PlanTab/__tests__/CancelSubscriptionDialog.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/PlanTab/CancelSubscriptionDialog.tsx \
        packages/frontend/src/components/PlanTab/__tests__/CancelSubscriptionDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CancelSubscriptionDialog

AlertDialog mostrando data exata em que a sub vai virar Free.
Confirmação chama useStripeCancel; toast e invalidação são feitos
pelo hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Frontend — Wire `CancelSubscriptionDialog` em `CurrentPlanCard`

**Files:**
- Modify: `packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx`

- [ ] **Step 1: Adiciona estado e botão de cancelar**

Em `packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx`:

(a) Topo — novo import:

```ts
import { useState } from 'react';
import { CancelSubscriptionDialog } from '@/components/PlanTab/CancelSubscriptionDialog';
```

(b) Dentro de `CurrentPlanCard`, após `const reactivate = useStripeReactivate();`:

```ts
const [cancelOpen, setCancelOpen] = useState(false);
```

(c) Localiza o trecho que renderiza o botão "Gerenciar assinatura" (`else if (isPaid)`). Substitui o trecho:

```tsx
) : isPaid ? (
  <Button onClick={() => portal.mutate()} disabled={portal.isPending}>
    {portal.isPending ? 'Redirecionando...' : 'Gerenciar assinatura'}
  </Button>
) : null}
```

por:

```tsx
) : isPaid ? (
  <>
    <Button onClick={() => portal.mutate()} disabled={portal.isPending} variant="outline">
      {portal.isPending ? 'Redirecionando...' : 'Gerenciar assinatura'}
    </Button>
    <Button
      variant="ghost"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={() => setCancelOpen(true)}
    >
      Cancelar assinatura
    </Button>
  </>
) : null}
```

(d) Antes do `</div>` final do container raiz, adiciona o dialog:

```tsx
{usage.subscription.next_billing_date && (
  <CancelSubscriptionDialog
    open={cancelOpen}
    onOpenChange={setCancelOpen}
    endsAtIso={usage.subscription.next_billing_date}
    planName={usage.plan}
  />
)}
```

- [ ] **Step 2: Roda testes**

```bash
cd packages/frontend && npm run test
```

Expected: PASS.

- [ ] **Step 3: Verifica no browser**

```bash
npm run dev
```

Abre `http://localhost:5173/settings?tab=plan`. Confirma:
- Botão "Cancelar assinatura" aparece pra plano pago.
- Click abre o `AlertDialog` com data correta.
- Confirmação dispara o `POST /stripe/cancel`.
- Após sucesso, card mostra chip "Cancelamento agendado" + botão "Reativar".

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): botão de cancelar assinatura no CurrentPlanCard

Adiciona "Cancelar assinatura" ao lado do "Gerenciar assinatura"
pra planos pagos. Click abre CancelSubscriptionDialog com a data
de encerramento exata.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Frontend — `PlanSwitchDialog` com novo DTO e copy

**Files:**
- Modify: `packages/frontend/src/components/PlanTab/PlanSwitchDialog.tsx`
- Create: `packages/frontend/src/components/PlanTab/__tests__/PlanSwitchDialog.test.tsx`

- [ ] **Step 1: Write failing test**

Cria `packages/frontend/src/components/PlanTab/__tests__/PlanSwitchDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanSwitchDialog } from '../PlanSwitchDialog';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));

function renderDialog(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlanSwitchDialog
        planId="plan-target"
        targetPlanName="starter"
        buttonLabel="Trocar plano"
        confirmLabel="Confirmar troca"
        onConfirm={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('PlanSwitchDialog', () => {
  beforeEach(() => apiPost.mockReset());

  it('mostra "Diferença a pagar agora" em upgrade', async () => {
    apiPost.mockResolvedValue({
      kind: 'upgrade',
      currentPlan: 'pro',
      targetPlan: 'starter',
      chargeNowCents: 6000,
      nextChargeCents: 11990,
      effectiveDate: '2026-06-20T00:00:00Z',
      currency: 'brl',
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /trocar plano/i }));
    await waitFor(() => {
      expect(screen.getByText(/diferença a pagar agora/i)).toBeInTheDocument();
      expect(screen.getByText('R$ 60,00')).toBeInTheDocument();
      expect(screen.getByText(/próxima cobrança/i)).toBeInTheDocument();
      expect(screen.getByText('R$ 119,90')).toBeInTheDocument();
    });
  });

  it('mostra "Vai virar plano X em ..." em downgrade', async () => {
    apiPost.mockResolvedValue({
      kind: 'downgrade',
      currentPlan: 'starter',
      targetPlan: 'pro',
      chargeNowCents: 0,
      nextChargeCents: 5990,
      effectiveDate: '2026-06-20T00:00:00Z',
      currency: 'brl',
    });
    renderDialog({ targetPlanName: 'pro' });
    fireEvent.click(screen.getByRole('button', { name: /trocar plano/i }));
    await waitFor(() => {
      expect(screen.getByText(/vai virar plano pro em/i)).toBeInTheDocument();
      expect(screen.queryByText(/diferença a pagar agora/i)).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run pra ver falhar**

```bash
cd packages/frontend && npx vitest run src/components/PlanTab/__tests__/PlanSwitchDialog.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Reescreve `PlanSwitchDialog.tsx`**

Substitui o conteúdo de `packages/frontend/src/components/PlanTab/PlanSwitchDialog.tsx` por:

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type PlanChangePreview = {
  kind: 'upgrade' | 'downgrade' | 'same';
  currentPlan: string;
  targetPlan: string;
  chargeNowCents: number;
  nextChargeCents: number;
  effectiveDate: string;
  currency: string;
};

type Props = {
  planId: string;
  targetPlanName: string;
  buttonLabel: string;
  buttonDisabled?: boolean;
  onConfirm: () => void;
  confirmLabel: string;
};

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function PlanSwitchDialog({
  planId, targetPlanName, buttonLabel, buttonDisabled, onConfirm, confirmLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const preview = useMutation<PlanChangePreview, Error>({
    mutationFn: () => api.post<PlanChangePreview>('/stripe/preview-change', { planId }),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !preview.data && !preview.isPending) preview.mutate();
    if (!next) preview.reset();
  }

  const data = preview.data;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button className="w-full" disabled={buttonDisabled}>
          {buttonLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="capitalize">
            Trocar para o plano {targetPlanName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {data?.kind === 'downgrade' ? (
              <>A troca é agendada — você continua no plano atual até a data de renovação.</>
            ) : (
              <>A troca é imediata. Você paga a diferença do plano agora e mantém sua data de cobrança.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-lg border border-foreground/10 bg-card p-4 text-sm">
          {preview.isPending ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando...
            </div>
          ) : preview.isError ? (
            <p className="text-destructive">Erro ao calcular: {preview.error.message}</p>
          ) : data && data.kind === 'upgrade' ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Diferença a pagar agora</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(data.chargeNowCents, data.currency)}
                </span>
              </div>
              <div className="h-px bg-foreground/10" />
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">
                  Próxima cobrança · {formatDate(data.effectiveDate)}
                </span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(data.nextChargeCents, data.currency)}
                </span>
              </div>
            </div>
          ) : data && data.kind === 'downgrade' ? (
            <div className="space-y-2">
              <p className="text-foreground">
                Vai virar plano <span className="capitalize font-semibold">{data.targetPlan}</span>{' '}
                em {formatDate(data.effectiveDate)}.
              </p>
              <p className="text-muted-foreground">
                Sem cobrança extra agora. A próxima fatura sai por{' '}
                {formatCurrency(data.nextChargeCents, data.currency)}.
              </p>
            </div>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={preview.isPending || preview.isError}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Run testes**

```bash
cd packages/frontend && npx vitest run src/components/PlanTab/__tests__/PlanSwitchDialog.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Run full suite**

```bash
cd packages/frontend && npm run test
```

Expected: PASS.

- [ ] **Step 6: Verifica no browser**

```bash
npm run dev
```

Abre `/settings?tab=plan`, clica em "Trocar plano" pra um plano de upgrade — confirma "Diferença a pagar agora". Pra downgrade, confirma "Vai virar plano X em DD/MM".

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/PlanTab/PlanSwitchDialog.tsx \
        packages/frontend/src/components/PlanTab/__tests__/PlanSwitchDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): PlanSwitchDialog com novo modelo de cobrança

Adapta dialog ao novo DTO PlanChangePreview com kind/chargeNow/
nextCharge. Em upgrade: "Diferença a pagar agora" + "Próxima
cobrança". Em downgrade: "Vai virar plano X em DD/MM" sem campo
de cobrança imediata.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Atualiza `docs/features/11-plans-and-limits/stripe-integration.md`

**Files:**
- Modify: `docs/features/11-plans-and-limits/stripe-integration.md`

- [ ] **Step 1: Atualiza seção 2.3 (fluxo via Portal)**

Substitui o título "2.3 Fluxo de Mudanca de Plano (via Portal)" pra "2.3 Fluxo de mudança de plano". Substitui o conteúdo da seção pra:

```markdown
### 2.3 Fluxo de mudança de plano

User pago vai em Settings → grid de planos → clica "Trocar plano":

1. Dialog (`PlanSwitchDialog`) chama `POST /api/stripe/preview-change` e exibe:
   - **Upgrade:** "Diferença a pagar agora: R$ X" + "Próxima cobrança: R$ Y em DD/MM".
   - **Downgrade:** "Vai virar plano X em DD/MM" (sem cobrança imediata).
2. Confirmação chama `POST /api/stripe/checkout` com o `planId` do alvo.
3. Backend (`changeExistingPlan`):
   - **Upgrade:** invoice item de `(target.unit_amount − current.unit_amount)` → finalize → pay → só então `subscriptions.update` com `proration_behavior: 'none'`. Falha de cobrança → 402 + rollback do invoice item.
   - **Downgrade:** `subscriptions.update` com `proration_behavior: 'none'`.
4. Stripe dispara `customer.subscription.updated` → backend chama `applyPlanChange` (path inalterado).
5. UI reflete via `usePlanUsage` → `subscription.next_billing_date`, `cancel_at_period_end`, `scheduled_plan`.

**Cancelamento:** botão dedicado no `CurrentPlanCard` chama `POST /api/stripe/cancel` (`cancel_at_period_end=true`). Customer Portal continua disponível ("Gerenciar assinatura") como fallback.

**Adicionar/remover cartão:** UI in-app (`PaymentMethodsCard` + `AddCardDialog` com Stripe Elements). Customer Portal não é mais o caminho padrão.
```

- [ ] **Step 2: Atualiza tabela 5.1 (endpoints)**

Substitui a tabela inteira da seção 5.1 por:

```markdown
| Método | Path | Auth | Descrição |
|---|---|---|---|
| POST | `/api/stripe/checkout` | JWT | Cria Checkout Session (signup) ou troca plano de subscription existente (upgrade ou downgrade). |
| POST | `/api/stripe/portal` | JWT | Cria Portal Session (gerenciamento geral, fallback). |
| POST | `/api/stripe/reactivate` | JWT | Cancela `cancel_at_period_end` em assinatura agendada para cancelar. |
| POST | `/api/stripe/cancel` | JWT | Marca `cancel_at_period_end=true` na subscription. Idempotente. Retorna `ends_at`. |
| POST | `/api/stripe/preview-change` | JWT | Preview de troca de plano. Retorna `{ kind, chargeNowCents, nextChargeCents, effectiveDate, currency }`. |
| POST | `/api/stripe/setup-intent` | JWT | Cria SetupIntent atrelado ao customer. Retorna `client_secret` pra frontend usar com Stripe Elements. |
| POST | `/api/stripe/payment-methods/attach` | JWT | Anexa um PaymentMethod (já confirmado pelo Elements no front) ao customer e marca como default se for o primeiro PM ou se `setAsDefault=true`. |
| GET  | `/api/stripe/invoices` | JWT | Lista as 12 últimas faturas — inclui faturas avulsas de upgrade. |
| GET  | `/api/stripe/payment-methods` | JWT | Lista cartões + `default_payment_method_id`. |
| POST | `/api/stripe/payment-methods/:id/default` | JWT | Marca cartão como padrão. Valida ownership. |
| DELETE | `/api/stripe/payment-methods/:id` | JWT | Remove cartão. Valida ownership. |
| POST | `/api/stripe/webhook` | Stripe signature | Handler de webhooks. |
```

- [ ] **Step 3: Atualiza tabela 5.3 (services)**

Substitui pela versão:

```markdown
| Service | Responsabilidade |
|---|---|
| `StripeService` | Wrapper thin sobre SDK (`getClient()`). |
| `StripeCheckoutService` | `createCheckoutSession`, `createPortalSession`, `previewPlanChange`, `reactivateSubscription`, **`cancelSubscription`**. `changeExistingPlan` cobra diff cheio em upgrade (invoice item + invoice avulsa) antes de trocar a sub; downgrade usa `proration_behavior: 'none'`. |
| `StripeBillingService` | `listInvoices`, `listPaymentMethods`, `setDefaultPaymentMethod`, `detachPaymentMethod`, **`createSetupIntent`**, **`attachPaymentMethod`**. Valida ownership de PMs antes de mutar. |
| `StripeWebhookService` | Idempotência + dispatch por event.type. |
| `StripeOverageService` | Envia meter events com idempotência via `identifier=overageId`. |
| `StripeOverageReconciliationCron` | Retry de meter events falhos a cada 6h. |
| `StripeSignatureGuard` | Valida assinatura de webhook. |
```

- [ ] **Step 4: Atualiza RN-06 (regra de negócio)**

Substitui a linha do RN-06 na tabela da seção 3 por:

```markdown
| RN-06 | Upgrade cobra diferença cheia entre planos no momento da troca; downgrade agendado pro fim do ciclo, sem cobrança/crédito | Modelo simples e previsível: total no ciclo = preço do plano mais alto utilizado |
```

- [ ] **Step 5: Atualiza tabela 6.1 (componentes do frontend)**

Substitui a tabela 6.1 por:

```markdown
| Arquivo | Função |
|---|---|
| `src/pages/Settings.tsx` (aba Plano) | Renderiza `CheckoutReturnHandler` + grid 2-col (`CurrentPlanCard` + `PlanUsageCard`) + grid 2-col (`PaymentMethodsCard` + `InvoicesCard`) + `PlanCards`. |
| `src/components/PlanTab/CurrentPlanCard.tsx` | Hero do plano atual com botões "Gerenciar assinatura", "Cancelar assinatura" e (quando agendado) "Reativar". |
| `src/components/PlanTab/PlanCards.tsx` | Grid de planos. Botões contextuais por slug. |
| `src/components/PlanTab/PlanSwitchDialog.tsx` | Dialog de troca: em upgrade mostra "Diferença a pagar agora"; em downgrade mostra "Vai virar plano X em DD/MM". |
| `src/components/PlanTab/PaymentMethodsCard.tsx` | Lista cartões + "Adicionar cartão" abre `AddCardDialog`. |
| `src/components/PlanTab/AddCardDialog.tsx` | Modal com Stripe Elements (PaymentElement) + SetupIntent → `confirmSetup` → `attach`. |
| `src/components/PlanTab/CancelSubscriptionDialog.tsx` | AlertDialog de confirmação de cancel; chama `POST /stripe/cancel`. |
| `src/components/PlanTab/InvoicesCard.tsx` | Tabela de faturas — inclui invoices avulsas de upgrade. |
| `src/components/PlanUsageCard.tsx` | Card compacto com 5 métricas. |
| `src/components/CheckoutReturnHandler.tsx` | Lê `?status=success/cancel` na URL. |
```

- [ ] **Step 6: Atualiza tabela 6.2 (hooks)**

Substitui a tabela 6.2 por:

```markdown
| Hook | Dado / Mutation |
|---|---|
| `usePlanUsage` | `usage.subscription.{ status, next_billing_date, cancel_at_period_end, scheduled_plan, has_stripe_customer }`. |
| `useStripeCheckout` | `POST /api/stripe/checkout` (signup) ou troca de plano. |
| `useStripePortal` | `POST /api/stripe/portal` (fallback). |
| `useStripeReactivate` | `POST /api/stripe/reactivate`. |
| `useStripeCancel` | `POST /api/stripe/cancel` + invalida `plan-usage`. |
| `useStripeSetupIntent` | `POST /api/stripe/setup-intent` → `clientSecret`. |
| `useAttachPaymentMethod` | `POST /api/stripe/payment-methods/attach` + invalida cache de PMs. |
| `useInvoices` | `GET /api/stripe/invoices`. |
| `usePaymentMethods` | `GET /api/stripe/payment-methods`. |
| `useSetDefaultPaymentMethod` | `POST /api/stripe/payment-methods/:id/default`. |
| `useDetachPaymentMethod` | `DELETE /api/stripe/payment-methods/:id`. |
```

- [ ] **Step 7: Adiciona env var na seção 8**

Em `docs/features/11-plans-and-limits/stripe-integration.md`, na tabela da seção 8, adiciona linha:

```markdown
| `VITE_STRIPE_PUBLISHABLE_KEY` | Frontend (Vercel) | `pk_live_...` em prod / `pk_test_...` em test. Carregada lazy pelo `lib/stripe.ts`. |
```

- [ ] **Step 8: Atualiza seção 11 (edge cases)**

No final da tabela 11, adiciona linhas:

```markdown
| Upgrade com cartão recusado | 402 + rollback do invoice item; sub não muda; toast "Cobrança recusada" com `declineCode` |
| Upgrade sem cartão default | 400 antes de cobrar; UI abre `AddCardDialog` |
| Upgrade quando `cancel_at_period_end=true` | Backend descarta o agendamento de cancel antes de cobrar a diff |
| Add card 3DS abandonado | `confirmSetup` retorna error inline; SetupIntent permite retry |
| Race entre `previewPlanChange` e `changeExistingPlan` | Backend re-lê `unit_amount` do Stripe na hora; diff exibida = diff cobrada |
| Upgrade duplo (clique 2x) | `idempotencyKey: upgrade:{user}:{plan}:{period_end}` em `invoices.create` deduplicates |
```

- [ ] **Step 9: Commit**

```bash
git add docs/features/11-plans-and-limits/stripe-integration.md
git commit -m "$(cat <<'EOF'
docs(stripe): atualiza spec pra novo modelo de billing in-app

Reescreve seções 2.3, 5.1, 5.3, 6 e RN-06 pra refletir cancelamento
e add card in-app + cobrança de diff cheia em upgrade. Adiciona env
VITE_STRIPE_PUBLISHABLE_KEY e edge cases novos.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Smoke test em Stripe Test Mode (manual)

**Files:** nenhum — checklist manual de validação contra Stripe test mode.

**Pré-requisitos:**
- `STRIPE_SECRET_KEY=sk_test_...` no backend.
- `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` no frontend.
- `stripe listen --forward-to http://localhost:3001/api/stripe/webhook` rodando em terminal separado (copia o `whsec_...` pro `STRIPE_WEBHOOK_SECRET`).
- Um workspace de teste com user ativo.

- [ ] **Cenário 1 — Add card 4242 (sucesso simples)**

  1. User Free **com customer Stripe já criado** (ou pula pra cenário 5 se não tiver). Vai em Settings → aba Plano.
  2. Clica "Adicionar cartão".
  3. Preenche `4242 4242 4242 4242`, MM/YY futura, CVC `123`, CEP qualquer.
  4. Marca "Definir como cartão padrão".
  5. Clica "Salvar cartão".
  6. **Esperado:** modal fecha, toast verde, card aparece em `PaymentMethodsCard` com badge "Padrão".
  7. Confirma no Stripe Dashboard test mode → Customer → tem PM novo.

- [ ] **Cenário 2 — Add card 3DS (4000 0027 6000 3184)**

  Igual cenário 1 mas com cartão `4000 0027 6000 3184`. Stripe abre challenge 3DS no iframe; completa. Esperado: cartão adicionado com sucesso.

- [ ] **Cenário 3 — Add card recusado (4000 0000 0000 0002)**

  Igual cenário 1 mas com `4000 0000 0000 0002`. Esperado: erro inline no modal "card declined". `attach` não é chamado.

- [ ] **Cenário 4 — Cancel + reativar**

  1. User com sub ativa. Clica "Cancelar assinatura".
  2. Modal mostra data correta. Clica "Sim, cancelar".
  3. **Esperado:** toast "Cancelamento agendado para DD/MM"; card vira chip "Cancelamento agendado" + botão "Reativar".
  4. Clica "Reativar". Esperado: chip volta pra "Ativa"; botão volta a ser "Cancelar assinatura".
  5. No Stripe Dashboard: sub fica `cancel_at_period_end: true` e depois volta `false`.

- [ ] **Cenário 5 — Upgrade Pro → Starter (cobra R$ 60,00)**

  1. User Pro com cartão default `4242 4242 4242 4242`.
  2. Clica "Trocar plano" no card Starter.
  3. Modal mostra "Diferença a pagar agora: R$ 60,00" + "Próxima cobrança: R$ 119,90 em DD/MM" (data preservada).
  4. Confirma.
  5. **Esperado:** plano vira Starter; nova fatura aparece em "Histórico de faturas" (R$ 60,00, com PDF, número, link Stripe).
  6. No Stripe Dashboard: invoice avulsa paga; subscription com items novos; `current_period_end` igual ao anterior.

- [ ] **Cenário 6 — Upgrade com 3DS (4000 0027 6000 3184)**

  Define `4000 0027 6000 3184` como cartão default. Faz upgrade. Esperado: Stripe pede challenge → completa → sucesso.

- [ ] **Cenário 7 — Upgrade com cartão recusado (4000 0000 0000 0002)**

  Define `4000 0000 0000 0002` como default. Faz upgrade. Esperado: 402 retornado, toast "Cobrança recusada — verifique seu cartão", plano não muda. No Stripe Dashboard: invoice item NÃO existe (foi rollbacked).

- [ ] **Cenário 8 — Downgrade Starter → Pro**

  User Starter. Clica "Trocar plano" pra Pro. Modal mostra "Vai virar plano pro em DD/MM". Confirma. Esperado: sub trocada imediatamente sem cobrança/crédito; próxima fatura sai R$ 59,90 na data original.

- [ ] **Cenário 9 — Upgrade após remover último cartão**

  Remove o cartão default. Tenta upgrade. Esperado: erro "Adicione um cartão antes de fazer upgrade".

- [ ] **Cenário 10 — Cancelar + clicar de novo (idempotência)**

  Após cancelar, chamar `POST /api/stripe/cancel` de novo via DevTools / curl. Esperado: 200 com `already_scheduled: true`.

- [ ] **Documentar resultados:**

Cria comentário no PR ou arquivo temporário com checkboxes acima marcados. Se algum cenário falhar, abre task de correção.

- [ ] **Commit do checklist (opcional — se manter no repo):**

Não é necessário commitar — é validação manual. Se quiser memória, pode adicionar como Note no PR.

---

## Self-Review

**Spec coverage check (lê `docs/superpowers/specs/2026-05-08-self-serve-billing-design.md` em paralelo):**

- [x] **Sec 2 — escopo (cancel, add card, upgrade diff)** → Tasks 1, 4-5, 6-12 + 8-9 cobrem.
- [x] **Sec 3.2 — endpoints** → Task 1 (cancel), 4 (setup-intent), 5 (attach + remove setup-portal), 2 (preview-change DTO), 3 (changeExistingPlan).
- [x] **Sec 3.3 — services** → Tasks 1, 4, 5 cobrem mudanças nos services.
- [x] **Sec 3.4 — frontend deps + env + chunks** → Task 6.
- [x] **Sec 4.1 — AddCardDialog** → Tasks 8 + 9.
- [x] **Sec 4.2 — CancelSubscriptionDialog** → Tasks 10 + 11.
- [x] **Sec 4.3 — PlanSwitchDialog copy** → Task 12.
- [x] **Sec 5.1 — DTO PlanChangePreview** → Task 2.
- [x] **Sec 5.2 — algoritmo upgrade (cobra→troca)** → Task 3.
- [x] **Sec 5.3 — downgrade (`proration_behavior: 'none'`)** → Task 3 (mesmo método).
- [x] **Sec 5.4 — cancelSubscription idempotente** → Task 1.
- [x] **Sec 5.5 — createSetupIntent + attach** → Tasks 4 + 5.
- [x] **Sec 6 — edge cases** → cobertos por testes nas Tasks 3, 4, 5 + cenários manuais na Task 14.
- [x] **Sec 7 — testes** → Tasks 1, 2, 3, 4, 5, 8, 10, 12 (unit/component) + 14 (integration manual).
- [x] **Sec 8 — sem migrations** → confirmado, nada de Supabase mexido.
- [x] **Sec 9 — docs update** → Task 13.
- [x] **Sec 10 — itens de risco** → mitigações estão nos testes (idempotency key na Task 3; re-leitura de unit_amount na Task 2/3).

**Placeholder scan:** Nenhum "TBD"/"TODO". Todos os blocos de código têm o conteúdo final.

**Type consistency check:**

- `PlanChangePreview` (backend Task 2 e frontend Task 12) tem os mesmos 7 campos (`kind`, `currentPlan`, `targetPlan`, `chargeNowCents`, `nextChargeCents`, `effectiveDate`, `currency`). ✓
- `cancelSubscription` retorna `{ canceled_at, ends_at, already_scheduled }` no backend (Task 1) — frontend `useStripeCancel` (Task 7) consome `ends_at` e `already_scheduled`. ✓
- `attachPaymentMethod` retorna `{ success: true, is_default: boolean }` (Task 5) — frontend `useAttachPaymentMethod` (Task 7) tipou igual. ✓
- `createSetupIntent` retorna `{ clientSecret }` (Task 4) — frontend `useStripeSetupIntent` (Task 7) e `AddCardDialog` (Task 8) usam esse nome. ✓

Tudo bate.
