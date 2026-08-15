# Stripe Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Stripe para cobrança das assinaturas Pro/Starter/Enterprise, overage via Meter Events e self-service via Customer Portal.

**Architecture:** Módulo dedicado `packages/backend/src/modules/stripe/` encapsula SDK Stripe. Endpoints `/api/stripe/checkout` e `/api/stripe/portal` criam Stripe Sessions; redirect flow. Webhook único `/api/stripe/webhook` com signature guard e idempotência via tabela `stripe_webhook_events`. Overage dispara meter events fire-and-forget após inserir em `usage_overage`, com reconciliation cron. Script `stripe-sync.ts` provisiona produtos/preços/meters/portal idempotentemente.

**Tech Stack:** NestJS 10 + Fastify, Supabase PostgreSQL, Stripe SDK (`stripe` v17+), fastify-raw-body, Jest, React 18 + TanStack Query.

**Spec de referência:** `docs/superpowers/specs/2026-04-18-stripe-integration-design.md`

---

## File Structure

### Backend — arquivos novos

```
packages/backend/src/modules/stripe/
├── stripe.module.ts
├── stripe.service.ts
├── stripe-signature.guard.ts
├── stripe-webhook.controller.ts
├── stripe-webhook.service.ts
├── stripe-checkout.controller.ts
├── stripe-checkout.service.ts
├── stripe-overage.service.ts
├── stripe-overage-reconciliation.cron.ts
└── __tests__/
    ├── stripe-signature.guard.spec.ts
    ├── stripe-webhook.service.spec.ts
    ├── stripe-checkout.service.spec.ts
    ├── stripe-overage.service.spec.ts
    └── stripe-overage-reconciliation.cron.spec.ts

packages/backend/scripts/
└── stripe-sync.ts
```

### Backend — arquivos modificados

```
packages/backend/package.json             — add stripe + fastify-raw-body
packages/backend/src/main.ts              — configure raw body for /api/stripe/webhook
packages/backend/src/app.module.ts        — register StripeModule
packages/backend/src/modules/plan-limits/plan-limits.service.ts
                                          — extend UsageSnapshot with subscription field
packages/backend/src/modules/subscriptions/subscriptions.service.ts
                                          — applyPlanChange accepts periodStart/End params
packages/backend/src/modules/sales/sales.service.ts
                                          — fire-and-forget stripeOverage.sendMeterEvent
packages/backend/src/modules/sales/sales.module.ts
                                          — import StripeModule
```

### Frontend — arquivos modificados

```
packages/frontend/src/hooks/usePlanUsage.ts    — typing for new subscription field
packages/frontend/src/pages/Settings.tsx       — wire PlanTab with real data
packages/frontend/src/components/PlanUsageCard.tsx — update for subscription info
```

### Frontend — arquivos novos

```
packages/frontend/src/components/PlanTab/UpgradeCards.tsx
packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx
packages/frontend/src/components/PlanTab/CheckoutReturnHandler.tsx
packages/frontend/src/hooks/useStripeCheckout.ts
packages/frontend/src/hooks/useStripePortal.ts
```

### Supabase migrations

```
supabase/migrations/20260419100000_plan_rules_add_stripe_columns.sql
supabase/migrations/20260419100001_create_stripe_webhook_events.sql
```

### Docs

```
SQL_DATABASE.md                                                     — updated
docs/features/11-plans-and-limits/subscriptions.md                  — updated (Stripe section)
docs/features/11-plans-and-limits/overage-billing.md                — updated (Stripe meter section)
docs/features/11-plans-and-limits/stripe-integration.md             — NEW
```

---

## Phase 1 — Schema foundation

### Task 1: Add Stripe columns to `plan_rules` + create `stripe_webhook_events`

**Files:**
- Create: `supabase/migrations/20260419100000_plan_rules_add_stripe_columns.sql`
- Create: `supabase/migrations/20260419100001_create_stripe_webhook_events.sql`

- [ ] **Step 1: Create plan_rules migration**

```sql
-- supabase/migrations/20260419100000_plan_rules_add_stripe_columns.sql

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS stripe_product_id        text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_base     text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_metered  text,
  ADD COLUMN IF NOT EXISTS stripe_meter_event_name  text;

COMMENT ON COLUMN public.plan_rules.stripe_product_id IS
  'Stripe Product ID (prod_xxx). NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_price_id_base IS
  'Stripe Price ID do preço fixo mensal. NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_price_id_metered IS
  'Stripe Price ID do preço metered para overage. NULL para free e unlimited.';
COMMENT ON COLUMN public.plan_rules.stripe_meter_event_name IS
  'Nome do meter event a enviar quando overage ocorre. NULL para free e unlimited.';
```

- [ ] **Step 2: Create stripe_webhook_events migration**

```sql
-- supabase/migrations/20260419100001_create_stripe_webhook_events.sql

CREATE TABLE public.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);

CREATE INDEX idx_stripe_webhook_events_type_time
  ON public.stripe_webhook_events(type, processed_at DESC);

COMMENT ON TABLE public.stripe_webhook_events IS
  'Idempotency guard. Every Stripe webhook stored by event.id so we never reprocess.';
```

- [ ] **Step 3: Apply both migrations**

Run: aplicar via Supabase SQL Editor (ambas são ADDITIVAS) OU `npx supabase db push` com credenciais válidas.

Expected: ambas aplicadas sem erro; tabelas verificáveis via:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'plan_rules' AND column_name LIKE 'stripe%';
-- deve retornar 4 colunas

SELECT table_name FROM information_schema.tables WHERE table_name = 'stripe_webhook_events';
-- deve retornar 1 linha
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260419100000_plan_rules_add_stripe_columns.sql
git add supabase/migrations/20260419100001_create_stripe_webhook_events.sql
git commit -m "feat(stripe): add plan_rules stripe columns and stripe_webhook_events table"
```

---

### Task 2: Update `SQL_DATABASE.md`

**Files:**
- Modify: `SQL_DATABASE.md`

- [ ] **Step 1: Add stripe columns to plan_rules block**

Localize a definição `CREATE TABLE public.plan_rules` e adicione as 4 colunas:

```
CREATE TABLE public.plan_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan text NOT NULL UNIQUE,
  max_sales_monthly integer NOT NULL DEFAULT -1,
  max_active_ad_accounts integer NOT NULL DEFAULT -1,
  max_checkout_integrations integer NOT NULL DEFAULT 1,
  max_workspaces integer NOT NULL DEFAULT 1,
  max_active_rules integer NOT NULL DEFAULT 0,
  overage_price_cents integer NOT NULL DEFAULT 0,
  stripe_product_id text,
  stripe_price_id_base text,
  stripe_price_id_metered text,
  stripe_meter_event_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT plan_rules_pkey PRIMARY KEY (id)
);
```

- [ ] **Step 2: Add stripe_webhook_events table**

Adicione após as outras tabelas de Stripe (após `usage_overage`):

```
CREATE TABLE public.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);
```

- [ ] **Step 3: Commit**

```bash
git add SQL_DATABASE.md
git commit -m "docs(sql): add stripe columns and stripe_webhook_events to schema reference"
```

---

## Phase 2 — Stripe module foundation

### Task 3: Install Stripe SDK + fastify-raw-body + create StripeService

**Files:**
- Modify: `packages/backend/package.json`
- Create: `packages/backend/src/modules/stripe/stripe.service.ts`
- Create: `packages/backend/src/modules/stripe/stripe.module.ts`
- Modify: `packages/backend/src/app.module.ts`

- [ ] **Step 1: Install dependencies**

Run from repo root:
```bash
npm install --workspace=@sentinel/backend stripe@^17.3.1 fastify-raw-body@^5.0.0
```

Expected: two packages added to `packages/backend/package.json` dependencies.

- [ ] **Step 2: Create StripeService**

```typescript
// packages/backend/src/modules/stripe/stripe.service.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe features will fail until configured');
    }
    this.client = new Stripe(key ?? 'sk_placeholder', {
      apiVersion: '2024-11-20.acacia',
      typescript: true,
    });
  }

  getClient(): Stripe {
    return this.client;
  }
}
```

- [ ] **Step 3: Create StripeModule**

```typescript
// packages/backend/src/modules/stripe/stripe.module.ts
import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';

@Module({
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
```

- [ ] **Step 4: Register module in app.module.ts**

Em `packages/backend/src/app.module.ts`, adicione o import e registre:

```typescript
import { StripeModule } from './modules/stripe/stripe.module';

@Module({
  imports: [
    // ... imports existentes
    StripeModule,
  ],
  // ...
})
export class AppModule {}
```

- [ ] **Step 5: Verify build**

Run: `npm run build --workspace=@sentinel/backend`
Expected: build passes (SDK registers, typings OK).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/package.json packages/backend/package-lock.json
git add packages/backend/src/modules/stripe/ packages/backend/src/app.module.ts
git commit -m "feat(stripe): install SDK and create StripeService/Module"
```

---

### Task 4: Configure Fastify raw body for webhook route

**Files:**
- Modify: `packages/backend/src/main.ts`

- [ ] **Step 1: Read current main.ts**

Run: `cat packages/backend/src/main.ts`

Confirm that app uses `FastifyAdapter`.

- [ ] **Step 2: Register fastify-raw-body**

Adicione **antes** do `await app.listen(...)` no `main.ts`:

```typescript
// Raw body needed for Stripe webhook signature verification.
// Only for /api/stripe/webhook route — other routes use parsed body.
await app.register(require('fastify-raw-body'), {
  field: 'rawBody',
  encoding: 'utf8',
  runFirst: true,
  global: false,
  routes: ['/api/stripe/webhook'],
});
```

Import at top:

```typescript
import type { FastifyInstance } from 'fastify';
```

(if not already imported; `app.register` is on the NestJS `NestFastifyApplication` which exposes Fastify's `register` via `getHttpAdapter().getInstance().register` — use appropriate form. Verify with `cat packages/backend/src/main.ts` if the register call needs to be on `app.getHttpAdapter().getInstance()` instead.)

- [ ] **Step 3: Verify build still passes**

Run: `npm run build --workspace=@sentinel/backend`
Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/main.ts
git commit -m "feat(stripe): configure raw body for webhook signature verification"
```

---

## Phase 3 — Signature guard + webhook skeleton

### Task 5: StripeSignatureGuard with tests

**Files:**
- Create: `packages/backend/src/modules/stripe/stripe-signature.guard.ts`
- Create: `packages/backend/src/modules/stripe/__tests__/stripe-signature.guard.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/backend/src/modules/stripe/__tests__/stripe-signature.guard.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { StripeSignatureGuard } from '../stripe-signature.guard';
import { StripeService } from '../stripe.service';

describe('StripeSignatureGuard', () => {
  let guard: StripeSignatureGuard;
  let constructEventMock: jest.Mock;

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    constructEventMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeSignatureGuard,
        {
          provide: StripeService,
          useValue: {
            getClient: () => ({ webhooks: { constructEvent: constructEventMock } }),
          },
        },
      ],
    }).compile();

    guard = module.get(StripeSignatureGuard);
  });

  function makeCtx(headers: Record<string, string>, rawBody: string | undefined) {
    const request: any = { headers, rawBody };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  it('throws when stripe-signature header missing', () => {
    const ctx = makeCtx({}, 'body');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when rawBody missing', () => {
    const ctx = makeCtx({ 'stripe-signature': 'sig' }, undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when constructEvent throws (invalid signature)', () => {
    constructEventMock.mockImplementation(() => { throw new Error('bad sig'); });
    const ctx = makeCtx({ 'stripe-signature': 'sig' }, 'body');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('returns true and attaches stripeEvent on valid signature', () => {
    const event = { id: 'evt_1', type: 'customer.subscription.created' };
    constructEventMock.mockReturnValue(event);
    const request: any = { headers: { 'stripe-signature': 'sig' }, rawBody: 'body' };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.stripeEvent).toBe(event);
    expect(constructEventMock).toHaveBeenCalledWith('body', 'sig', 'whsec_test');
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `npm test --workspace=@sentinel/backend -- stripe-signature.guard.spec.ts`
Expected: FAIL (`Cannot find module '../stripe-signature.guard'`)

- [ ] **Step 3: Implement guard**

```typescript
// packages/backend/src/modules/stripe/stripe-signature.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { StripeService } from './stripe.service';

@Injectable()
export class StripeSignatureGuard implements CanActivate {
  constructor(private readonly stripe: StripeService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest();
    const signature = request.headers['stripe-signature'];
    const rawBody = request.rawBody;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature) throw new UnauthorizedException('Missing stripe-signature header');
    if (!rawBody) throw new UnauthorizedException('Missing raw body');
    if (!secret) throw new UnauthorizedException('STRIPE_WEBHOOK_SECRET not configured');

    try {
      request.stripeEvent = this.stripe.getClient().webhooks.constructEvent(
        rawBody as string | Buffer,
        signature as string,
        secret,
      );
      return true;
    } catch {
      throw new UnauthorizedException('Invalid Stripe signature');
    }
  }
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-signature.guard.spec.ts`
Expected: 4/4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/stripe/stripe-signature.guard.ts
git add packages/backend/src/modules/stripe/__tests__/stripe-signature.guard.spec.ts
git commit -m "feat(stripe): add signature guard for webhook verification"
```

---

### Task 6: StripeWebhookController and skeleton service with idempotency

**Files:**
- Create: `packages/backend/src/modules/stripe/stripe-webhook.controller.ts`
- Create: `packages/backend/src/modules/stripe/stripe-webhook.service.ts`
- Create: `packages/backend/src/modules/stripe/__tests__/stripe-webhook.service.spec.ts`
- Modify: `packages/backend/src/modules/stripe/stripe.module.ts`

- [ ] **Step 1: Write failing test — idempotency**

```typescript
// packages/backend/src/modules/stripe/__tests__/stripe-webhook.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookService } from '../stripe-webhook.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { Logger } from '@nestjs/common';

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let insertMock: jest.Mock;

  beforeEach(async () => {
    insertMock = jest.fn();
    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'stripe_webhook_events') {
            return {
              insert: insertMock,
            };
          }
          return {};
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();

    service = module.get(StripeWebhookService);
  });

  it('records new event in stripe_webhook_events and processes', async () => {
    insertMock.mockResolvedValue({ data: [{ id: 'evt_1' }], error: null });
    const handlerSpy = jest.spyOn(service as any, 'dispatchHandler').mockResolvedValue(undefined);

    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } } as any;
    await service.handle(event);

    expect(insertMock).toHaveBeenCalledWith({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: {} },
    });
    expect(handlerSpy).toHaveBeenCalledWith(event);
  });

  it('skips duplicate event (conflict on insert)', async () => {
    // Supabase returns `error: null` with empty data when conflict resolved by the client?
    // In practice: upsert + onConflict + ignoreDuplicates uses Supabase "upsert" API.
    // Our approach: plain insert and check for 23505 constraint violation.
    insertMock.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    const handlerSpy = jest.spyOn(service as any, 'dispatchHandler').mockResolvedValue(undefined);

    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } } as any;
    await service.handle(event);

    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('re-throws if insert fails with non-conflict error', async () => {
    insertMock.mockResolvedValue({
      data: null,
      error: { code: '42P01', message: 'relation not found' },
    });

    const event = { id: 'evt_1', type: 'foo', data: {} } as any;
    await expect(service.handle(event)).rejects.toThrow('relation not found');
  });
});
```

- [ ] **Step 2: Run to FAIL**

Run: `npm test --workspace=@sentinel/backend -- stripe-webhook.service.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement webhook service**

```typescript
// packages/backend/src/modules/stripe/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const { error } = await this.supabase.getClient()
      .from('stripe_webhook_events')
      .insert({
        id: event.id,
        type: event.type,
        data: event.data as any,
      });

    if (error) {
      if (error.code === '23505') {
        this.logger.log(`Duplicate webhook event ${event.id} (${event.type}) — skipping`);
        return;
      }
      throw new Error(error.message);
    }

    await this.dispatchHandler(event);
  }

  private async dispatchHandler(event: Stripe.Event): Promise<void> {
    this.logger.log(`Handling ${event.type} (id: ${event.id})`);
    switch (event.type) {
      case 'checkout.session.completed':
        // Informational — subscription.created handles plan change.
        break;
      case 'customer.subscription.created':
        // TODO in task 10
        break;
      case 'customer.subscription.updated':
        // TODO in task 11
        break;
      case 'customer.subscription.deleted':
        // TODO in task 12
        break;
      case 'invoice.paid':
        this.logger.log(`Invoice paid: ${(event.data.object as any).id}`);
        break;
      case 'invoice.payment_failed':
        this.logger.warn(`Invoice payment failed: ${(event.data.object as any).id}`);
        break;
      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-webhook.service.spec.ts`
Expected: 3/3 passing.

- [ ] **Step 5: Implement webhook controller**

```typescript
// packages/backend/src/modules/stripe/stripe-webhook.controller.ts
import { Controller, Post, Req, UseGuards, HttpCode } from '@nestjs/common';
import { StripeSignatureGuard } from './stripe-signature.guard';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('stripe')
export class StripeWebhookController {
  constructor(private readonly webhookService: StripeWebhookService) {}

  @Post('webhook')
  @UseGuards(StripeSignatureGuard)
  @HttpCode(200)
  async handle(@Req() req: any): Promise<{ received: true }> {
    await this.webhookService.handle(req.stripeEvent);
    return { received: true };
  }
}
```

- [ ] **Step 6: Register controller + service in module**

Atualize `packages/backend/src/modules/stripe/stripe.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeSignatureGuard } from './stripe-signature.guard';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  providers: [StripeService, StripeSignatureGuard, StripeWebhookService],
  controllers: [StripeWebhookController],
  exports: [StripeService],
})
export class StripeModule {}
```

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/stripe/stripe-webhook.controller.ts
git add packages/backend/src/modules/stripe/stripe-webhook.service.ts
git add packages/backend/src/modules/stripe/__tests__/stripe-webhook.service.spec.ts
git add packages/backend/src/modules/stripe/stripe.module.ts
git commit -m "feat(stripe): add webhook controller and service skeleton with idempotency"
```

---

## Phase 4 — Core service extensions

### Task 7: Extend `UsageSnapshot` with subscription field

**Files:**
- Modify: `packages/backend/src/modules/plan-limits/plan-limits.service.ts`
- Modify: `packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts`

- [ ] **Step 1: Write failing test for subscription field**

Adicione ao `plan-limits.service.spec.ts`, dentro do `describe('getUsageSnapshot', ...)`:

```typescript
  it('includes subscription status fields', async () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: true,
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_456',
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    };
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: sub,
      plan: { plan: 'pro', max_sales_monthly: 1000, max_active_ad_accounts: 3, max_checkout_integrations: 3, max_workspaces: 3, max_active_rules: 3, overage_price_cents: 14 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 1, ad_accounts: 1, integrations: 1, rules: 0, sales: 100,
    });
    jest.spyOn(service as any, 'countBlockedSales').mockResolvedValue(0);
    jest.spyOn(service as any, 'getOverageTotals').mockResolvedValue({ count: 0, totalCents: 0 });
    jest.spyOn(service as any, 'resolveScheduledPlan').mockResolvedValue(null);

    const snap = await service.getUsageSnapshot('user-1');
    expect(snap.subscription).toEqual({
      status: 'active',
      next_billing_date: '2026-05-01T00:00:00Z',
      cancel_at_period_end: true,
      scheduled_plan: null,
      has_stripe_customer: true,
    });
  });

  it('reports status=null when no stripe subscription', async () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-free-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      scheduled_plan_id: null,
      scheduled_changes_at: null,
    };
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: sub,
      plan: { plan: 'free', max_sales_monthly: 30, max_active_ad_accounts: 1, max_checkout_integrations: 1, max_workspaces: 1, max_active_rules: 0, overage_price_cents: 0 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 1, ad_accounts: 0, integrations: 1, rules: 0, sales: 10,
    });
    jest.spyOn(service as any, 'countBlockedSales').mockResolvedValue(0);
    jest.spyOn(service as any, 'getOverageTotals').mockResolvedValue({ count: 0, totalCents: 0 });
    jest.spyOn(service as any, 'resolveScheduledPlan').mockResolvedValue(null);

    const snap = await service.getUsageSnapshot('user-1');
    expect(snap.subscription).toEqual({
      status: null,
      next_billing_date: '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
      scheduled_plan: null,
      has_stripe_customer: false,
    });
  });
```

- [ ] **Step 2: Verify FAIL**

Run: `npm test --workspace=@sentinel/backend -- plan-limits.service.spec.ts -t "subscription"`
Expected: FAIL.

- [ ] **Step 3: Update `resolveUserPlan` SELECT to include new subscription columns**

Em `plan-limits.service.ts`, localize o SELECT de `subscriptions` (em `resolveUserPlan`). Expanda para incluir:

```typescript
const { data: subscription, error: subErr } = await client
  .from('subscriptions')
  .select('id, user_id, plan_id, current_period_start, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, scheduled_plan_id, scheduled_changes_at')
  .eq('user_id', userId)
  .maybeSingle();
```

Atualize o tipo `ResolvedPlan`:

```typescript
interface ResolvedPlan {
  subscription: {
    id: string;
    user_id: string;
    plan_id: string;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    scheduled_plan_id: string | null;
    scheduled_changes_at: string | null;
  };
  plan: { /* existente */ };
}
```

- [ ] **Step 4: Add `subscription` to `UsageSnapshot` and populate in `getUsageSnapshot`**

Atualize a interface `UsageSnapshot`:

```typescript
export interface UsageSnapshot {
  plan: string;
  period: { start: string; end: string };
  sales:        { used: number; limit: number; blocked: number };
  workspaces:   { used: number; limit: number };
  adAccounts:   { used: number; limit: number };
  integrations: { used: number; limit: number };
  activeRules:  { used: number; limit: number };
  overage:      { count: number; totalCents: number };
  subscription: {
    status: 'active' | 'past_due' | 'canceled' | null;
    next_billing_date: string | null;
    cancel_at_period_end: boolean;
    scheduled_plan: { slug: string; changes_at: string } | null;
    has_stripe_customer: boolean;
  };
}
```

No método `getUsageSnapshot`, acrescente:

```typescript
  async getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
    const { plan, subscription } = await this.resolveUserPlan(userId);
    const [counts, blocked, overageTotals, scheduledPlan] = await Promise.all([
      this.countActive(userId, subscription),
      this.countBlockedSales(userId, subscription),
      this.getOverageTotals(userId, subscription),
      this.resolveScheduledPlan(subscription.scheduled_plan_id),
    ]);

    const status: 'active' | null = subscription.stripe_subscription_id ? 'active' : null;

    return {
      plan: plan.plan,
      period: { start: subscription.current_period_start, end: subscription.current_period_end },
      sales:        { used: counts.sales, limit: plan.max_sales_monthly, blocked },
      workspaces:   { used: counts.workspaces, limit: plan.max_workspaces },
      adAccounts:   { used: counts.ad_accounts, limit: plan.max_active_ad_accounts },
      integrations: { used: counts.integrations, limit: plan.max_checkout_integrations },
      activeRules:  { used: counts.rules, limit: plan.max_active_rules },
      overage:      overageTotals,
      subscription: {
        status,
        next_billing_date: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        scheduled_plan: scheduledPlan && subscription.scheduled_changes_at
          ? { slug: scheduledPlan, changes_at: subscription.scheduled_changes_at }
          : null,
        has_stripe_customer: !!subscription.stripe_customer_id,
      },
    };
  }

  private async resolveScheduledPlan(planId: string | null): Promise<string | null> {
    if (!planId) return null;
    const { data } = await this.supabase.getClient()
      .from('plan_rules')
      .select('plan')
      .eq('id', planId)
      .maybeSingle();
    return data?.plan ?? null;
  }
```

- [ ] **Step 5: Run tests to PASS**

Run: `npm test --workspace=@sentinel/backend -- plan-limits.service.spec.ts`
Expected: todos PASS (incluindo os 2 novos e os existentes sem regressão — pode precisar adicionar `subscription` aos snapshots esperados dos testes antigos).

Se existir um teste antigo assertando o shape completo de `UsageSnapshot` que quebrou, adicione o campo `subscription` ao expected.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/plan-limits/
git commit -m "feat(plan-limits): extend UsageSnapshot with subscription status"
```

---

### Task 8: `SubscriptionsService.applyPlanChange` accepts period params

**Files:**
- Modify: `packages/backend/src/modules/subscriptions/subscriptions.service.ts`
- Modify: `packages/backend/src/modules/subscriptions/__tests__/subscriptions.service.spec.ts`

- [ ] **Step 1: Write failing test**

Adicione ao `subscriptions.service.spec.ts`:

```typescript
  it('uses provided periodStart/periodEnd when given', async () => {
    const customStart = '2026-05-15T00:00:00.000Z';
    const customEnd   = '2026-06-15T00:00:00.000Z';

    let capturedSubUpdate: any = null;

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: { id: 'sub-1', user_id: 'user-1', plan_id: 'old-plan' },
                error: null,
              }) }) }),
              update: (payload: any) => {
                capturedSubUpdate = payload;
                return { eq: async () => ({ error: null }) };
              },
            };
          }
          if (table === 'plan_rules') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: { id: 'new-plan-id', plan: 'free', max_sales_monthly: 30,
                     max_workspaces: 1, max_active_ad_accounts: 1,
                     max_checkout_integrations: 1, max_active_rules: 0 },
              error: null,
            }) }) }) };
          }
          if (table === 'profiles') {
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          }
          // default no-op resource fetchers
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              then: async (resolve: any) => resolve({ data: [], error: null }),
            }),
          };
        },
      }),
    };

    const planLimits = { invalidate: jest.fn().mockResolvedValue(undefined) };
    const discord = { logApiError: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: PlanLimitsService, useValue: planLimits },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();

    const svc = module.get(SubscriptionsService);

    await svc.applyPlanChange('user-1', 'new-plan-id', {
      periodStart: customStart,
      periodEnd: customEnd,
    });

    expect(capturedSubUpdate.current_period_start).toBe(customStart);
    expect(capturedSubUpdate.current_period_end).toBe(customEnd);
  });

- [ ] **Step 2: Verify FAIL**

Run: `npm test --workspace=@sentinel/backend -- subscriptions.service.spec.ts -t "periodStart"`
Expected: FAIL.

- [ ] **Step 3: Update service signature and implementation**

```typescript
// packages/backend/src/modules/subscriptions/subscriptions.service.ts

export interface ApplyPlanChangeOptions {
  periodStart?: string;
  periodEnd?: string;
}

async applyPlanChange(
  userId: string,
  newPlanId: string,
  options: ApplyPlanChangeOptions = {},
): Promise<ApplyPlanChangeResult> {
  // ... corpo existente até o passo 7 (update subscriptions) ...

  const now = new Date().toISOString();
  const defaultPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const currentPeriodStart = options.periodStart ?? now;
  const currentPeriodEnd = options.periodEnd ?? defaultPeriodEnd;

  const { error: subErr } = await client.from('subscriptions').update({
    plan_id: newPlanId,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    scheduled_plan_id: null,
    scheduled_changes_at: null,
    updated_at: now,
  }).eq('user_id', userId);
  if (subErr) throw subErr;

  // ... resto do corpo (UPDATE profiles, invalidate) ...
}
```

- [ ] **Step 4: Run tests to PASS**

Run: `npm test --workspace=@sentinel/backend -- subscriptions.service.spec.ts`
Expected: todos PASS. Tests existentes ainda passam porque as novas opções têm default.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/subscriptions/
git commit -m "feat(subscriptions): applyPlanChange accepts optional period params"
```

---

## Phase 5 — Checkout flow

### Task 9: StripeCheckoutService — createCheckoutSession

**Files:**
- Create: `packages/backend/src/modules/stripe/stripe-checkout.service.ts`
- Create: `packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StripeCheckoutService } from '../stripe-checkout.service';
import { StripeService } from '../stripe.service';
import { SupabaseService } from '../../../shared/services/supabase.service';

describe('StripeCheckoutService', () => {
  let service: StripeCheckoutService;
  let supabaseMock: any;
  let stripeMock: any;
  let customersCreate: jest.Mock;
  let sessionsCreate: jest.Mock;

  const FRONTEND_URL = 'http://localhost:5173';

  beforeEach(async () => {
    process.env.FRONTEND_URL = FRONTEND_URL;

    customersCreate = jest.fn();
    sessionsCreate = jest.fn();

    stripeMock = {
      getClient: () => ({
        customers: { create: customersCreate },
        checkout: { sessions: { create: sessionsCreate } },
      }),
    };

    supabaseMock = {
      getClient: () => ({
        from: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeCheckoutService,
        { provide: StripeService, useValue: stripeMock },
        { provide: SupabaseService, useValue: supabaseMock },
      ],
    }).compile();

    service = module.get(StripeCheckoutService);
  });

  it('throws when plan is free', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'plan-free', plan: 'free', stripe_price_id_base: null, stripe_price_id_metered: null },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    await expect(service.createCheckoutSession('user-1', 'plan-free'))
      .rejects.toThrow(BadRequestException);
  });

  it('creates customer if missing, then creates Checkout Session', async () => {
    const calls: Record<string, any[]> = {};
    supabaseMock.getClient().from = jest.fn((table: string) => {
      calls[table] = calls[table] ?? [];
      if (table === 'plan_rules') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'plan-pro',
                  plan: 'pro',
                  stripe_price_id_base: 'price_base_pro',
                  stripe_price_id_metered: 'price_metered_pro',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'sub-1', user_id: 'user-1', plan_id: 'plan-free',
                  stripe_customer_id: null, stripe_subscription_id: null,
                },
                error: null,
              }),
            }),
          }),
          update: (payload: any) => {
            calls.subscriptions_update = [payload];
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { user_id: 'user-1', email: 'u@example.com', name: 'User', cpf: '123' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    customersCreate.mockResolvedValue({ id: 'cus_123' });
    sessionsCreate.mockResolvedValue({ id: 'cs_123', url: 'https://checkout.stripe.com/x' });

    const result = await service.createCheckoutSession('user-1', 'plan-pro');

    expect(customersCreate).toHaveBeenCalledWith({
      email: 'u@example.com',
      name: 'User',
      metadata: { user_id: 'user-1', cpf: '123' },
    });

    expect(calls.subscriptions_update).toEqual([{ stripe_customer_id: 'cus_123', updated_at: expect.any(String) }]);

    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subscription',
      customer: 'cus_123',
      payment_method_types: ['card'],
      line_items: [
        { price: 'price_base_pro', quantity: 1 },
        { price: 'price_metered_pro' },
      ],
      subscription_data: { metadata: { user_id: 'user-1', plan_id: 'plan-pro' } },
      success_url: expect.stringContaining('status=success'),
      cancel_url: expect.stringContaining('status=cancel'),
      locale: 'pt-BR',
    }));

    expect(result).toEqual({ url: 'https://checkout.stripe.com/x' });
  });

  it('redirects to portal when user already has paid subscription', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'plan-pro', plan: 'pro', stripe_price_id_base: 'price_base_pro', stripe_price_id_metered: 'price_metered_pro' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'sub-1', user_id: 'user-1', plan_id: 'plan-starter',
                  stripe_customer_id: 'cus_456', stripe_subscription_id: 'sub_existing',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    const result = await service.createCheckoutSession('user-1', 'plan-pro');
    expect(result).toEqual({ redirectTo: '/api/stripe/portal' });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm test --workspace=@sentinel/backend -- stripe-checkout.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement service**

```typescript
// packages/backend/src/modules/stripe/stripe-checkout.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { SupabaseService } from '../../shared/services/supabase.service';

export type CheckoutResult =
  | { url: string }
  | { redirectTo: string };

@Injectable()
export class StripeCheckoutService {
  private readonly logger = new Logger(StripeCheckoutService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
  ) {}

  async createCheckoutSession(userId: string, planId: string): Promise<CheckoutResult> {
    const client = this.supabase.getClient();

    // 1. Load plan
    const { data: plan, error: planErr } = await client
      .from('plan_rules')
      .select('id, plan, stripe_price_id_base, stripe_price_id_metered')
      .eq('id', planId)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!plan) throw new BadRequestException('Plan not found');
    if (!plan.stripe_price_id_base || !plan.stripe_price_id_metered) {
      throw new BadRequestException(`Plan ${plan.plan} is not available for subscription`);
    }

    // 2. Load current subscription
    const { data: sub, error: subErr } = await client
      .from('subscriptions')
      .select('id, plan_id, stripe_customer_id, stripe_subscription_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!sub) throw new BadRequestException('Subscription not found — signup flow incomplete');

    // 3. Already has paid subscription → redirect to Portal
    if (sub.stripe_subscription_id) {
      return { redirectTo: '/api/stripe/portal' };
    }

    // 4. Resolve customer — create if missing
    let customerId = sub.stripe_customer_id;
    if (!customerId) {
      const { data: profile, error: profileErr } = await client
        .from('profiles')
        .select('email, name, cpf')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) throw new BadRequestException('Profile not found');

      const customer = await this.stripe.getClient().customers.create({
        email: profile.email ?? undefined,
        name: profile.name ?? undefined,
        metadata: { user_id: userId, cpf: profile.cpf ?? '' },
      });
      customerId = customer.id;

      const { error: updateErr } = await client
        .from('subscriptions')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (updateErr) throw updateErr;
    }

    // 5. Create Checkout Session
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const session = await this.stripe.getClient().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        { price: plan.stripe_price_id_base, quantity: 1 },
        { price: plan.stripe_price_id_metered },
      ],
      subscription_data: {
        metadata: { user_id: userId, plan_id: plan.id },
      },
      success_url: `${frontendUrl}/settings?tab=plan&status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/settings?tab=plan&status=cancel`,
      locale: 'pt-BR',
    });

    if (!session.url) {
      throw new Error('Stripe did not return a session URL');
    }

    return { url: session.url };
  }
}
```

- [ ] **Step 4: Run to PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-checkout.service.spec.ts`
Expected: 3/3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/stripe/stripe-checkout.service.ts
git add packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts
git commit -m "feat(stripe): add checkout service with Checkout Session creation"
```

---

### Task 10: Add createPortalSession to StripeCheckoutService

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-checkout.service.ts`
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts`

- [ ] **Step 1: Write failing test**

Adicione ao spec:

```typescript
  describe('createPortalSession', () => {
    let billingPortalCreate: jest.Mock;

    beforeEach(() => {
      billingPortalCreate = jest.fn();
      stripeMock.getClient = () => ({
        customers: { create: customersCreate },
        checkout: { sessions: { create: sessionsCreate } },
        billingPortal: { sessions: { create: billingPortalCreate } },
      });
    });

    it('creates portal session for user with stripe_customer_id', async () => {
      supabaseMock.getClient().from = (table: string) => {
        if (table === 'subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { stripe_customer_id: 'cus_789' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      };

      billingPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/x' });

      const result = await service.createPortalSession('user-1');

      expect(billingPortalCreate).toHaveBeenCalledWith({
        customer: 'cus_789',
        return_url: `${FRONTEND_URL}/settings?tab=plan`,
        locale: 'pt-BR',
      });
      expect(result).toEqual({ url: 'https://billing.stripe.com/x' });
    });

    it('throws when user has no stripe_customer_id', async () => {
      supabaseMock.getClient().from = (table: string) => {
        if (table === 'subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { stripe_customer_id: null },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      };

      await expect(service.createPortalSession('user-1'))
        .rejects.toThrow(BadRequestException);
    });
  });
```

- [ ] **Step 2: Verify FAIL**

Run: `npm test --workspace=@sentinel/backend -- stripe-checkout.service.spec.ts -t "createPortalSession"`
Expected: FAIL.

- [ ] **Step 3: Implement method**

Adicione ao `StripeCheckoutService`:

```typescript
  async createPortalSession(userId: string): Promise<{ url: string }> {
    const { data: sub, error } = await this.supabase.getClient()
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.stripe_customer_id) {
      throw new BadRequestException('Nenhuma assinatura Stripe ativa');
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const session = await this.stripe.getClient().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${frontendUrl}/settings?tab=plan`,
      locale: 'pt-BR',
    });

    return { url: session.url };
  }
```

- [ ] **Step 4: Run to PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-checkout.service.spec.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/stripe/stripe-checkout.service.ts
git add packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts
git commit -m "feat(stripe): add createPortalSession to checkout service"
```

---

### Task 11: StripeCheckoutController + register in module

**Files:**
- Create: `packages/backend/src/modules/stripe/stripe-checkout.controller.ts`
- Modify: `packages/backend/src/modules/stripe/stripe.module.ts`

- [ ] **Step 1: Create controller**

```typescript
// packages/backend/src/modules/stripe/stripe-checkout.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsString, IsUUID } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StripeCheckoutService, CheckoutResult } from './stripe-checkout.service';

class CheckoutDto {
  @IsString() @IsUUID()
  planId!: string;
}

@UseGuards(AuthGuard)
@Controller('stripe')
export class StripeCheckoutController {
  constructor(private readonly checkout: StripeCheckoutService) {}

  @Post('checkout')
  async createCheckout(
    @CurrentUser('sub') userId: string,
    @Body() dto: CheckoutDto,
  ): Promise<CheckoutResult> {
    return this.checkout.createCheckoutSession(userId, dto.planId);
  }

  @Post('portal')
  async createPortal(@CurrentUser('sub') userId: string): Promise<{ url: string }> {
    return this.checkout.createPortalSession(userId);
  }
}
```

- [ ] **Step 2: Register in module**

Atualize `packages/backend/src/modules/stripe/stripe.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeSignatureGuard } from './stripe-signature.guard';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeCheckoutController } from './stripe-checkout.controller';
import { StripeCheckoutService } from './stripe-checkout.service';

@Module({
  providers: [
    StripeService,
    StripeSignatureGuard,
    StripeWebhookService,
    StripeCheckoutService,
  ],
  controllers: [StripeWebhookController, StripeCheckoutController],
  exports: [StripeService],
})
export class StripeModule {}
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build --workspace=@sentinel/backend`
Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/stripe/stripe-checkout.controller.ts
git add packages/backend/src/modules/stripe/stripe.module.ts
git commit -m "feat(stripe): expose POST /api/stripe/checkout and /api/stripe/portal"
```

---

## Phase 6 — Webhook handlers

### Task 12: `customer.subscription.created` handler

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-webhook.service.ts`
- Modify: `packages/backend/src/modules/stripe/stripe.module.ts`
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-webhook.service.spec.ts`

- [ ] **Step 1: Write failing test**

Adicione ao spec:

```typescript
  describe('customer.subscription.created', () => {
    let applyPlanChange: jest.Mock;
    let updateSubscription: jest.Mock;

    beforeEach(async () => {
      applyPlanChange = jest.fn().mockResolvedValue({ /* whatever */ });
      updateSubscription = jest.fn().mockReturnThis();

      const supabase = {
        getClient: () => ({
          from: (t: string) => {
            if (t === 'stripe_webhook_events') return { insert: jest.fn().mockResolvedValue({ error: null }) };
            if (t === 'subscriptions') return { update: updateSubscription, eq: () => ({ error: null }) };
            return {};
          },
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StripeWebhookService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SubscriptionsService, useValue: { applyPlanChange } },
        ],
      }).compile();

      service = module.get(StripeWebhookService);
    });

    it('updates stripe_subscription_id and calls applyPlanChange with period dates', async () => {
      const event = {
        id: 'evt_1',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_456',
            current_period_start: 1735257600,  // epoch seconds
            current_period_end:   1737936000,
            metadata: { user_id: 'user-1', plan_id: 'plan-pro' },
          },
        },
      } as any;

      await service.handle(event);

      expect(applyPlanChange).toHaveBeenCalledWith('user-1', 'plan-pro', {
        periodStart: new Date(1735257600 * 1000).toISOString(),
        periodEnd:   new Date(1737936000 * 1000).toISOString(),
      });
    });
  });
```

- [ ] **Step 2: Verify FAIL**

Run: `npm test --workspace=@sentinel/backend -- stripe-webhook.service.spec.ts -t "subscription.created"`
Expected: FAIL.

- [ ] **Step 3: Implement handler**

Atualize `stripe-webhook.service.ts`:

```typescript
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

// constructor:
constructor(
  private readonly supabase: SupabaseService,
  private readonly subscriptions: SubscriptionsService,
) {}

// dispatchHandler switch case:
case 'customer.subscription.created':
  await this.handleSubscriptionCreated(event);
  break;

// new method:
private async handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const userId = sub.metadata?.user_id;
  const planId = sub.metadata?.plan_id;

  if (!userId || !planId) {
    this.logger.error(`subscription.created missing metadata: user_id=${userId}, plan_id=${planId}`);
    return;
  }

  await this.supabase.getClient()
    .from('subscriptions')
    .update({
      stripe_subscription_id: sub.id,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  await this.subscriptions.applyPlanChange(userId, planId, {
    periodStart: new Date(sub.current_period_start * 1000).toISOString(),
    periodEnd:   new Date(sub.current_period_end * 1000).toISOString(),
  });
}
```

- [ ] **Step 4: Register SubscriptionsModule import**

Em `stripe.module.ts`:

```typescript
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  // ... rest
})
```

- [ ] **Step 5: Run to PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-webhook.service.spec.ts`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "feat(stripe): handle customer.subscription.created webhook"
```

---

### Task 13: `customer.subscription.deleted` handler

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-webhook.service.ts`
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-webhook.service.spec.ts`

- [ ] **Step 1: Write failing test**

Adicione ao spec:

```typescript
  describe('customer.subscription.deleted', () => {
    let applyPlanChange: jest.Mock;
    let updateCalls: any[] = [];

    beforeEach(async () => {
      updateCalls = [];
      applyPlanChange = jest.fn().mockResolvedValue({ old_plan: 'pro', new_plan: 'free', unblocked_sales: 0, trimmed: {} });

      const supabase = {
        getClient: () => ({
          from: (t: string) => {
            if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
            if (t === 'subscriptions') {
              return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({
                  data: { user_id: 'user-42' }, error: null,
                }) }) }),
                update: (payload: any) => {
                  updateCalls.push(payload);
                  return { eq: async () => ({ error: null }) };
                },
              };
            }
            if (t === 'plan_rules') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: { id: 'free-plan-id' }, error: null,
              }) }) }) };
            }
            return {};
          },
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          StripeWebhookService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SubscriptionsService, useValue: { applyPlanChange } },
          { provide: DiscordLoggerService, useValue: { logApiError: jest.fn() } },
        ],
      }).compile();

      service = module.get(StripeWebhookService);
    });

    it('converts user to free plan and clears stripe_subscription_id', async () => {
      const event = {
        id: 'evt_del_1',
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_abc', customer: 'cus_xyz' },
        },
      } as any;

      await service.handle(event);

      expect(applyPlanChange).toHaveBeenCalledWith('user-42', 'free-plan-id', {
        periodStart: expect.any(String),
        periodEnd: expect.any(String),
      });
      expect(updateCalls[0]).toMatchObject({
        stripe_subscription_id: null,
        cancel_at_period_end: false,
      });
    });
  });
```

- [ ] **Step 2: Implement handler**

```typescript
// dispatchHandler switch:
case 'customer.subscription.deleted':
  await this.handleSubscriptionDeleted(event);
  break;

// new method:
private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const client = this.supabase.getClient();

  // Find user by stripe_customer_id
  const { data: subRow } = await client
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!subRow) {
    this.logger.error(`subscription.deleted: no user found for customer ${customerId}`);
    return;
  }

  // Find free plan ID
  const { data: freePlan } = await client
    .from('plan_rules')
    .select('id')
    .eq('plan', 'free')
    .maybeSingle();

  if (!freePlan) {
    this.logger.error(`subscription.deleted: free plan not found in plan_rules`);
    return;
  }

  const now = new Date().toISOString();
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await this.subscriptions.applyPlanChange(subRow.user_id, freePlan.id, {
    periodStart: now,
    periodEnd: thirtyDaysFromNow,
  });

  // Clear Stripe subscription reference (customer stays for potential resubscribe)
  await client
    .from('subscriptions')
    .update({
      stripe_subscription_id: null,
      cancel_at_period_end: false,
      updated_at: now,
    })
    .eq('user_id', subRow.user_id);
}
```

- [ ] **Step 3: Run to PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-webhook.service.spec.ts`
Expected: todos PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "feat(stripe): handle customer.subscription.deleted webhook"
```

---

### Task 14: `customer.subscription.updated` handler

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-webhook.service.ts`
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-webhook.service.spec.ts`

- [ ] **Step 1: Write failing tests for 4 scenarios**

```typescript
  describe('customer.subscription.updated', () => {
    let applyPlanChange: jest.Mock;
    let capturedSubUpdate: any = null;

    async function setupService(options: {
      currentPlanId: string;
      newPlanRulesData: any | null;
      currentCancelAtPeriodEnd: boolean;
    }) {
      capturedSubUpdate = null;
      applyPlanChange = jest.fn().mockResolvedValue({});

      const supabase = {
        getClient: () => ({
          from: (t: string) => {
            if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
            if (t === 'subscriptions') {
              return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({
                  data: { user_id: 'user-1', plan_id: options.currentPlanId,
                          cancel_at_period_end: options.currentCancelAtPeriodEnd },
                  error: null,
                }) }) }),
                update: (payload: any) => {
                  capturedSubUpdate = payload;
                  return { eq: async () => ({ error: null }) };
                },
              };
            }
            if (t === 'plan_rules') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
                data: options.newPlanRulesData, error: null,
              }) }) }) };
            }
            return {};
          },
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          StripeWebhookService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SubscriptionsService, useValue: { applyPlanChange } },
          { provide: DiscordLoggerService, useValue: { logApiError: jest.fn() } },
        ],
      }).compile();

      return module.get(StripeWebhookService);
    }

    it('detects immediate plan change and calls applyPlanChange', async () => {
      const svc = await setupService({
        currentPlanId: 'old-plan',
        newPlanRulesData: { id: 'new-plan', plan: 'starter' },
        currentCancelAtPeriodEnd: false,
      });

      const event = {
        id: 'evt_upd_1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            customer: 'cus_1',
            current_period_start: 1735257600,
            current_period_end:   1737936000,
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_new_base', recurring: { usage_type: 'licensed' } } }] },
          },
          previous_attributes: { items: { data: [{ price: { id: 'price_old_base' } }] } },
        },
      } as any;

      await svc.handle(event);

      expect(applyPlanChange).toHaveBeenCalledWith('user-1', 'new-plan', {
        periodStart: new Date(1735257600 * 1000).toISOString(),
        periodEnd:   new Date(1737936000 * 1000).toISOString(),
      });
    });

    it('detects cancel_at_period_end=true and marks subscription', async () => {
      const svc = await setupService({
        currentPlanId: 'plan-pro',
        newPlanRulesData: null,
        currentCancelAtPeriodEnd: false,
      });

      const event = {
        id: 'evt_upd_2',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1', customer: 'cus_1',
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_pro_base' } }] },
            current_period_start: 1000, current_period_end: 2000,
          },
          previous_attributes: { cancel_at_period_end: false },
        },
      } as any;

      await svc.handle(event);

      expect(applyPlanChange).not.toHaveBeenCalled();
      expect(capturedSubUpdate).toMatchObject({ cancel_at_period_end: true });
    });

    it('detects cancel_at_period_end=false (reactivation) and clears flag', async () => {
      const svc = await setupService({
        currentPlanId: 'plan-pro',
        newPlanRulesData: null,
        currentCancelAtPeriodEnd: true,
      });

      const event = {
        id: 'evt_upd_3',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1', customer: 'cus_1',
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_pro_base' } }] },
            current_period_start: 1000, current_period_end: 2000,
          },
          previous_attributes: { cancel_at_period_end: true },
        },
      } as any;

      await svc.handle(event);

      expect(applyPlanChange).not.toHaveBeenCalled();
      expect(capturedSubUpdate).toMatchObject({ cancel_at_period_end: false });
    });

    it('ignores update when price already matches current plan', async () => {
      const svc = await setupService({
        currentPlanId: 'plan-pro',
        newPlanRulesData: { id: 'plan-pro', plan: 'pro' },  // same plan id
        currentCancelAtPeriodEnd: false,
      });

      const event = {
        id: 'evt_upd_4',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1', customer: 'cus_1',
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_pro_base' } }] },
            current_period_start: 1000, current_period_end: 2000,
          },
          previous_attributes: {},
        },
      } as any;

      await svc.handle(event);
      expect(applyPlanChange).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Implement handler**

```typescript
// dispatchHandler switch:
case 'customer.subscription.updated':
  await this.handleSubscriptionUpdated(event);
  break;

// new method:
private async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const previousAttrs = (event.data as any).previous_attributes ?? {};
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const client = this.supabase.getClient();

  const { data: subRow } = await client
    .from('subscriptions')
    .select('user_id, plan_id, cancel_at_period_end')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!subRow) {
    this.logger.warn(`subscription.updated: no user for customer ${customerId}`);
    return;
  }

  const now = new Date().toISOString();

  // Case A: cancel_at_period_end changed
  if ('cancel_at_period_end' in previousAttrs) {
    await client
      .from('subscriptions')
      .update({
        cancel_at_period_end: sub.cancel_at_period_end,
        updated_at: now,
      })
      .eq('user_id', subRow.user_id);
    return;
  }

  // Case B: plan change (price changed on items)
  const basePriceId = sub.items.data.find((i: any) => i.price?.recurring?.usage_type === 'licensed')?.price.id
                   ?? sub.items.data[0]?.price.id;
  if (!basePriceId) {
    this.logger.warn(`subscription.updated: no base price found`);
    return;
  }

  const { data: newPlan } = await client
    .from('plan_rules')
    .select('id, plan')
    .eq('stripe_price_id_base', basePriceId)
    .maybeSingle();

  if (!newPlan) {
    this.logger.warn(`subscription.updated: no plan_rules row for price ${basePriceId}`);
    return;
  }

  if (newPlan.id === subRow.plan_id) {
    this.logger.log(`subscription.updated: no plan change (still ${newPlan.plan})`);
    return;
  }

  await this.subscriptions.applyPlanChange(subRow.user_id, newPlan.id, {
    periodStart: new Date(sub.current_period_start * 1000).toISOString(),
    periodEnd:   new Date(sub.current_period_end * 1000).toISOString(),
  });
}
```

- [ ] **Step 3: Run to PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-webhook.service.spec.ts`
Expected: todos PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "feat(stripe): handle customer.subscription.updated webhook"
```

---

### Task 15: Wire Discord logs for `invoice.payment_failed`

**Files:**
- Modify: `packages/backend/src/modules/stripe/stripe-webhook.service.ts`
- Modify: `packages/backend/src/modules/stripe/__tests__/stripe-webhook.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
  it('logs payment_failed event to Discord', async () => {
    const logApiError = jest.fn();
    // ... setup service with DiscordLoggerService mock ...

    const event = {
      id: 'evt_9',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_123',
          customer: 'cus_xxx',
          amount_due: 5990,
          attempt_count: 2,
          subscription: 'sub_yyy',
        },
      },
    } as any;

    await service.handle(event);

    expect(logApiError).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'stripe_payment_failed',
      error: expect.stringContaining('attempt 2'),
    }));
  });
```

- [ ] **Step 2: Implement**

Inject `DiscordLoggerService` in constructor. In dispatchHandler:

```typescript
case 'invoice.payment_failed': {
  const invoice = event.data.object as any;
  this.logger.warn(`Invoice payment failed: ${invoice.id}`);
  this.discord.logApiError({
    endpoint: 'stripe_payment_failed',
    error: `Invoice ${invoice.id} attempt ${invoice.attempt_count} failed (amount ${invoice.amount_due})`,
    userId: invoice.customer,
  } as any);
  break;
}
```

- [ ] **Step 3: PASS + commit**

Run: `npm test --workspace=@sentinel/backend -- stripe-webhook.service.spec.ts`
Expected: todos PASS.

```bash
git add packages/backend/src/modules/stripe/
git commit -m "feat(stripe): log invoice.payment_failed to Discord"
```

---

## Phase 7 — Overage via Meter Events

### Task 16: StripeOverageService with sendMeterEvent

**Files:**
- Create: `packages/backend/src/modules/stripe/stripe-overage.service.ts`
- Create: `packages/backend/src/modules/stripe/__tests__/stripe-overage.service.spec.ts`
- Modify: `packages/backend/src/modules/stripe/stripe.module.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/backend/src/modules/stripe/__tests__/stripe-overage.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { StripeOverageService } from '../stripe-overage.service';
import { StripeService } from '../stripe.service';
import { SupabaseService } from '../../../shared/services/supabase.service';

describe('StripeOverageService', () => {
  let service: StripeOverageService;
  let meterCreateMock: jest.Mock;
  let supabaseUpdateMock: jest.Mock;

  beforeEach(async () => {
    meterCreateMock = jest.fn().mockResolvedValue({ identifier: 'overage-1' });
    supabaseUpdateMock = jest.fn().mockReturnValue({
      eq: () => ({ error: null }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeOverageService,
        {
          provide: StripeService,
          useValue: {
            getClient: () => ({
              v1: { billing: { meterEvents: { create: meterCreateMock } } },
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => ({
              from: (t: string) => {
                if (t === 'usage_overage') {
                  return {
                    select: () => ({
                      eq: () => ({
                        maybeSingle: async () => ({
                          data: {
                            id: 'overage-1',
                            user_id: 'user-1',
                            sale_id: 'sale-1',
                            price_cents: 14,
                            subscription: { stripe_customer_id: 'cus_abc' },
                            user: { plan: { stripe_meter_event_name: 'sentinela_approved_sales_pro' } },
                          },
                          error: null,
                        }),
                      }),
                    }),
                    update: supabaseUpdateMock,
                  };
                }
                return {};
              },
            }),
          },
        },
      ],
    }).compile();

    service = module.get(StripeOverageService);
  });

  it('sends meter event with idempotency identifier and updates reported_to_stripe_at', async () => {
    await service.sendMeterEvent({ overageId: 'overage-1' });

    expect(meterCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'sentinela_approved_sales_pro',
      identifier: 'overage-1',
      payload: expect.objectContaining({
        value: '1',
        stripe_customer_id: 'cus_abc',
      }),
    }));

    expect(supabaseUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      reported_to_stripe_at: expect.any(String),
      stripe_usage_record_id: 'overage-1',
    }));
  });

  it('throws when no stripe_customer_id', async () => {
    // Override supabase mock to return null customer
    // Assert throws
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npm test --workspace=@sentinel/backend -- stripe-overage.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement service**

```typescript
// packages/backend/src/modules/stripe/stripe-overage.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class StripeOverageService {
  private readonly logger = new Logger(StripeOverageService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
  ) {}

  async sendMeterEvent(params: { overageId: string }): Promise<void> {
    const client = this.supabase.getClient();

    const { data: ctx, error } = await client
      .from('usage_overage')
      .select(`
        id, user_id, sale_id, price_cents,
        subscription:subscriptions!inner(stripe_customer_id),
        user:profiles!inner(plan:plan_rules!inner(stripe_meter_event_name))
      `)
      .eq('id', params.overageId)
      .maybeSingle();

    if (error) throw error;
    if (!ctx) throw new Error(`Overage ${params.overageId} not found`);

    const stripeCustomerId = (ctx as any).subscription?.stripe_customer_id;
    const eventName = (ctx as any).user?.plan?.stripe_meter_event_name;

    if (!stripeCustomerId) {
      throw new Error(`No stripe_customer_id for user ${ctx.user_id} (overage ${params.overageId})`);
    }
    if (!eventName) {
      throw new Error(`No meter_event_name for user's plan (overage ${params.overageId})`);
    }

    await this.stripe.getClient().v1.billing.meterEvents.create({
      event_name: eventName,
      identifier: params.overageId,
      timestamp: Math.floor(Date.now() / 1000),
      payload: {
        value: '1',
        stripe_customer_id: stripeCustomerId,
      },
    });

    await client.from('usage_overage').update({
      reported_to_stripe_at: new Date().toISOString(),
      stripe_usage_record_id: params.overageId,
    }).eq('id', params.overageId);
  }
}
```

- [ ] **Step 4: Register in module**

Atualize `stripe.module.ts` adicionando `StripeOverageService` em providers e exports.

- [ ] **Step 5: Run to PASS**

Run: `npm test --workspace=@sentinel/backend -- stripe-overage.service.spec.ts`
Expected: passing.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/stripe/
git commit -m "feat(stripe): add overage service with Meter Events delivery"
```

---

### Task 17: Integrate overage sending into SalesService + create reconciliation cron

**Files:**
- Modify: `packages/backend/src/modules/sales/sales.service.ts`
- Modify: `packages/backend/src/modules/sales/sales.module.ts`
- Create: `packages/backend/src/modules/stripe/stripe-overage-reconciliation.cron.ts`
- Modify: `packages/backend/src/modules/stripe/stripe.module.ts`

- [ ] **Step 1: Modify SalesService.upsertFromWebhook fire-and-forget meter event**

Em `sales.service.ts`, localize a chamada `insertOverage(saved.id, sale.user_id, decision)` e adicione imediatamente depois:

```typescript
// Fire-and-forget. Reconciliation cron retries on failure.
this.stripeOverage
  .sendMeterEvent({ overageId: overageRow.id })
  .catch((err) => this.logger.warn(
    `Meter event delivery failed for overage ${overageRow.id}: ${err.message}. Reconciliation will retry.`
  ));
```

Note: `insertOverage` precisa retornar o `id` inserido. Se não retornar ainda, atualize-a pra fazer `.select('id').single()` no insert.

Inject `StripeOverageService` no constructor de `SalesService`:

```typescript
import { StripeOverageService } from '../stripe/stripe-overage.service';

constructor(
  // ... deps existentes
  private readonly stripeOverage: StripeOverageService,
) {}
```

Em `sales.module.ts`, adicione `StripeModule` aos imports.

- [ ] **Step 2: Create reconciliation cron**

```typescript
// packages/backend/src/modules/stripe/stripe-overage-reconciliation.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StripeOverageService } from './stripe-overage.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';

@Injectable()
export class StripeOverageReconciliationCron {
  private readonly logger = new Logger(StripeOverageReconciliationCron.name);

  constructor(
    private readonly stripeOverage: StripeOverageService,
    private readonly supabase: SupabaseService,
    private readonly discord: DiscordLoggerService,
  ) {}

  @Cron('0 */6 * * *')  // every 6 hours
  async retryPendingMeterEvents(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: pending, error } = await this.supabase.getClient()
      .from('usage_overage')
      .select('id')
      .is('reported_to_stripe_at', null)
      .lt('created_at', oneHourAgo)
      .limit(500);

    if (error) {
      this.logger.error(`Reconciliation query failed: ${error.message}`);
      return;
    }

    const count = pending?.length ?? 0;
    this.logger.log(`Reconciliation: ${count} pending overage events`);

    for (const row of pending ?? []) {
      try {
        await this.stripeOverage.sendMeterEvent({ overageId: row.id });
      } catch (err: any) {
        this.logger.warn(`Retry failed for overage ${row.id}: ${err.message}`);
      }
    }

    if (count > 100) {
      this.discord.logApiError({
        endpoint: 'overage-reconciliation',
        error: `High pending count: ${count} overage events unreported`,
      } as any);
    }
  }
}
```

- [ ] **Step 3: Register in stripe.module.ts**

Atualize imports pra incluir `ScheduleModule` (se não já importado em `app.module.ts`). Adicione `StripeOverageReconciliationCron` como provider.

- [ ] **Step 4: Run full test suite**

Run: `npm test --workspace=@sentinel/backend`
Expected: tudo passa. SalesService tests podem precisar do `StripeOverageService` mock — atualize fixtures.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/sales/ packages/backend/src/modules/stripe/
git commit -m "feat(stripe): integrate meter event delivery + reconciliation cron"
```

---

## Phase 8 — Setup script

### Task 18: stripe-sync.ts — Product/Meter/Price upsert

**Files:**
- Create: `packages/backend/scripts/stripe-sync.ts`
- Modify: `packages/backend/package.json` (add npm script)

- [ ] **Step 1: Create script**

```typescript
// packages/backend/scripts/stripe-sync.ts
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

interface PlanConfig {
  slug: string;
  name: string;
  base_cents: number;
  overage_cents: number;
  meter_event_name: string;
}

const PLANS: PlanConfig[] = [
  { slug: 'pro',        name: 'Sentinela Pro',        base_cents: 5990,  overage_cents: 14, meter_event_name: 'sentinela_approved_sales_pro' },
  { slug: 'starter',    name: 'Sentinela Starter',    base_cents: 11990, overage_cents: 12, meter_event_name: 'sentinela_approved_sales_starter' },
  { slug: 'enterprise', name: 'Sentinela Enterprise', base_cents: 19990, overage_cents: 7,  meter_event_name: 'sentinela_approved_sales_ent' },
];

async function upsertMeter(cfg: PlanConfig): Promise<string> {
  const existing = await stripe.billing.meters.list({ limit: 100 });
  const found = existing.data.find((m) => m.event_name === cfg.meter_event_name);
  if (found) {
    console.log(`  Meter ${cfg.meter_event_name} [reused]`);
    return found.id;
  }
  const meter = await stripe.billing.meters.create({
    display_name: `Sentinela Approved Sales (${cfg.slug})`,
    event_name: cfg.meter_event_name,
    default_aggregation: { formula: 'sum' },
  });
  console.log(`  Meter ${cfg.meter_event_name} [created]`);
  return meter.id;
}

async function upsertProduct(cfg: PlanConfig): Promise<string> {
  const existing = await stripe.products.list({ limit: 100, active: true });
  const found = existing.data.find((p) => p.metadata?.plan_slug === cfg.slug);
  if (found) {
    if (found.name !== cfg.name) {
      await stripe.products.update(found.id, { name: cfg.name });
      console.log(`  Product ${cfg.name} [updated]`);
    } else {
      console.log(`  Product ${cfg.name} [reused]`);
    }
    return found.id;
  }
  const product = await stripe.products.create({
    name: cfg.name,
    metadata: { plan_slug: cfg.slug },
  });
  console.log(`  Product ${cfg.name} [created]`);
  return product.id;
}

async function upsertPrice(params: {
  productId: string;
  cfg: PlanConfig;
  type: 'base' | 'metered';
  meterId?: string;
}): Promise<string> {
  const prices = await stripe.prices.list({
    product: params.productId, active: true, limit: 100,
  });
  const found = prices.data.find((p) =>
    p.metadata?.plan_slug === params.cfg.slug && p.metadata?.type === params.type
  );

  const expectedAmount = params.type === 'base' ? params.cfg.base_cents : params.cfg.overage_cents;

  if (found && found.unit_amount === expectedAmount) {
    console.log(`  Price ${params.type} ${found.id} [reused]`);
    return found.id;
  }

  if (found && found.unit_amount !== expectedAmount) {
    await stripe.prices.update(found.id, { active: false });
    console.log(`  Price ${params.type} ${found.id} [archived, creating new]`);
  }

  const price = await stripe.prices.create({
    product: params.productId,
    currency: 'brl',
    unit_amount: expectedAmount,
    billing_scheme: 'per_unit',
    recurring: params.type === 'base'
      ? { interval: 'month' }
      : { interval: 'month', usage_type: 'metered', meter: params.meterId! },
    metadata: { plan_slug: params.cfg.slug, type: params.type },
  });
  console.log(`  Price ${params.type} ${price.id} [created: ${expectedAmount / 100} BRL]`);
  return price.id;
}

async function syncPlan(cfg: PlanConfig): Promise<void> {
  console.log(`\nPlan: ${cfg.slug}`);

  const meterId = await upsertMeter(cfg);
  const productId = await upsertProduct(cfg);
  const basePriceId = await upsertPrice({ productId, cfg, type: 'base' });
  const meteredPriceId = await upsertPrice({ productId, cfg, type: 'metered', meterId });

  const { error } = await supabase
    .from('plan_rules')
    .update({
      stripe_product_id: productId,
      stripe_price_id_base: basePriceId,
      stripe_price_id_metered: meteredPriceId,
      stripe_meter_event_name: cfg.meter_event_name,
      updated_at: new Date().toISOString(),
    })
    .eq('plan', cfg.slug);

  if (error) throw error;
  console.log(`  plan_rules row updated ✓`);
}

async function main() {
  const isTestKey = STRIPE_SECRET_KEY.startsWith('sk_test');
  console.log(`🔧 Syncing Stripe for ${isTestKey ? 'TEST' : 'LIVE'} mode (key: ${STRIPE_SECRET_KEY.slice(0, 8)}...)`);

  for (const cfg of PLANS) {
    await syncPlan(cfg);
  }

  console.log(`
✅ Sync complete. Next steps:
  [ ] Stripe Dashboard → Settings → Billing → Subscriptions and emails → Manage failed payment retries:
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
      Copy signing secret → STRIPE_WEBHOOK_SECRET env var
`);
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Em `packages/backend/package.json`, dentro de `"scripts"`:

```json
"stripe:sync": "ts-node scripts/stripe-sync.ts"
```

Verifique se `ts-node` já está nas devDependencies; se não, adicione: `npm install --workspace=@sentinel/backend --save-dev ts-node`.

- [ ] **Step 3: Verify build/TS compile**

Run: `npm run build --workspace=@sentinel/backend`
Expected: passa.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/scripts/stripe-sync.ts packages/backend/package.json
git commit -m "feat(stripe): add setup script for products, meters, prices"
```

---

### Task 19: stripe-sync.ts — Customer Portal configuration

**Files:**
- Modify: `packages/backend/scripts/stripe-sync.ts`

- [ ] **Step 1: Add Portal configuration function**

Adicione após `syncPlan` e antes de `main`:

```typescript
async function upsertPortalConfig(productIds: { slug: string; productId: string; basePriceId: string; meteredPriceId: string }[]): Promise<void> {
  console.log('\nCustomer Portal');

  const existing = await stripe.billingPortal.configurations.list({ limit: 10 });
  const found = existing.data.find((c) => c.business_profile?.headline === 'Sentinela Billing');

  const config = {
    business_profile: { headline: 'Sentinela Billing' },
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price' as const],
        proration_behavior: 'create_prorations' as const,
        products: productIds.map((p) => ({
          product: p.productId,
          prices: [p.basePriceId, p.meteredPriceId],
        })),
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end' as const,
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] as const,
        },
      },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
    },
  };

  if (found) {
    await stripe.billingPortal.configurations.update(found.id, config as any);
    console.log(`  Configuration ${found.id} [updated]`);
  } else {
    const created = await stripe.billingPortal.configurations.create(config as any);
    console.log(`  Configuration ${created.id} [created]`);
  }
}
```

- [ ] **Step 2: Track product IDs in main() and call**

Modifique `syncPlan` pra retornar os IDs e `main` pra chamar `upsertPortalConfig`:

```typescript
async function syncPlan(cfg: PlanConfig): Promise<{ slug: string; productId: string; basePriceId: string; meteredPriceId: string }> {
  // ... código existente ...
  return { slug: cfg.slug, productId, basePriceId, meteredPriceId };
}

async function main() {
  // ... existente ...

  const productIds = [];
  for (const cfg of PLANS) {
    productIds.push(await syncPlan(cfg));
  }

  await upsertPortalConfig(productIds);

  // ... console.log dos next steps ...
}
```

- [ ] **Step 3: Verify TS compiles**

Run: `npm run build --workspace=@sentinel/backend`
Expected: passa.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/scripts/stripe-sync.ts
git commit -m "feat(stripe): sync Customer Portal configuration"
```

---

## Phase 9 — Frontend

### Task 20: Extend `usePlanUsage` typing + useStripeCheckout + useStripePortal hooks

**Files:**
- Modify: `packages/frontend/src/hooks/usePlanUsage.ts`
- Create: `packages/frontend/src/hooks/useStripeCheckout.ts`
- Create: `packages/frontend/src/hooks/useStripePortal.ts`

- [ ] **Step 1: Update UsageSnapshot type**

Em `usePlanUsage.ts`, atualize a definição do tipo pra incluir `subscription`:

```typescript
export type UsageSnapshot = {
  plan: string;
  period: { start: string; end: string };
  sales:        { used: number; limit: number; blocked: number };
  workspaces:   { used: number; limit: number };
  adAccounts:   { used: number; limit: number };
  integrations: { used: number; limit: number };
  activeRules:  { used: number; limit: number };
  overage:      { count: number; totalCents: number };
  subscription: {
    status: 'active' | 'past_due' | 'canceled' | null;
    next_billing_date: string | null;
    cancel_at_period_end: boolean;
    scheduled_plan: { slug: string; changes_at: string } | null;
    has_stripe_customer: boolean;
  };
};
```

- [ ] **Step 2: Create useStripeCheckout hook**

```typescript
// packages/frontend/src/hooks/useStripeCheckout.ts
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useStripeCheckout() {
  return useMutation({
    mutationFn: async (planId: string) => {
      const res = await api.post('/api/stripe/checkout', { planId });
      return res.data as { url?: string; redirectTo?: string };
    },
    onSuccess: async (data) => {
      if (data.url) {
        window.location.href = data.url;
      } else if (data.redirectTo === '/api/stripe/portal') {
        const portalRes = await api.post('/api/stripe/portal', {});
        window.location.href = (portalRes.data as { url: string }).url;
      }
    },
  });
}
```

- [ ] **Step 3: Create useStripePortal hook**

```typescript
// packages/frontend/src/hooks/useStripePortal.ts
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useStripePortal() {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/stripe/portal', {});
      return res.data as { url: string };
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });
}
```

- [ ] **Step 4: Verify frontend build**

Run: `npm run build --workspace=@sentinel/frontend`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/
git commit -m "feat(frontend): extend UsageSnapshot type and add Stripe checkout/portal hooks"
```

---

### Task 21: Create `UpgradeCards`, `CurrentPlanCard`, and wire into Settings

**Files:**
- Create: `packages/frontend/src/components/PlanTab/UpgradeCards.tsx`
- Create: `packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx`
- Modify: `packages/frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Create UpgradeCards**

```tsx
// packages/frontend/src/components/PlanTab/UpgradeCards.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useStripeCheckout } from '@/hooks/useStripeCheckout';
import { Button } from '@/components/ui/button';

type Plan = {
  id: string;
  plan: string;
  max_sales_monthly: number;
  overage_price_cents: number;
  stripe_price_id_base: string | null;
};

const PLAN_DISPLAY = {
  pro:        { name: 'Pro',        price_cents: 5990,  limit: 1000 },
  starter:    { name: 'Starter',    price_cents: 11990, limit: 2500 },
  enterprise: { name: 'Enterprise', price_cents: 19990, limit: 5000 },
};

function formatBRL(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function UpgradeCards() {
  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['plan-rules-list'],
    queryFn: () => api.get('/api/plans/rules').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const checkout = useStripeCheckout();

  const payablePlans = plans.filter((p) => p.stripe_price_id_base);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {['pro', 'starter', 'enterprise'].map((slug) => {
        const plan = payablePlans.find((p) => p.plan === slug);
        if (!plan) return null;
        const display = PLAN_DISPLAY[slug as keyof typeof PLAN_DISPLAY];

        return (
          <div key={slug} className="rounded border p-4 bg-slate-900 space-y-3">
            <h4 className="text-lg font-semibold">{display.name}</h4>
            <p className="text-2xl font-bold">R$ {formatBRL(display.price_cents)}<span className="text-sm text-slate-400"> /mês</span></p>
            <ul className="text-sm text-slate-300 space-y-1">
              <li>{display.limit.toLocaleString('pt-BR')} vendas aprovadas/mês</li>
              <li>Overage: R$ {formatBRL(plan.overage_price_cents)}/venda extra</li>
            </ul>
            <Button
              disabled={checkout.isPending}
              onClick={() => checkout.mutate(plan.id)}
              className="w-full"
            >
              {checkout.isPending ? 'Redirecionando...' : 'Fazer upgrade'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create CurrentPlanCard**

```tsx
// packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { useStripePortal } from '@/hooks/useStripePortal';
import { Button } from '@/components/ui/button';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function CurrentPlanCard() {
  const { usage } = usePlanUsage();
  const portal = useStripePortal();
  if (!usage) return null;

  const isPaid = !!usage.subscription.status;

  return (
    <div className="rounded border p-4 bg-slate-900 space-y-3">
      <h3 className="text-lg font-semibold">Plano atual: <span className="capitalize">{usage.plan}</span></h3>

      {usage.subscription.next_billing_date && isPaid && (
        <p className="text-sm text-slate-400">
          Próxima cobrança: <strong>{formatDate(usage.subscription.next_billing_date)}</strong>
        </p>
      )}

      {usage.subscription.cancel_at_period_end && (
        <div className="rounded bg-amber-950/40 border border-amber-800 p-3 text-sm text-amber-200">
          Assinatura cancelada. Vai virar Free em {formatDate(usage.subscription.next_billing_date!)}.
        </div>
      )}

      {usage.subscription.scheduled_plan && (
        <div className="rounded bg-blue-950/40 border border-blue-800 p-3 text-sm text-blue-200">
          Seu plano vira <strong className="capitalize">{usage.subscription.scheduled_plan.slug}</strong> em {formatDate(usage.subscription.scheduled_plan.changes_at)}.
        </div>
      )}

      {usage.plan === 'unlimited' ? (
        <p className="text-sm text-slate-400">
          Plano Unlimited — gerenciado pelo suporte. Entre em contato para ajustes.
        </p>
      ) : isPaid ? (
        <Button onClick={() => portal.mutate()} disabled={portal.isPending}>
          {portal.isPending ? 'Redirecionando...' : 'Gerenciar assinatura'}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Wire into Settings Plano tab**

Em `packages/frontend/src/pages/Settings.tsx` (ou arquivo da aba Plano), na seção do Plano:

```tsx
import { CurrentPlanCard } from '@/components/PlanTab/CurrentPlanCard';
import { UpgradeCards } from '@/components/PlanTab/UpgradeCards';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { PlanUsageCard } from '@/components/PlanUsageCard';

// Dentro do tab Plano:
function PlanTab() {
  const { usage } = usePlanUsage();
  const isPaid = !!usage?.subscription.status;

  return (
    <div className="space-y-6">
      <CurrentPlanCard />
      <PlanUsageCard />
      {!isPaid && usage?.plan === 'free' && <UpgradeCards />}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=@sentinel/frontend`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/PlanTab/ packages/frontend/src/pages/Settings.tsx
git commit -m "feat(frontend): add plan upgrade cards and current plan card"
```

---

### Task 22: Create `CheckoutReturnHandler` for post-checkout toast + refresh

**Files:**
- Create: `packages/frontend/src/components/PlanTab/CheckoutReturnHandler.tsx`
- Modify: `packages/frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Create handler**

```tsx
// packages/frontend/src/components/PlanTab/CheckoutReturnHandler.tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';

export function CheckoutReturnHandler() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const status = params.get('status');
    if (!status) return;

    // Clean URL so a refresh doesn't replay toast
    const next = new URLSearchParams(params);
    next.delete('status');
    next.delete('session_id');
    setParams(next, { replace: true });

    if (status === 'cancel') {
      toast({ title: 'Checkout cancelado', description: 'Nenhuma cobrança foi realizada.' });
      return;
    }

    if (status === 'success') {
      toast({ title: 'Pagamento confirmado', description: 'Atualizando sua assinatura...' });
      setRetrying(true);

      const attemptInvalidate = async (attempt = 0) => {
        await queryClient.invalidateQueries({ queryKey: ['plan-usage'] });
        const delay = (attempt + 1) * 2000;  // 2s, 4s, 6s
        if (attempt < 2) {
          setTimeout(() => attemptInvalidate(attempt + 1), delay);
        } else {
          setRetrying(false);
        }
      };

      attemptInvalidate(0);
    }
  }, [params]);

  return retrying ? (
    <div className="rounded bg-blue-950/40 border border-blue-800 p-3 text-sm text-blue-200">
      Atualizando assinatura... pode levar alguns segundos.
    </div>
  ) : null;
}
```

- [ ] **Step 2: Wire into Settings Plano tab**

Em `PlanTab`, adicione no topo:

```tsx
import { CheckoutReturnHandler } from '@/components/PlanTab/CheckoutReturnHandler';

function PlanTab() {
  // ...
  return (
    <div className="space-y-6">
      <CheckoutReturnHandler />
      <CurrentPlanCard />
      {/* ... */}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=@sentinel/frontend`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/PlanTab/CheckoutReturnHandler.tsx
git add packages/frontend/src/pages/Settings.tsx
git commit -m "feat(frontend): handle checkout return with refresh"
```

---

## Phase 10 — Docs + validation

### Task 23: Update docs

**Files:**
- Modify: `docs/features/11-plans-and-limits/subscriptions.md`
- Modify: `docs/features/11-plans-and-limits/overage-billing.md`
- Create: `docs/features/11-plans-and-limits/stripe-integration.md`

- [ ] **Step 1: Update `subscriptions.md`**

Substitua a seção "Pontos de extensão Stripe (grep TODO(stripe) pra listar)" por:

```
### Integração com Stripe

`stripe_customer_id` e `stripe_subscription_id` são populados quando o usuário completa um Checkout Session. O fluxo:

1. User no Free clica "Fazer upgrade" → `POST /api/stripe/checkout` → redirect pro Stripe.
2. User paga → Stripe dispara `customer.subscription.created`.
3. Handler atualiza `stripe_subscription_id` e chama `applyPlanChange(userId, planId, { periodStart, periodEnd })` com datas reais do evento.

`cancel_at_period_end`, `scheduled_plan_id` e `scheduled_changes_at` espelham estado da assinatura Stripe, populados via webhook `customer.subscription.updated`.
```

- [ ] **Step 2: Update `overage-billing.md`**

Substitua "Reporting futuro para Stripe Meter Events" por seção concreta:

```
### Reporting para Stripe Meter Events

Quando `SalesService.upsertFromWebhook` insere em `usage_overage`, dispara fire-and-forget:

```typescript
this.stripeOverage
  .sendMeterEvent({ overageId: overageRow.id })
  .catch((err) => this.logger.warn(...));
```

`StripeOverageService.sendMeterEvent`:
1. Resolve `stripe_customer_id` + `stripe_meter_event_name` para o overage.
2. Chama `stripe.v1.billing.meterEvents.create` com `identifier=overageId` (idempotente).
3. Atualiza `usage_overage.reported_to_stripe_at` e `stripe_usage_record_id`.

### Reconciliation

`StripeOverageReconciliationCron` roda a cada 6h, busca overages com `reported_to_stripe_at IS NULL` e `created_at < now() - 1h`, retenta. Alerta Discord se mais de 100 pendentes.
```

- [ ] **Step 3: Create `stripe-integration.md`**

Novo arquivo com overview completo da integração Stripe — resumir do spec as seções:
- Propósito e escopo
- Modelo de produtos/preços
- Fluxos (Checkout, Portal, Webhooks, Overage)
- Setup script
- Env vars e credentials
- Testing em test mode
- Rollout pra live mode

Use o spec em `docs/superpowers/specs/2026-04-18-stripe-integration-design.md` como fonte.

- [ ] **Step 4: Commit**

```bash
git add docs/features/11-plans-and-limits/
git commit -m "docs(stripe): add stripe-integration doc and update subscriptions/overage docs"
```

---

### Task 24: Final validation

**Files:** nenhum (só verificações).

- [ ] **Step 1: Run full test suite**

Run:
```bash
npm test
```
Expected: tudo passa. Report counts esperados: frontend 1/1, backend >140/140 (havia 122 antes desta fase; adicionadas ~20 testes novos).

- [ ] **Step 2: Run build**

Run:
```bash
npm run build
```
Expected: ambos pacotes passam.

- [ ] **Step 3: Check for TODO(stripe) remanescentes**

Run:
```bash
grep -rn "TODO(stripe)" packages/backend/src supabase/migrations
```
Expected: os comments antigos que descreviam pontos de extensão podem permanecer (como `// TODO(stripe): future — handle refund ...`), mas qualquer marker que dizia "quando Stripe integrar" deve ter sido resolvido. Revisar e remover/atualizar os que foram tratados nesta fase.

- [ ] **Step 4: Commit limpezas se houver**

Se removeu/atualizou TODO(stripe):
```bash
git add .
git commit -m "chore(stripe): cleanup resolved TODO(stripe) markers"
```

- [ ] **Step 5: Summary**

Branch final tem:
- Backend: módulo stripe/ completo (9 arquivos + tests), migrations, ajustes em plan-limits/subscriptions/sales.
- Frontend: hooks + componentes de Plano tab.
- Script: `stripe-sync.ts` idempotente.
- Docs: 3 arquivos atualizados/criados.

Pronto pra Fase B (smoke test em test mode) conforme spec §10.

---

## Notas para o executor

1. **Dependência Stripe SDK:** rode `npm install --workspace=@sentinel/backend stripe@^17.3.1 fastify-raw-body@^5.0.0` antes de qualquer Task 3+.

2. **Fluent-builder mocks:** padrão já usado no projeto — olhe `subscriptions.service.spec.ts` existente pra referência. Copie a abordagem para os novos specs.

3. **Testes para Task 14 (webhook.updated):** são os mais complexos. Não tente testar os 4 cenários num único subagent — se necessário, divida em 4 micro-tasks. O caso "immediate plan change" é o crítico.

4. **`raw body` Fastify:** se `app.register` não funcionar do jeito mostrado na Task 4, use `app.getHttpAdapter().getInstance().register(...)`. Testar com `curl -v -X POST http://localhost:3001/api/stripe/webhook -d 'test' -H 'content-type: application/json'` e verificar que o guard rejeita (expected: 401 Invalid Stripe signature, não 400 JSON parse error).

5. **Env vars em dev:** defina `STRIPE_SECRET_KEY=sk_test_placeholder` no `.env.local` durante implementação — evita warnings. O valor real só importa pro smoke test.

6. **Testes existentes podem quebrar:** Task 7 (UsageSnapshot extension) pode quebrar algum teste antigo que assertar o shape completo de `UsageSnapshot`. Adicione o campo `subscription` aos expected nesses testes antes de proceder.

7. **Mocking Supabase relational select:** em `stripe-overage.service.ts`, usamos a sintaxe `.select('subscription:subscriptions!inner(...)')` — mockar isso requer estrutura aninhada no retorno. Se for difícil, simplifique dividindo em 2 queries sequenciais (menos elegante mas mais testável).

8. **Frontend do plano Unlimited:** o UpgradeCards não mostra essa opção (não existe produto Stripe). CurrentPlanCard mostra mensagem estática "Plano Unlimited — gerenciado pelo suporte". Admin faz grant via `applyPlanChange` direto (a UI de admin já suporta isso).
