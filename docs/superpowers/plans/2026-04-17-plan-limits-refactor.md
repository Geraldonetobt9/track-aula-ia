# Plan Limits Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o sistema atual de limites de planos por um enforcement real e centralizado, com 5 planos, overage billing preparado pra Stripe, ciclo de assinatura próprio e downgrade com auto-trim.

**Architecture:** Um novo módulo `PlanLimitsService` centraliza todas as checagens. Uma nova tabela `subscriptions` é fonte de verdade do plano/ciclo (preparada pra Stripe). `usage_overage` registra vendas extras pagas por venda. `sales.blocked_by_limit` permite ao Free persistir vendas acima do limite sem contabilizar. Downgrade usa soft-disable via `archived_at`/`is_active=false` com heurísticas. A função `apply_plan_change` (RPC SQL) garante atomicidade da transição.

**Tech Stack:** NestJS 10, Fastify, Supabase PostgreSQL (service role), Jest (backend), TanStack Query + React 18 (frontend), class-validator.

**Spec de referência:** `docs/superpowers/specs/2026-04-17-plan-limits-refactor-design.md`

---

## File Structure

### Backend — arquivos novos

```
packages/backend/src/modules/plan-limits/
├── plan-limits.module.ts
├── plan-limits.service.ts
├── plan-limits.controller.ts
├── plan-limit-exceeded.exception.ts
└── __tests__/
    ├── plan-limits.service.spec.ts
    └── plan-limits.controller.spec.ts

packages/backend/src/modules/subscriptions/
├── subscriptions.module.ts
├── subscriptions.service.ts
└── __tests__/
    └── subscriptions.service.spec.ts
```

### Backend — arquivos modificados

```
packages/backend/src/modules/plans/plans.service.ts          — ALLOWED_FIELDS, getRulesForPlanId, novos nomes de coluna
packages/backend/src/modules/plans/dto/update-plan.dto.ts    — reescreve DTO com class-validator
packages/backend/src/modules/integrations/integrations.service.ts  — usa assertCanCreateIntegration
packages/backend/src/modules/automation-rules/automation-rules.service.ts  — usa assertCanActivateRule
packages/backend/src/modules/workspaces/workspaces.service.ts — usa assertCanCreateWorkspace + filtra archived_at
packages/backend/src/modules/facebook/*                       — usa assertCanActivateAdAccount
packages/backend/src/modules/sales/sales.service.ts          — webhook flow com blocked_by_limit + overage
packages/backend/src/modules/admin/admin.service.ts          — usa applyPlanChange em vez de UPDATE direto
packages/backend/src/app.module.ts                            — registra PlanLimitsModule e SubscriptionsModule
```

### Frontend — arquivos novos

```
packages/frontend/src/hooks/usePlanUsage.ts
packages/frontend/src/components/PlanLimitModal.tsx
packages/frontend/src/components/PlanUsageCard.tsx
```

### Frontend — modificados / deletados

```
DELETE: packages/frontend/src/hooks/usePlanRules.ts
MODIFY: packages/frontend/src/pages/admin/AdminPlans.tsx
MODIFY: packages/frontend/src/pages/Settings.tsx (aba Plano)
MODIFY: packages/frontend/src/lib/api-client.ts (interceptor HTTP 402)
MODIFY: packages/frontend/src/components/WorkspaceSwitcher.tsx
MODIFY: packages/frontend/src/types/plans.ts (ou equivalente)
```

### Supabase — migrations novas

```
supabase/migrations/20260417100000_plan_rules_add_overage_price.sql
supabase/migrations/20260417100001_create_subscriptions_table.sql
supabase/migrations/20260417100002_backfill_subscriptions.sql
supabase/migrations/20260417100003_create_usage_overage_table.sql
supabase/migrations/20260417100004_sales_add_blocked_by_limit.sql
supabase/migrations/20260417100005_workspaces_add_archive_columns.sql
supabase/migrations/20260417100006_rename_plan_rules_columns.sql
supabase/migrations/20260417100007_seed_plan_rules_values.sql
supabase/migrations/20260417100008_rpc_apply_plan_change.sql
supabase/migrations/20260417300000_drop_plan_rules_dead_columns.sql
```

> **Ordem proposital:** a RENAME acontece ANTES do RPC porque o RPC usa os nomes novos. O DROP das colunas mortas fica por último (depois do frontend tirar qualquer referência residual).

### Docs

```
SQL_DATABASE.md                                              — atualizar
docs/features/11-plans-and-limits/plan-rules.md              — reescrever
docs/features/11-plans-and-limits/subscriptions.md           — NOVO
docs/features/11-plans-and-limits/overage-billing.md         — NOVO
docs/features/11-plans-and-limits/downgrade-auto-trim.md     — NOVO
```

---

## Phase 1 — Schema foundation (migrations + atualização mínima)

### Task 1: Adicionar `overage_price_cents` em `plan_rules`

**Files:**
- Create: `supabase/migrations/20260417100000_plan_rules_add_overage_price.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100000_plan_rules_add_overage_price.sql

ALTER TABLE public.plan_rules
  ADD COLUMN IF NOT EXISTS overage_price_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plan_rules.overage_price_cents IS
  'Preço em centavos por venda aprovada acima do max_sales_monthly. 0 = sem overage (Free, Unlimited).';
```

- [ ] **Step 2: Aplicar**

Run: `npx supabase db push`
Expected: coluna criada sem erro.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100000_plan_rules_add_overage_price.sql
git commit -m "feat(plan-limits): add overage_price_cents column"
```

---

### Task 2: Criar tabela `subscriptions`

**Files:**
- Create: `supabase/migrations/20260417100001_create_subscriptions_table.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100001_create_subscriptions_table.sql

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plan_rules(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','trialing','past_due','canceled','paused')),
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,

  -- TODO(stripe): preenchido pelo handler de customer.subscription.* quando Stripe integrar.
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text UNIQUE,

  -- TODO(stripe): espelha downgrade agendado no Customer Portal Stripe (fonte de verdade = Stripe).
  scheduled_plan_id    uuid REFERENCES public.plan_rules(id),
  scheduled_changes_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_period_end ON public.subscriptions(current_period_end);
CREATE INDEX idx_subscriptions_scheduled_changes
  ON public.subscriptions(scheduled_changes_at)
  WHERE scheduled_changes_at IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.subscriptions IS
  'Fonte de verdade do plano/ciclo de cada usuário. Preparada para integração com Stripe.';
```

- [ ] **Step 2: Aplicar**

Run: `npx supabase db push`
Expected: tabela + índices + RLS habilitado.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100001_create_subscriptions_table.sql
git commit -m "feat(plan-limits): create subscriptions table (Stripe-ready)"
```

---

### Task 3: Backfill `subscriptions`

**Files:**
- Create: `supabase/migrations/20260417100002_backfill_subscriptions.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100002_backfill_subscriptions.sql

INSERT INTO public.subscriptions
  (user_id, plan_id, status, current_period_start, current_period_end)
SELECT
  p.user_id,
  p.plan_id,
  'active',
  COALESCE(p.subscription_start::timestamptz, p.created_at) AS period_start,
  COALESCE(p.subscription_start::timestamptz, p.created_at) + interval '30 days' AS period_end
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;
```

- [ ] **Step 2: Aplicar e validar**

Run: `npx supabase db push`

Validar no SQL editor:
```sql
SELECT count(*) FROM subscriptions;  -- deve ser igual a count(*) FROM profiles
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100002_backfill_subscriptions.sql
git commit -m "feat(plan-limits): backfill subscriptions from profiles"
```

---

### Task 4: Criar tabela `usage_overage`

**Files:**
- Create: `supabase/migrations/20260417100003_create_usage_overage_table.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100003_create_usage_overage_table.sql

CREATE TABLE public.usage_overage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  price_cents integer NOT NULL,

  -- TODO(stripe): populado pelo job futuro de reporting para Stripe Meter Events.
  reported_to_stripe_at   timestamptz,
  stripe_usage_record_id  text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_usage_overage_sale ON public.usage_overage(sale_id);
CREATE INDEX idx_usage_overage_user_period
  ON public.usage_overage(user_id, period_start, period_end);
CREATE INDEX idx_usage_overage_unreported
  ON public.usage_overage(subscription_id)
  WHERE reported_to_stripe_at IS NULL;

ALTER TABLE public.usage_overage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own overage"
  ON public.usage_overage FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.usage_overage IS
  'Uma linha por venda aprovada que excedeu o max_sales_monthly. Base para cobrança via Stripe.';
```

- [ ] **Step 2: Aplicar**

Run: `npx supabase db push`
Expected: tabela + 3 índices + RLS.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100003_create_usage_overage_table.sql
git commit -m "feat(plan-limits): create usage_overage table"
```

---

### Task 5: Adicionar `sales.blocked_by_limit`

**Files:**
- Create: `supabase/migrations/20260417100004_sales_add_blocked_by_limit.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100004_sales_add_blocked_by_limit.sql

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS blocked_by_limit boolean NOT NULL DEFAULT false;

-- Index parcial para consultar rapidamente "vendas bloqueadas do usuário".
CREATE INDEX IF NOT EXISTS idx_sales_blocked_by_limit
  ON public.sales(user_id) WHERE blocked_by_limit = true;

COMMENT ON COLUMN public.sales.blocked_by_limit IS
  'Quando true, venda NÃO entra em métricas/receita/atribuição. Usado quando Free excede max_sales_monthly.';
```

- [ ] **Step 2: Aplicar**

Run: `npx supabase db push`
Expected: coluna adicionada + index parcial.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100004_sales_add_blocked_by_limit.sql
git commit -m "feat(plan-limits): add sales.blocked_by_limit column"
```

---

### Task 6: Adicionar archive columns em `workspaces`

**Files:**
- Create: `supabase/migrations/20260417100005_workspaces_add_archive_columns.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100005_workspaces_add_archive_columns.sql

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workspaces_active
  ON public.workspaces(user_id) WHERE archived_at IS NULL;

COMMENT ON COLUMN public.workspaces.archived_at IS
  'Quando NOT NULL, workspace foi arquivado (tipicamente por downgrade). Dados preservados.';
COMMENT ON COLUMN public.workspaces.archived_by_system IS
  'true se foi arquivado pelo auto-trim de downgrade; false se foi manual.';
```

- [ ] **Step 2: Aplicar**

Run: `npx supabase db push`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100005_workspaces_add_archive_columns.sql
git commit -m "feat(plan-limits): add archive columns to workspaces"
```

---

### Task 7: Renomear colunas de `plan_rules`

**Files:**
- Create: `supabase/migrations/20260417100006_rename_plan_rules_columns.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100006_rename_plan_rules_columns.sql

ALTER TABLE public.plan_rules
  RENAME COLUMN max_sales TO max_sales_monthly;

ALTER TABLE public.plan_rules
  RENAME COLUMN max_ad_accounts TO max_active_ad_accounts;

COMMENT ON COLUMN public.plan_rules.max_sales_monthly IS
  'Limite de vendas aprovadas por ciclo de assinatura. -1 = ilimitado.';
COMMENT ON COLUMN public.plan_rules.max_active_ad_accounts IS
  'Limite de ad accounts com is_active=true. -1 = ilimitado.';
```

- [ ] **Step 2: Aplicar**

Run: `npx supabase db push`
Expected: renome metadata-only, rápido.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100006_rename_plan_rules_columns.sql
git commit -m "feat(plan-limits): rename max_sales -> max_sales_monthly and max_ad_accounts -> max_active_ad_accounts"
```

---

### Task 8: Seed dos valores finais dos 5 planos

**Files:**
- Create: `supabase/migrations/20260417100007_seed_plan_rules_values.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100007_seed_plan_rules_values.sql

INSERT INTO public.plan_rules
  (plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations,
   max_workspaces, max_active_rules, overage_price_cents)
VALUES
  ('free',       30,   1,  1,  1,  0,  0),
  ('pro',        1000, 3,  3,  3,  3,  14),
  ('starter',    2500, 7,  7,  7,  7,  12),
  ('enterprise', 5000, -1, -1, -1, -1, 7),
  ('unlimited',  -1,   -1, -1, -1, -1, 0)
ON CONFLICT (plan) DO UPDATE SET
  max_sales_monthly         = EXCLUDED.max_sales_monthly,
  max_active_ad_accounts    = EXCLUDED.max_active_ad_accounts,
  max_checkout_integrations = EXCLUDED.max_checkout_integrations,
  max_workspaces            = EXCLUDED.max_workspaces,
  max_active_rules          = EXCLUDED.max_active_rules,
  overage_price_cents       = EXCLUDED.overage_price_cents,
  updated_at                = now();
```

- [ ] **Step 2: Aplicar e validar**

Run: `npx supabase db push`

Valida no SQL editor:
```sql
SELECT plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations,
       max_workspaces, max_active_rules, overage_price_cents
FROM plan_rules ORDER BY plan;
```

Expected: 5 linhas com valores exatos do spec §1.2.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417100007_seed_plan_rules_values.sql
git commit -m "feat(plan-limits): seed final plan values for all 5 plans"
```

---

### Task 9: Atualizar `plans.service.ts` e `UpdatePlanDto` para os novos nomes

**Files:**
- Modify: `packages/backend/src/modules/plans/plans.service.ts`
- Modify: `packages/backend/src/modules/plans/dto/update-plan.dto.ts`

- [ ] **Step 1: Reescrever `plans.service.ts`**

```typescript
// packages/backend/src/modules/plans/plans.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';

const ALLOWED_FIELDS = [
  'max_sales_monthly',
  'max_active_ad_accounts',
  'max_checkout_integrations',
  'max_workspaces',
  'max_active_rules',
  'overage_price_cents',
] as const;

const SELECT_FIELDS =
  'id, plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations, max_workspaces, max_active_rules, overage_price_cents, updated_at';

const PLAN_RULES_CACHE_KEY = 'plan_rules:list';
const PLAN_RULES_TTL_MS = 60 * 1000;

@Injectable()
export class PlansService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async list() {
    const cached = this.cache.get<any[]>(PLAN_RULES_CACHE_KEY);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select(SELECT_FIELDS)
      .order('plan');

    if (error) throw error;
    this.cache.set(PLAN_RULES_CACHE_KEY, data, PLAN_RULES_TTL_MS);
    return data;
  }

  async getRulesForPlan(plan: string) {
    const cacheKey = `plan_rules:plan:${plan}`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select(SELECT_FIELDS)
      .eq('plan', plan)
      .single();

    if (error) throw error;
    this.cache.set(cacheKey, data, PLAN_RULES_TTL_MS);
    return data;
  }

  async getRulesForPlanId(planId: string) {
    const cacheKey = `plan_rules:id:${planId}`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select(SELECT_FIELDS)
      .eq('id', planId)
      .single();

    if (error) throw error;
    this.cache.set(cacheKey, data, PLAN_RULES_TTL_MS);
    return data;
  }

  async update(plan: string, updates: Record<string, unknown>) {
    if (!plan || !updates) {
      throw new BadRequestException('plan and updates required');
    }

    const safeUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const key of ALLOWED_FIELDS) {
      if (updates[key] !== undefined) {
        safeUpdates[key] = updates[key];
      }
    }

    const { error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .update(safeUpdates)
      .eq('plan', plan);

    if (error) throw error;
    this.cache.invalidateByPrefix('plan_rules:');
    return { success: true };
  }
}
```

- [ ] **Step 2: Reescrever `update-plan.dto.ts`**

```typescript
// packages/backend/src/modules/plans/dto/update-plan.dto.ts
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional() @IsInt() @Min(-1)
  max_sales_monthly?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_active_ad_accounts?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_checkout_integrations?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_workspaces?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_active_rules?: number;

  @IsOptional() @IsInt() @Min(0)
  overage_price_cents?: number;
}
```

- [ ] **Step 3: Rodar testes existentes do PlansService**

Run: `npm test -- plans.service.spec.ts`
Expected: PASS (ou FAIL se o spec antigo referencia nomes antigos — atualize o spec também).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/plans/
git commit -m "refactor(plans): update service and DTO to new column names"
```

---

### Task 10: Atualizar `SQL_DATABASE.md`

**Files:**
- Modify: `SQL_DATABASE.md`

- [ ] **Step 1: Localizar e atualizar blocos**

Ache o bloco `CREATE TABLE public.plan_rules` e substitua as colunas removidas/renomeadas por:

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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT plan_rules_pkey PRIMARY KEY (id)
);
```

No bloco `workspaces`, adicione as colunas `archived_at timestamptz` e `archived_by_system boolean NOT NULL DEFAULT false`.

No bloco `sales`, adicione `blocked_by_limit boolean NOT NULL DEFAULT false`.

Adicione os dois blocos novos `subscriptions` e `usage_overage` (usando os mesmos SQL das Tasks 2 e 4).

- [ ] **Step 2: Commit**

```bash
git add SQL_DATABASE.md
git commit -m "docs(sql): update schema reference after plan-limits refactor"
```

---

## Phase 2 — `PlanLimitsService` core

### Task 11: Criar `PlanLimitExceededException`

**Files:**
- Create: `packages/backend/src/modules/plan-limits/plan-limit-exceeded.exception.ts`

- [ ] **Step 1: Escrever a exception**

```typescript
// packages/backend/src/modules/plan-limits/plan-limit-exceeded.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export type PlanLimitResource =
  | 'workspace'
  | 'ad_account'
  | 'integration'
  | 'active_rule';

export interface PlanLimitExceededDetail {
  resource: PlanLimitResource;
  current: number;
  limit: number;
  plan: string;
}

export class PlanLimitExceededException extends HttpException {
  constructor(public readonly detail: PlanLimitExceededDetail) {
    super(
      { message: 'Plan limit exceeded', ...detail },
      HttpStatus.PAYMENT_REQUIRED, // 402
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/modules/plan-limits/plan-limit-exceeded.exception.ts
git commit -m "feat(plan-limits): add PlanLimitExceededException (HTTP 402)"
```

---

### Task 12: `PlanLimitsService.resolveUserPlan` + testes

**Files:**
- Create: `packages/backend/src/modules/plan-limits/plan-limits.service.ts`
- Create: `packages/backend/src/modules/plan-limits/plan-limits.module.ts`
- Create: `packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts`
- Modify: `packages/backend/src/app.module.ts`

- [ ] **Step 1: Escrever teste que falha**

```typescript
// packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PlanLimitsService } from '../plan-limits.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { CacheService } from '../../../shared/services/cache.service';

describe('PlanLimitsService', () => {
  let service: PlanLimitsService;
  let supabaseMock: any;

  beforeEach(async () => {
    const plan = {
      id: 'plan-pro-id', plan: 'pro',
      max_sales_monthly: 1000, max_active_ad_accounts: 3,
      max_checkout_integrations: 3, max_workspaces: 3,
      max_active_rules: 3, overage_price_cents: 14,
    };
    const subscription = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end: '2026-05-01T00:00:00Z',
    };

    supabaseMock = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'subscriptions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: subscription, error: null }),
                }),
              }),
            };
          }
          if (table === 'plan_rules') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({ data: plan, error: null }),
                }),
              }),
            };
          }
          return {};
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanLimitsService,
        { provide: SupabaseService, useValue: supabaseMock },
        CacheService,
      ],
    }).compile();

    service = module.get(PlanLimitsService);
  });

  it('resolves plan and subscription for a user', async () => {
    const resolved = await (service as any).resolveUserPlan('user-1');
    expect(resolved.plan.plan).toBe('pro');
    expect(resolved.subscription.id).toBe('sub-1');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- plan-limits.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o service**

```typescript
// packages/backend/src/modules/plan-limits/plan-limits.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';
import {
  PlanLimitExceededException,
  PlanLimitResource,
} from './plan-limit-exceeded.exception';

const CACHE_TTL_PLAN_MS = 30_000;
const CACHE_TTL_COUNTS_MS = 10_000;

interface ResolvedPlan {
  subscription: {
    id: string;
    user_id: string;
    plan_id: string;
    current_period_start: string;
    current_period_end: string;
  };
  plan: {
    id: string;
    plan: string;
    max_sales_monthly: number;
    max_active_ad_accounts: number;
    max_checkout_integrations: number;
    max_workspaces: number;
    max_active_rules: number;
    overage_price_cents: number;
  };
}

@Injectable()
export class PlanLimitsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private async resolveUserPlan(userId: string): Promise<ResolvedPlan> {
    const cacheKey = `plan_limits:user:${userId}:plan`;
    const cached = this.cache.get<ResolvedPlan>(cacheKey);
    if (cached) return cached;

    const client = this.supabase.getClient();

    const { data: subscription, error: subErr } = await client
      .from('subscriptions')
      .select('id, user_id, plan_id, current_period_start, current_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!subscription) throw new Error(`No subscription for user ${userId}`);

    const { data: plan, error: planErr } = await client
      .from('plan_rules')
      .select(
        'id, plan, max_sales_monthly, max_active_ad_accounts, max_checkout_integrations, max_workspaces, max_active_rules, overage_price_cents',
      )
      .eq('id', subscription.plan_id)
      .single();
    if (planErr) throw planErr;

    const resolved: ResolvedPlan = {
      subscription: subscription as any,
      plan: plan as any,
    };
    this.cache.set(cacheKey, resolved, CACHE_TTL_PLAN_MS);
    return resolved;
  }

  async invalidate(userId: string): Promise<void> {
    this.cache.invalidateByPrefix(`plan_limits:user:${userId}`);
  }
}
```

- [ ] **Step 4: Rodar teste**

Run: `npm test -- plan-limits.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Criar module e registrar**

```typescript
// packages/backend/src/modules/plan-limits/plan-limits.module.ts
import { Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';

@Module({
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}
```

Em `packages/backend/src/app.module.ts`, adicione `PlanLimitsModule` aos imports:

```typescript
import { PlanLimitsModule } from './modules/plan-limits/plan-limits.module';
// dentro de @Module({ imports: [...] }):
PlanLimitsModule,
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/plan-limits/ packages/backend/src/app.module.ts
git commit -m "feat(plan-limits): add PlanLimitsService with resolveUserPlan + invalidate"
```

---

### Task 13: `countActive` + `countBlockedSales` + `getOverageTotals`

**Files:**
- Modify: `packages/backend/src/modules/plan-limits/plan-limits.service.ts`
- Modify: `packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts`

- [ ] **Step 1: Teste que falha**

Adicione ao spec:

```typescript
  it('countActive returns counts per resource for the user', async () => {
    supabaseMock.getClient = () => ({
      from: (table: string) => {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          gte: () => builder,
          lt: () => builder,
          then: async (resolve: any) => {
            const countsByTable: Record<string, number> = {
              workspaces: 2,
              facebook_connections: 3,
              checkout_integrations: 1,
              automation_rules: 0,
              sales: 42,
            };
            resolve({ count: countsByTable[table] ?? 0, error: null });
          },
        };
        return builder;
      },
    });

    const counts = await (service as any).countActive('user-1', {
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
    });

    expect(counts).toEqual({
      workspaces: 2,
      ad_accounts: 3,
      integrations: 1,
      rules: 0,
      sales: 42,
    });
  });
```

- [ ] **Step 2: Rodar e falhar**

Run: `npm test -- plan-limits.service.spec.ts -t "countActive"`
Expected: FAIL.

- [ ] **Step 3: Adicionar métodos ao service**

```typescript
  private async countActive(
    userId: string,
    period: { current_period_start: string; current_period_end: string },
  ): Promise<{
    workspaces: number;
    ad_accounts: number;
    integrations: number;
    rules: number;
    sales: number;
  }> {
    const cacheKey = `plan_limits:user:${userId}:counts`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const client = this.supabase.getClient();

    const [workspaces, adAccounts, integrations, rules, sales] = await Promise.all([
      client
        .from('workspaces')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('archived_at', null),
      client
        .from('facebook_connections')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_active', true),
      client
        .from('checkout_integrations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      client
        .from('automation_rules')
        .select('*, workspaces!inner(user_id, archived_at)', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('workspaces.user_id', userId)
        .is('workspaces.archived_at', null),
      client
        .from('sales')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'approved')
        .eq('blocked_by_limit', false)
        .gte('sold_at', period.current_period_start)
        .lt('sold_at', period.current_period_end),
    ]);

    const counts = {
      workspaces: workspaces.count ?? 0,
      ad_accounts: adAccounts.count ?? 0,
      integrations: integrations.count ?? 0,
      rules: rules.count ?? 0,
      sales: sales.count ?? 0,
    };
    this.cache.set(cacheKey, counts, CACHE_TTL_COUNTS_MS);
    return counts;
  }

  private async countBlockedSales(
    userId: string,
    period: { current_period_start: string; current_period_end: string },
  ): Promise<number> {
    const { count } = await this.supabase.getClient()
      .from('sales')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'approved')
      .eq('blocked_by_limit', true)
      .gte('sold_at', period.current_period_start)
      .lt('sold_at', period.current_period_end);
    return count ?? 0;
  }

  private async getOverageTotals(
    userId: string,
    period: { current_period_start: string; current_period_end: string },
  ): Promise<{ count: number; totalCents: number }> {
    const { data, error } = await this.supabase.getClient()
      .from('usage_overage')
      .select('price_cents')
      .eq('user_id', userId)
      .gte('period_start', period.current_period_start)
      .lt('period_end', period.current_period_end);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ price_cents: number }>;
    return {
      count: rows.length,
      totalCents: rows.reduce((sum, r) => sum + r.price_cents, 0),
    };
  }
```

- [ ] **Step 4: Rodar testes**

Run: `npm test -- plan-limits.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/plan-limits/
git commit -m "feat(plan-limits): add countActive, countBlockedSales, getOverageTotals"
```

---

### Task 14: Assertions (`assertCanCreateWorkspace` etc.)

**Files:**
- Modify: `packages/backend/src/modules/plan-limits/plan-limits.service.ts`
- Modify: `packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts`

- [ ] **Step 1: Testes que falham**

```typescript
  it('assertCanCreateWorkspace throws 402 when limit reached', async () => {
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: { id: 'sub-1' },
      plan: { plan: 'pro', max_workspaces: 3 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 3, ad_accounts: 0, integrations: 0, rules: 0, sales: 0,
    });

    await expect(service.assertCanCreateWorkspace('user-1')).rejects.toMatchObject({
      detail: { resource: 'workspace', current: 3, limit: 3, plan: 'pro' },
    });
  });

  it('assertCanCreateWorkspace passes when plan is unlimited (-1)', async () => {
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: { id: 'sub-1' },
      plan: { plan: 'unlimited', max_workspaces: -1 },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 99, ad_accounts: 0, integrations: 0, rules: 0, sales: 0,
    });

    await expect(service.assertCanCreateWorkspace('user-1')).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: Rodar e falhar**

Run: `npm test -- plan-limits.service.spec.ts -t "assertCanCreateWorkspace"`
Expected: FAIL.

- [ ] **Step 3: Implementar no service**

```typescript
  async assertCanCreateWorkspace(userId: string): Promise<void> {
    await this.assertLimit(userId, 'workspace', 'workspaces', 'max_workspaces');
  }

  async assertCanCreateIntegration(userId: string): Promise<void> {
    await this.assertLimit(userId, 'integration', 'integrations', 'max_checkout_integrations');
  }

  async assertCanActivateAdAccount(userId: string, _adAccountId: string): Promise<void> {
    await this.assertLimit(userId, 'ad_account', 'ad_accounts', 'max_active_ad_accounts');
  }

  async assertCanActivateRule(userId: string, _ruleId: string): Promise<void> {
    await this.assertLimit(userId, 'active_rule', 'rules', 'max_active_rules');
  }

  private async assertLimit(
    userId: string,
    resource: PlanLimitResource,
    countKey: 'workspaces' | 'ad_accounts' | 'integrations' | 'rules',
    planField: 'max_workspaces' | 'max_checkout_integrations' | 'max_active_ad_accounts' | 'max_active_rules',
  ): Promise<void> {
    const { plan, subscription } = await this.resolveUserPlan(userId);
    const limit = (plan as any)[planField] as number;
    if (limit === -1) return;
    const counts = await this.countActive(userId, subscription);
    const current = counts[countKey];
    if (current >= limit) {
      throw new PlanLimitExceededException({
        resource,
        current,
        limit,
        plan: plan.plan,
      });
    }
  }
```

- [ ] **Step 4: Rodar testes**

Run: `npm test -- plan-limits.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/plan-limits/
git commit -m "feat(plan-limits): add assertion methods for workspace/integration/ad_account/rule"
```

---

### Task 15: `checkSaleAcceptance`

**Files:**
- Modify: `packages/backend/src/modules/plan-limits/plan-limits.service.ts`
- Modify: `packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts`

- [ ] **Step 1: Testes que falham (4 cenários)**

```typescript
  describe('checkSaleAcceptance', () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
    };

    it('allowed without overage when within limit', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'pro', max_sales_monthly: 1000, overage_price_cents: 14 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 500,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: false, overage: false,
        subscriptionId: 'sub-1',
      });
    });

    it('overage when paid plan exceeds limit', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'pro', max_sales_monthly: 1000, overage_price_cents: 14 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 1000,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: false, overage: true, pricePerSaleCents: 14,
      });
    });

    it('blocked_by_limit when Free exceeds', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'free', max_sales_monthly: 30, overage_price_cents: 0 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 30,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: true, overage: false,
      });
    });

    it('allowed when plan is unlimited (-1)', async () => {
      jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
        subscription: sub,
        plan: { plan: 'unlimited', max_sales_monthly: -1, overage_price_cents: 0 },
      });
      jest.spyOn(service as any, 'countActive').mockResolvedValue({
        workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0, sales: 99_999,
      });

      const result = await service.checkSaleAcceptance('user-1');
      expect(result).toMatchObject({
        allowed: true, blocked_by_limit: false, overage: false,
      });
    });
  });
```

- [ ] **Step 2: Rodar e falhar**

Run: `npm test -- plan-limits.service.spec.ts -t "checkSaleAcceptance"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
export type SaleDecision =
  | { allowed: true; blocked_by_limit: false; overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: false; overage: true; pricePerSaleCents: number;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: true; overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string };

  async checkSaleAcceptance(userId: string): Promise<SaleDecision> {
    const { plan, subscription } = await this.resolveUserPlan(userId);

    const base = {
      subscriptionId: subscription.id,
      periodStart: subscription.current_period_start,
      periodEnd: subscription.current_period_end,
    };

    if (plan.max_sales_monthly === -1) {
      return { ...base, allowed: true, blocked_by_limit: false, overage: false };
    }

    const counts = await this.countActive(userId, subscription);

    if (counts.sales < plan.max_sales_monthly) {
      return { ...base, allowed: true, blocked_by_limit: false, overage: false };
    }

    // Acima do limite — Free bloqueia; pagos caem em overage.
    if (plan.overage_price_cents === 0) {
      return { ...base, allowed: true, blocked_by_limit: true, overage: false };
    }

    return {
      ...base,
      allowed: true,
      blocked_by_limit: false,
      overage: true,
      pricePerSaleCents: plan.overage_price_cents,
    };
  }
```

- [ ] **Step 4: Rodar testes**

Run: `npm test -- plan-limits.service.spec.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/plan-limits/
git commit -m "feat(plan-limits): add checkSaleAcceptance decision logic"
```

---

### Task 16: `getUsageSnapshot`

**Files:**
- Modify: `packages/backend/src/modules/plan-limits/plan-limits.service.ts`
- Modify: `packages/backend/src/modules/plan-limits/__tests__/plan-limits.service.spec.ts`

- [ ] **Step 1: Teste que falha**

```typescript
  it('getUsageSnapshot returns used/limit/blocked/overage', async () => {
    const sub = {
      id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro-id',
      current_period_start: '2026-04-01T00:00:00Z',
      current_period_end:   '2026-05-01T00:00:00Z',
    };
    jest.spyOn(service as any, 'resolveUserPlan').mockResolvedValue({
      subscription: sub,
      plan: {
        plan: 'pro',
        max_sales_monthly: 1000, max_active_ad_accounts: 3,
        max_checkout_integrations: 3, max_workspaces: 3,
        max_active_rules: 3, overage_price_cents: 14,
      },
    });
    jest.spyOn(service as any, 'countActive').mockResolvedValue({
      workspaces: 2, ad_accounts: 3, integrations: 1, rules: 0, sales: 500,
    });
    jest.spyOn(service as any, 'countBlockedSales').mockResolvedValue(0);
    jest.spyOn(service as any, 'getOverageTotals').mockResolvedValue({ count: 12, totalCents: 168 });

    const snap = await service.getUsageSnapshot('user-1');
    expect(snap).toEqual({
      plan: 'pro',
      period: { start: '2026-04-01T00:00:00Z', end: '2026-05-01T00:00:00Z' },
      sales:        { used: 500, limit: 1000, blocked: 0 },
      workspaces:   { used: 2, limit: 3 },
      adAccounts:   { used: 3, limit: 3 },
      integrations: { used: 1, limit: 3 },
      activeRules:  { used: 0, limit: 3 },
      overage:      { count: 12, totalCents: 168 },
    });
  });
```

- [ ] **Step 2: Falhar**

Run: `npm test -- plan-limits.service.spec.ts -t "getUsageSnapshot"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

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
}

  async getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
    const { plan, subscription } = await this.resolveUserPlan(userId);
    const [counts, blocked, overageTotals] = await Promise.all([
      this.countActive(userId, subscription),
      this.countBlockedSales(userId, subscription),
      this.getOverageTotals(userId, subscription),
    ]);

    return {
      plan: plan.plan,
      period: {
        start: subscription.current_period_start,
        end: subscription.current_period_end,
      },
      sales:        { used: counts.sales, limit: plan.max_sales_monthly, blocked },
      workspaces:   { used: counts.workspaces, limit: plan.max_workspaces },
      adAccounts:   { used: counts.ad_accounts, limit: plan.max_active_ad_accounts },
      integrations: { used: counts.integrations, limit: plan.max_checkout_integrations },
      activeRules:  { used: counts.rules, limit: plan.max_active_rules },
      overage:      overageTotals,
    };
  }
```

- [ ] **Step 4: Testar**

Run: `npm test -- plan-limits.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/plan-limits/
git commit -m "feat(plan-limits): add getUsageSnapshot"
```

---

### Task 17: `PlanLimitsController` — `GET /plan-limits/usage`

**Files:**
- Create: `packages/backend/src/modules/plan-limits/plan-limits.controller.ts`
- Create: `packages/backend/src/modules/plan-limits/__tests__/plan-limits.controller.spec.ts`
- Modify: `packages/backend/src/modules/plan-limits/plan-limits.module.ts`

- [ ] **Step 1: Teste que falha**

```typescript
// packages/backend/src/modules/plan-limits/__tests__/plan-limits.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PlanLimitsController } from '../plan-limits.controller';
import { PlanLimitsService } from '../plan-limits.service';

describe('PlanLimitsController', () => {
  let controller: PlanLimitsController;
  let service: { getUsageSnapshot: jest.Mock };

  beforeEach(async () => {
    service = { getUsageSnapshot: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanLimitsController],
      providers: [{ provide: PlanLimitsService, useValue: service }],
    }).compile();
    controller = module.get(PlanLimitsController);
  });

  it('GET /plan-limits/usage returns snapshot', async () => {
    const snap = { plan: 'pro' } as any;
    service.getUsageSnapshot.mockResolvedValue(snap);
    const result = await controller.getUsage('user-1');
    expect(service.getUsageSnapshot).toHaveBeenCalledWith('user-1');
    expect(result).toBe(snap);
  });
});
```

- [ ] **Step 2: Falhar**

Run: `npm test -- plan-limits.controller.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar controller**

```typescript
// packages/backend/src/modules/plan-limits/plan-limits.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlanLimitsService } from './plan-limits.service';

@UseGuards(AuthGuard)
@Controller('plan-limits')
export class PlanLimitsController {
  constructor(private readonly planLimits: PlanLimitsService) {}

  @Get('usage')
  async getUsage(@CurrentUser('sub') userId: string) {
    return this.planLimits.getUsageSnapshot(userId);
  }
}
```

Atualize o módulo:

```typescript
// packages/backend/src/modules/plan-limits/plan-limits.module.ts
import { Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';
import { PlanLimitsController } from './plan-limits.controller';

@Module({
  controllers: [PlanLimitsController],
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}
```

- [ ] **Step 4: Rodar testes**

Run: `npm test -- plan-limits.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/plan-limits/
git commit -m "feat(plan-limits): expose GET /plan-limits/usage endpoint"
```

---

## Phase 3 — RPC `apply_plan_change` + `SubscriptionsService`

### Task 18: RPC `apply_plan_change` (SQL)

**Files:**
- Create: `supabase/migrations/20260417100008_rpc_apply_plan_change.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/20260417100008_rpc_apply_plan_change.sql
--
-- Função atômica que aplica troca de plano. Chamada por:
--   (a) Admin UI: PATCH /api/admin/users/:id/plan
--   (b) TODO(stripe): handler de customer.subscription.updated
--
-- Na mesma transação executa:
--   1. Upgrade em max_sales_monthly: libera blocked_by_limit dos últimos 30 dias
--   2. Qualquer tightening: auto-trim (heurística por recurso)
--   3. Atualiza subscriptions (novo plano, período +30d) e profiles.plan_id
--
-- Retorna JSONB: { unblocked_sales, trimmed: {workspaces, ad_accounts, integrations, rules}, old_plan, new_plan }

CREATE OR REPLACE FUNCTION public.apply_plan_change(
  p_user_id      uuid,
  p_new_plan_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_plan RECORD;
  v_new_plan RECORD;
  v_unblocked_count int := 0;
  v_trim_ws    int := 0;
  v_trim_ads   int := 0;
  v_trim_ints  int := 0;
  v_trim_rules int := 0;
BEGIN
  -- Lock da subscription do usuário (evita race durante mudança concorrente)
  PERFORM 1 FROM public.subscriptions WHERE user_id = p_user_id FOR UPDATE;

  SELECT pr.* INTO v_new_plan
  FROM public.plan_rules pr WHERE pr.id = p_new_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan % not found', p_new_plan_id;
  END IF;

  SELECT pr.* INTO v_old_plan
  FROM public.subscriptions s
  JOIN public.plan_rules pr ON pr.id = s.plan_id
  WHERE s.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found for user %', p_user_id;
  END IF;

  -- 1. Upgrade em vendas: libera bloqueadas dos últimos 30 dias.
  IF v_new_plan.max_sales_monthly > v_old_plan.max_sales_monthly
     OR v_new_plan.max_sales_monthly = -1 THEN
    WITH unblocked AS (
      UPDATE public.sales
      SET blocked_by_limit = false
      WHERE user_id = p_user_id
        AND blocked_by_limit = true
        AND sold_at >= now() - interval '30 days'
      RETURNING 1
    )
    SELECT count(*) INTO v_unblocked_count FROM unblocked;
  END IF;

  -- 2. Auto-trim workspaces: mantém N de maior receita no último ciclo; tiebreaker created_at DESC.
  IF v_new_plan.max_workspaces <> -1 THEN
    WITH ranked AS (
      SELECT w.id,
             ROW_NUMBER() OVER (
               ORDER BY COALESCE((
                 SELECT SUM(s.amount)
                 FROM public.sales s
                 WHERE s.workspace_id = w.id
                   AND s.status = 'approved'
                   AND s.blocked_by_limit = false
                   AND s.sold_at >= (now() - interval '30 days')
               ), 0) DESC,
               w.created_at DESC
             ) AS rn
      FROM public.workspaces w
      WHERE w.user_id = p_user_id AND w.archived_at IS NULL
    ),
    to_archive AS (
      SELECT id FROM ranked WHERE rn > v_new_plan.max_workspaces
    ),
    archived AS (
      UPDATE public.workspaces
      SET archived_at = now(), archived_by_system = true
      WHERE id IN (SELECT id FROM to_archive)
      RETURNING 1
    )
    SELECT count(*) INTO v_trim_ws FROM archived;
  END IF;

  -- 3. Auto-trim facebook_connections ativas: tiebreaker created_at DESC (mantém mais recentes).
  IF v_new_plan.max_active_ad_accounts <> -1 THEN
    WITH ranked AS (
      SELECT fc.id,
             ROW_NUMBER() OVER (ORDER BY fc.created_at DESC) AS rn
      FROM public.facebook_connections fc
      WHERE fc.user_id = p_user_id AND fc.is_active = true
    ),
    to_deact AS (
      SELECT id FROM ranked WHERE rn > v_new_plan.max_active_ad_accounts
    ),
    deactivated AS (
      UPDATE public.facebook_connections
      SET is_active = false, updated_at = now()
      WHERE id IN (SELECT id FROM to_deact)
      RETURNING 1
    )
    SELECT count(*) INTO v_trim_ads FROM deactivated;
  END IF;

  -- 4. Auto-trim checkout_integrations: mantém por vendas aprovadas no último ciclo.
  IF v_new_plan.max_checkout_integrations <> -1 THEN
    WITH ranked AS (
      SELECT ci.id,
             ROW_NUMBER() OVER (
               ORDER BY COALESCE((
                 SELECT COUNT(*) FROM public.sales s
                 WHERE s.integration_id = ci.id
                   AND s.status = 'approved'
                   AND s.blocked_by_limit = false
                   AND s.sold_at >= (now() - interval '30 days')
               ), 0) DESC,
               ci.created_at DESC
             ) AS rn
      FROM public.checkout_integrations ci
      JOIN public.workspaces w ON w.id = ci.workspace_id
      WHERE ci.user_id = p_user_id AND w.archived_at IS NULL
    ),
    to_deact AS (
      SELECT id FROM ranked WHERE rn > v_new_plan.max_checkout_integrations
    ),
    deactivated AS (
      UPDATE public.checkout_integrations
      SET is_active = false, updated_at = now()
      WHERE id IN (SELECT id FROM to_deact)
      RETURNING 1
    )
    SELECT count(*) INTO v_trim_ints FROM deactivated;
  END IF;

  -- 5. Auto-trim automation_rules ativas: ordena por last_executed_at DESC NULLS LAST.
  IF v_new_plan.max_active_rules <> -1 THEN
    WITH ranked AS (
      SELECT ar.id,
             ROW_NUMBER() OVER (
               ORDER BY ar.last_executed_at DESC NULLS LAST, ar.created_at DESC
             ) AS rn
      FROM public.automation_rules ar
      JOIN public.workspaces w ON w.id = ar.workspace_id
      WHERE w.user_id = p_user_id
        AND ar.is_active = true
        AND w.archived_at IS NULL
    ),
    to_deact AS (
      SELECT id FROM ranked WHERE rn > v_new_plan.max_active_rules
    ),
    deactivated AS (
      UPDATE public.automation_rules
      SET is_active = false, updated_at = now()
      WHERE id IN (SELECT id FROM to_deact)
      RETURNING 1
    )
    SELECT count(*) INTO v_trim_rules FROM deactivated;
  END IF;

  -- 6. Atualiza subscription.
  -- TODO(stripe): quando chamado pelo webhook Stripe, substituir now() + 30d por
  -- valores vindos do payload (current_period_start/end do evento).
  UPDATE public.subscriptions
  SET plan_id               = p_new_plan_id,
      current_period_start  = now(),
      current_period_end    = now() + interval '30 days',
      scheduled_plan_id     = NULL,
      scheduled_changes_at  = NULL,
      updated_at            = now()
  WHERE user_id = p_user_id;

  -- 7. Sincroniza profiles.plan_id (valor derivado).
  UPDATE public.profiles
  SET plan_id = p_new_plan_id, updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'unblocked_sales', v_unblocked_count,
    'trimmed', jsonb_build_object(
      'workspaces',   v_trim_ws,
      'ad_accounts',  v_trim_ads,
      'integrations', v_trim_ints,
      'rules',        v_trim_rules
    ),
    'old_plan', v_old_plan.plan,
    'new_plan', v_new_plan.plan
  );
END;
$$;

COMMENT ON FUNCTION public.apply_plan_change IS
  'Aplica troca de plano atomicamente: unblock sales + auto-trim + update subscription + update profile.';
```

- [ ] **Step 2: Aplicar**

Run: `npx supabase db push`
Expected: função criada sem erro.

- [ ] **Step 3: Smoke test manual via SQL**

```sql
-- Pegue um user de teste e troque plano dele.
SELECT public.apply_plan_change(
  (SELECT user_id FROM profiles LIMIT 1),
  (SELECT id FROM plan_rules WHERE plan = 'free')
);
-- Retorno esperado: JSONB com contadores.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417100008_rpc_apply_plan_change.sql
git commit -m "feat(plan-limits): add apply_plan_change RPC (atomic transition)"
```

---

### Task 19: `SubscriptionsService.applyPlanChange` (wrapper TS)

**Files:**
- Create: `packages/backend/src/modules/subscriptions/subscriptions.service.ts`
- Create: `packages/backend/src/modules/subscriptions/subscriptions.module.ts`
- Create: `packages/backend/src/modules/subscriptions/__tests__/subscriptions.service.spec.ts`
- Modify: `packages/backend/src/app.module.ts`

- [ ] **Step 1: Teste que falha**

```typescript
// packages/backend/src/modules/subscriptions/__tests__/subscriptions.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from '../subscriptions.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { PlanLimitsService } from '../../plan-limits/plan-limits.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let rpcMock: jest.Mock;
  let planLimits: { invalidate: jest.Mock };
  let discord: { logApiError: jest.Mock };

  beforeEach(async () => {
    rpcMock = jest.fn().mockResolvedValue({
      data: {
        unblocked_sales: 5,
        trimmed: { workspaces: 1, ad_accounts: 0, integrations: 0, rules: 0 },
        old_plan: 'pro', new_plan: 'free',
      },
      error: null,
    });
    planLimits = { invalidate: jest.fn().mockResolvedValue(undefined) };
    discord = { logApiError: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SupabaseService, useValue: { getClient: () => ({ rpc: rpcMock }) } },
        { provide: PlanLimitsService, useValue: planLimits },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  it('applyPlanChange calls RPC and invalidates cache', async () => {
    const result = await service.applyPlanChange('user-1', 'plan-free');
    expect(rpcMock).toHaveBeenCalledWith('apply_plan_change', {
      p_user_id: 'user-1',
      p_new_plan_id: 'plan-free',
    });
    expect(planLimits.invalidate).toHaveBeenCalledWith('user-1');
    expect(result.trimmed.workspaces).toBe(1);
    expect(result.unblocked_sales).toBe(5);
  });

  it('throws when RPC returns error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(service.applyPlanChange('user-1', 'plan-free')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Rodar e falhar**

Run: `npm test -- subscriptions.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar service e módulo**

```typescript
// packages/backend/src/modules/subscriptions/subscriptions.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { PlanLimitsService } from '../plan-limits/plan-limits.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';

export interface ApplyPlanChangeResult {
  unblocked_sales: number;
  trimmed: {
    workspaces: number;
    ad_accounts: number;
    integrations: number;
    rules: number;
  };
  old_plan: string;
  new_plan: string;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly planLimits: PlanLimitsService,
    private readonly discord: DiscordLoggerService,
  ) {}

  // TODO(stripe): o handler de customer.subscription.updated também chama este método.
  // Adicionar parâmetros opcionais period_start/period_end vindos do payload Stripe
  // (hoje o RPC usa now() + 30d fixo).
  async applyPlanChange(userId: string, newPlanId: string): Promise<ApplyPlanChangeResult> {
    const { data, error } = await this.supabase
      .getClient()
      .rpc('apply_plan_change', {
        p_user_id: userId,
        p_new_plan_id: newPlanId,
      });

    if (error) {
      this.discord.logApiError({
        endpoint: 'apply_plan_change',
        error: error.message,
        userId,
      } as any);
      throw new Error(error.message);
    }

    await this.planLimits.invalidate(userId);
    return data as ApplyPlanChangeResult;
  }
}
```

```typescript
// packages/backend/src/modules/subscriptions/subscriptions.module.ts
import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';

@Module({
  imports: [PlanLimitsModule],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
```

Em `app.module.ts` acrescente `SubscriptionsModule` ao imports.

- [ ] **Step 4: Rodar testes**

Run: `npm test -- subscriptions.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/subscriptions/ packages/backend/src/app.module.ts
git commit -m "feat(subscriptions): add SubscriptionsService.applyPlanChange"
```

---

## Phase 4 — Wire enforcement into existing services

### Task 20: `WorkspacesService.create` enforce + filtrar archived

**Files:**
- Modify: `packages/backend/src/modules/workspaces/workspaces.service.ts`
- Modify: `packages/backend/src/modules/workspaces/workspaces.module.ts`
- Modify: `packages/backend/src/modules/workspaces/__tests__/workspaces.service.spec.ts` (crie se não existir)

- [ ] **Step 1: Ler código atual**

Run: `cat packages/backend/src/modules/workspaces/workspaces.service.ts`

- [ ] **Step 2: Teste que falha**

```typescript
  it('create() delegates to planLimits.assertCanCreateWorkspace and invalidates', async () => {
    const assertMock = jest.fn().mockResolvedValue(undefined);
    const invalidateMock = jest.fn().mockResolvedValue(undefined);
    (service as any).planLimits = {
      assertCanCreateWorkspace: assertMock,
      invalidate: invalidateMock,
    };
    // supabase mock para insert OK (ajustar conforme padrão existente do spec)
    await service.create('user-1', { name: 'New WS' } as any);
    expect(assertMock).toHaveBeenCalledWith('user-1');
    expect(invalidateMock).toHaveBeenCalledWith('user-1');
  });
```

- [ ] **Step 3: Falhar**

Run: `npm test -- workspaces.service.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Modificar service**

```typescript
import { PlanLimitsService } from '../plan-limits/plan-limits.service';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly planLimits: PlanLimitsService,
    // ... demais deps existentes
  ) {}

  async create(userId: string, dto: { name: string }) {
    await this.planLimits.assertCanCreateWorkspace(userId);

    const { data, error } = await this.supabase.getClient()
      .from('workspaces')
      .insert({ user_id: userId, name: dto.name })
      .select()
      .single();
    if (error) throw error;

    await this.planLimits.invalidate(userId);
    return data;
  }

  async listByUser(userId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('workspaces')
      .select('id, name, created_at, updated_at')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  }

  async listArchivedByUser(userId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('workspaces')
      .select('id, name, archived_at, archived_by_system')
      .eq('user_id', userId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    if (error) throw error;
    return data;
  }
}
```

Em `workspaces.module.ts`:

```typescript
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';

@Module({
  imports: [PlanLimitsModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
```

- [ ] **Step 5: Testar**

Run: `npm test -- workspaces.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/workspaces/
git commit -m "feat(workspaces): enforce plan limit on create + filter archived on list"
```

---

### Task 21: Substituir validação inline em `IntegrationsService`

**Files:**
- Modify: `packages/backend/src/modules/integrations/integrations.service.ts`
- Modify: `packages/backend/src/modules/integrations/integrations.module.ts`

- [ ] **Step 1: Ler bloco atual**

Run: `sed -n '30,65p' packages/backend/src/modules/integrations/integrations.service.ts`

- [ ] **Step 2: Teste**

```typescript
  it('create() calls planLimits.assertCanCreateIntegration and invalidates', async () => {
    const assertMock = jest.fn().mockResolvedValue(undefined);
    const invalidateMock = jest.fn().mockResolvedValue(undefined);
    (service as any).planLimits = {
      assertCanCreateIntegration: assertMock,
      invalidate: invalidateMock,
    };
    // ... mocks supabase padrão do spec
    await service.create('user-1', { workspace_id: 'ws-1', platform: 'kiwify' } as any);
    expect(assertMock).toHaveBeenCalledWith('user-1');
    expect(invalidateMock).toHaveBeenCalledWith('user-1');
  });
```

- [ ] **Step 3: Substituir validação inline**

Localize o bloco de linhas ~34-61 em `integrations.service.ts` (a validação manual de `max_checkout_integrations`). Remova completamente e substitua o método `create` por:

```typescript
import { PlanLimitsService } from '../plan-limits/plan-limits.service';

constructor(
  private readonly supabase: SupabaseService,
  private readonly planLimits: PlanLimitsService,
  // ... demais deps
) {}

async create(userId: string, dto: CreateIntegrationDto) {
  await this.planLimits.assertCanCreateIntegration(userId);

  // ... preservar resto do método original (insert com webhook_secret, name, platform, etc.)
  // Ao final:

  await this.planLimits.invalidate(userId);
  return data;
}
```

Em `integrations.module.ts`, adicione `PlanLimitsModule` aos imports.

- [ ] **Step 4: Testar**

Run: `npm test -- integrations.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/integrations/
git commit -m "refactor(integrations): use PlanLimitsService for checkout limit"
```

---

### Task 22: Substituir validação inline em `AutomationRulesService`

**Files:**
- Modify: `packages/backend/src/modules/automation-rules/automation-rules.service.ts`
- Modify: `packages/backend/src/modules/automation-rules/automation-rules.module.ts`

- [ ] **Step 1: Ler validação atual**

Run: `sed -n '125,170p' packages/backend/src/modules/automation-rules/automation-rules.service.ts`

- [ ] **Step 2: Teste**

```typescript
  it('setActive(true) delegates limit check to PlanLimitsService', async () => {
    const assertMock = jest.fn().mockResolvedValue(undefined);
    (service as any).planLimits = { assertCanActivateRule: assertMock, invalidate: jest.fn() };
    // supabase mock para UPDATE
    await service.setActive('user-1', 'rule-1', true);
    expect(assertMock).toHaveBeenCalledWith('user-1', 'rule-1');
  });
```

- [ ] **Step 3: Substituir**

```typescript
import { PlanLimitsService } from '../plan-limits/plan-limits.service';

constructor(
  private readonly supabase: SupabaseService,
  private readonly planLimits: PlanLimitsService,
  // demais deps existentes
) {}

async setActive(userId: string, ruleId: string, active: boolean) {
  if (active) {
    await this.planLimits.assertCanActivateRule(userId, ruleId);
  }

  const { error } = await this.supabase.getClient()
    .from('automation_rules')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', ruleId);
  if (error) throw error;

  await this.planLimits.invalidate(userId);
}
```

Remova o método `getPlanLimit()` e quaisquer imports/helpers que eram usados só por ele.
Em `automation-rules.module.ts`, adicione `PlanLimitsModule`.

- [ ] **Step 4: Testar**

Run: `npm test -- automation-rules.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/automation-rules/
git commit -m "refactor(automation-rules): use PlanLimitsService for active-rule limit"
```

---

### Task 23: Enforcement em ativação de ad account

**Files:**
- Modify: service Facebook que altera `facebook_connections.is_active` (confirmar nome no Step 1)
- Modify: módulo correspondente

- [ ] **Step 1: Identificar o service**

Run: `grep -rn "facebook_connections" packages/backend/src/modules/facebook/ | grep -v test | grep -v spec | grep "is_active"`

Anote o arquivo e método que altera `is_active`.

- [ ] **Step 2: Teste**

```typescript
  it('setActive(true) delegates to planLimits.assertCanActivateAdAccount', async () => {
    const assertMock = jest.fn().mockResolvedValue(undefined);
    (service as any).planLimits = { assertCanActivateAdAccount: assertMock, invalidate: jest.fn() };
    await service.setActive('user-1', 'conn-1', true);
    expect(assertMock).toHaveBeenCalledWith('user-1', 'conn-1');
  });
```

- [ ] **Step 3: Integrar**

```typescript
import { PlanLimitsService } from '../plan-limits/plan-limits.service';

constructor(
  private readonly supabase: SupabaseService,
  private readonly planLimits: PlanLimitsService,
  // demais deps
) {}

async setActive(userId: string, connectionId: string, active: boolean) {
  if (active) {
    await this.planLimits.assertCanActivateAdAccount(userId, connectionId);
  }
  const { error } = await this.supabase.getClient()
    .from('facebook_connections')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', connectionId);
  if (error) throw error;
  await this.planLimits.invalidate(userId);
}
```

Adicione `PlanLimitsModule` ao módulo Facebook.

- [ ] **Step 4: Testar**

Run: `npm test -- <spec-name>.spec.ts` (nome do spec identificado no Step 1)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/facebook/
git commit -m "feat(facebook): enforce ad_account limit when activating connection"
```

---

### Task 24: Admin chama `applyPlanChange` em vez de UPDATE direto

**Files:**
- Modify: `packages/backend/src/modules/admin/admin.service.ts` (linhas 589 e 634)
- Modify: `packages/backend/src/modules/admin/admin.module.ts`

- [ ] **Step 1: Ler contexto atual**

Run: `sed -n '580,645p' packages/backend/src/modules/admin/admin.service.ts`

- [ ] **Step 2: Teste**

```typescript
  it('admin changing plan calls applyPlanChange (not direct UPDATE)', async () => {
    const applyMock = jest.fn().mockResolvedValue({
      trimmed: { workspaces: 0, ad_accounts: 0, integrations: 0, rules: 0 },
      unblocked_sales: 0, old_plan: 'pro', new_plan: 'free',
    });
    (service as any).subscriptions = { applyPlanChange: applyMock };
    // supabase mock para buscar plan_rules por 'free'
    await service.updateUser('user-1', { plan: 'free' } as any);
    expect(applyMock).toHaveBeenCalledWith('user-1', expect.any(String));
  });
```

- [ ] **Step 3: Substituir UPDATE direto**

Em `admin.service.ts`, onde hoje o código faz algo como:

```typescript
if (planRule) profileUpdates.plan_id = planRule.id;
```

Substitua por helper novo, e chame ele nos dois lugares (linhas 589 e 634):

```typescript
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

constructor(
  // demais deps existentes
  private readonly subscriptions: SubscriptionsService,
) {}

private async applyPlanChangeIfChanged(userId: string, newPlanName?: string) {
  if (!newPlanName) return;
  const { data: plan } = await this.supabase.getClient()
    .from('plan_rules').select('id').eq('plan', newPlanName).maybeSingle();
  if (!plan) throw new Error(`Unknown plan: ${newPlanName}`);
  await this.subscriptions.applyPlanChange(userId, plan.id);
}

// Nos métodos que recebem dto.plan (updateUser e outro), remova `profileUpdates.plan_id = planRule.id`
// e no final do método (depois dos outros updates), chame:
//   await this.applyPlanChangeIfChanged(userId, dto.plan);
```

Em `admin.module.ts`, adicione `SubscriptionsModule` aos imports.

- [ ] **Step 4: Testar**

Run: `npm test -- admin.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/admin/
git commit -m "refactor(admin): use applyPlanChange for user plan updates"
```

---

## Phase 5 — Sales webhook flow

### Task 25: Injetar `PlanLimitsService` em `SalesService`

**Files:**
- Modify: `packages/backend/src/modules/sales/sales.service.ts`
- Modify: `packages/backend/src/modules/sales/sales.module.ts`

- [ ] **Step 1: Dependência nova**

```typescript
import { PlanLimitsService } from '../plan-limits/plan-limits.service';

constructor(
  private readonly supabase: SupabaseService,
  private readonly planLimits: PlanLimitsService,
  // demais deps
) {}
```

Em `sales.module.ts`, adicione `PlanLimitsModule` aos imports.

- [ ] **Step 2: Commit intermediário**

```bash
git add packages/backend/src/modules/sales/
git commit -m "refactor(sales): inject PlanLimitsService dependency"
```

---

### Task 26: Implementar `upsertFromWebhook` com decisão de limite

**Files:**
- Modify: `packages/backend/src/modules/sales/sales.service.ts`
- Modify: `packages/backend/src/modules/sales/__tests__/sales.service.spec.ts`

- [ ] **Step 1: Testes que falham**

```typescript
  describe('upsertFromWebhook (plan limit)', () => {
    it('persists with blocked_by_limit=true when Free exceeds', async () => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: true, overage: false,
          subscriptionId: 'sub-1', periodStart: 'x', periodEnd: 'y',
        }),
        invalidate: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      const persistSpy = jest.spyOn(service as any, 'persist')
        .mockResolvedValue({ id: 'sale-1' });

      const sale = {
        user_id: 'user-1', status: 'approved',
        external_id: 'ext-1', platform: 'kiwify',
      } as any;
      await service.upsertFromWebhook(sale);

      expect(persistSpy).toHaveBeenCalledWith(
        expect.objectContaining({ blocked_by_limit: true })
      );
    });

    it('persists + inserts overage when paid plan exceeds', async () => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: false, overage: true,
          pricePerSaleCents: 14,
          subscriptionId: 'sub-1', periodStart: '2026-04-01', periodEnd: '2026-05-01',
        }),
        invalidate: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      const persistSpy = jest.spyOn(service as any, 'persist')
        .mockResolvedValue({ id: 'sale-1' });
      const insertOverageSpy = jest.spyOn(service as any, 'insertOverage')
        .mockResolvedValue(undefined);

      const sale = {
        user_id: 'user-1', status: 'approved',
        external_id: 'ext-1', platform: 'kiwify',
      } as any;
      await service.upsertFromWebhook(sale);

      expect(persistSpy).toHaveBeenCalled();
      expect(insertOverageSpy).toHaveBeenCalledWith('sale-1', 'user-1', expect.objectContaining({
        pricePerSaleCents: 14,
      }));
    });

    it('skips limit check when status != approved', async () => {
      const checkMock = jest.fn();
      (service as any).planLimits = { checkSaleAcceptance: checkMock, invalidate: jest.fn() };
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-2' });

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'pending',
        external_id: 'ext-1', platform: 'kiwify',
      } as any);

      expect(checkMock).not.toHaveBeenCalled();
    });

    it('skips decision if external_id already exists (idempotent)', async () => {
      const checkMock = jest.fn();
      (service as any).planLimits = { checkSaleAcceptance: checkMock, invalidate: jest.fn() };
      jest.spyOn(service as any, 'findByExternalId')
        .mockResolvedValue({ id: 'existing' });

      const result = await service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved',
        external_id: 'ext-1', platform: 'kiwify',
      } as any);

      expect(result).toEqual({ id: 'existing' });
      expect(checkMock).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Falhar**

Run: `npm test -- sales.service.spec.ts -t "upsertFromWebhook"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Adicione/ajuste em `sales.service.ts`:

```typescript
import type { SaleDecision } from '../plan-limits/plan-limits.service';

async upsertFromWebhook(sale: any): Promise<any> {
  // 1. Status != approved — persiste sem limit check.
  if (sale.status !== 'approved') {
    return this.persist(sale);
  }

  // 2. Idempotência: webhook retry não reprocessa.
  const existing = await this.findByExternalId(sale.external_id, sale.platform);
  if (existing) return existing;

  // 3. Decisão do PlanLimitsService.
  const decision: SaleDecision = await this.planLimits.checkSaleAcceptance(sale.user_id);

  // 4. Free acima do limite.
  if (decision.blocked_by_limit) {
    const saved = await this.persist({ ...sale, blocked_by_limit: true });
    await this.planLimits.invalidate(sale.user_id);
    return saved;
  }

  // 5. Persiste venda normal.
  const saved = await this.persist(sale);

  // 6. Registra overage se plano pago excedeu.
  // TODO(stripe): quando Stripe integrar, enfileirar meter event aqui
  // (pode ser via Bull/SQS/etc.) para reportar em batch no job de reconciliação.
  if (decision.overage) {
    try {
      await this.insertOverage(saved.id, sale.user_id, decision);
    } catch (err) {
      // UNIQUE(sale_id) — se já existe, ignora silenciosamente.
      if (!(err as any)?.message?.includes('duplicate')) throw err;
    }
  }

  // 7. Invalida contagens.
  await this.planLimits.invalidate(sale.user_id);
  return saved;
}

private async insertOverage(
  saleId: string,
  userId: string,
  decision: { subscriptionId: string; periodStart: string; periodEnd: string; pricePerSaleCents: number },
): Promise<void> {
  const { error } = await this.supabase.getClient()
    .from('usage_overage')
    .insert({
      user_id: userId,
      subscription_id: decision.subscriptionId,
      sale_id: saleId,
      period_start: decision.periodStart,
      period_end: decision.periodEnd,
      price_cents: decision.pricePerSaleCents,
    });
  if (error) throw error;
}
```

> Se `persist` ou `findByExternalId` ainda não existem como métodos isolados, extraia-os do caminho atual do webhook no service em helpers privados. Se os nomes forem outros no código atual, ajuste os testes e as chamadas acima para bater com a nomenclatura real.

- [ ] **Step 4: Testar**

Run: `npm test -- sales.service.spec.ts`
Expected: PASS (incluindo os antigos).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/sales/
git commit -m "feat(sales): enforce per-sale limit + record overage in webhook flow"
```

---

### Task 27: Filtrar `blocked_by_limit` em queries de métricas

**Files:** vários services que consultam `sales` com `status='approved'` para agregação.

- [ ] **Step 1: Localizar todos os lugares**

Run:
```bash
grep -rn "status.*approved\|'approved'" packages/backend/src/modules/ | grep -v __tests__ | grep -v spec.ts
```

- [ ] **Step 2: Em cada local, adicionar filtro**

Padrão aplicado em cada query:

```typescript
// ANTES
.eq('status', 'approved')

// DEPOIS
.eq('status', 'approved')
.eq('blocked_by_limit', false)
```

Arquivos esperados (confirmar com grep):
- `modules/metrics/live-metrics.service.ts`
- `modules/metrics/consolidated.service.ts` (ou equivalente)
- `modules/sales/sales.service.ts` (métodos de listagem/agregação)
- `modules/financial/financial.service.ts`
- `modules/admin/admin.service.ts` (relatórios)
- Qualquer **RPC/view SQL** que agregue `sales WHERE status='approved'` — se existir, precisa ser refeito com nova migration.

- [ ] **Step 3: Rodar toda a suite**

Run: `npm test`
Expected: tudo PASS. Se algum teste quebrar por fixture sem `blocked_by_limit`, atualize o fixture.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/
git commit -m "refactor(queries): filter blocked_by_limit in sales aggregations"
```

---

## Phase 6 — Drop dead columns (após frontend limpo)

### Task 28: Drop colunas mortas de `plan_rules`

**Files:**
- Create: `supabase/migrations/20260417300000_drop_plan_rules_dead_columns.sql`

- [ ] **Step 1: Validar que nada lê as colunas mortas**

Run:
```bash
grep -rn "max_campaigns\|sync_interval_minutes\|feature_sales_globe\|feature_advanced_reports\|feature_conversion_funnel\|feature_auto_sync\|feature_api_access" packages/backend/src packages/frontend/src
```

Expected: zero matches. Se houver algum, corrija ANTES de seguir.

- [ ] **Step 2: Criar migration**

```sql
-- supabase/migrations/20260417300000_drop_plan_rules_dead_columns.sql

ALTER TABLE public.plan_rules
  DROP COLUMN IF EXISTS max_campaigns,
  DROP COLUMN IF EXISTS sync_interval_minutes,
  DROP COLUMN IF EXISTS feature_sales_globe,
  DROP COLUMN IF EXISTS feature_advanced_reports,
  DROP COLUMN IF EXISTS feature_conversion_funnel,
  DROP COLUMN IF EXISTS feature_auto_sync,
  DROP COLUMN IF EXISTS feature_api_access;
```

- [ ] **Step 3: Aplicar**

Run: `npx supabase db push`
Expected: DROPs bem-sucedidos.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417300000_drop_plan_rules_dead_columns.sql
git commit -m "chore(plan-limits): drop dead columns from plan_rules"
```

---

## Phase 7 — Frontend

### Task 29: Criar `usePlanUsage` + deletar `usePlanRules`

**Files:**
- Create: `packages/frontend/src/hooks/usePlanUsage.ts`
- Delete: `packages/frontend/src/hooks/usePlanRules.ts`

- [ ] **Step 1: Criar hook**

```typescript
// packages/frontend/src/hooks/usePlanUsage.ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export type UsageSnapshot = {
  plan: string;
  period: { start: string; end: string };
  sales:        { used: number; limit: number; blocked: number };
  workspaces:   { used: number; limit: number };
  adAccounts:   { used: number; limit: number };
  integrations: { used: number; limit: number };
  activeRules:  { used: number; limit: number };
  overage:      { count: number; totalCents: number };
};

type Resource = 'workspace' | 'integration' | 'adAccount' | 'rule';

const RESOURCE_KEY: Record<
  Resource,
  'workspaces' | 'integrations' | 'adAccounts' | 'activeRules'
> = {
  workspace:   'workspaces',
  integration: 'integrations',
  adAccount:   'adAccounts',
  rule:        'activeRules',
};

export function usePlanUsage() {
  const query = useQuery<UsageSnapshot>({
    queryKey: ['plan-usage'],
    queryFn: () => apiClient.get('/api/plan-limits/usage').then(r => r.data),
    staleTime: 30_000,
  });

  const usage = query.data;

  function remaining(resource: Resource): number | null {
    if (!usage) return null;
    const { used, limit } = usage[RESOURCE_KEY[resource]];
    if (limit === -1) return Infinity as any;
    return Math.max(0, limit - used);
  }

  function canCreate(resource: 'workspace' | 'integration'): boolean {
    const r = remaining(resource);
    return r === null || r > 0;
  }

  function canActivate(resource: 'adAccount' | 'rule'): boolean {
    const r = remaining(resource);
    return r === null || r > 0;
  }

  function isAtLimit(resource: Resource): boolean {
    const r = remaining(resource);
    return r !== null && r === 0;
  }

  function isNearLimit(resource: Resource, threshold = 0.9): boolean {
    if (!usage) return false;
    const { used, limit } = usage[RESOURCE_KEY[resource]];
    if (limit === -1) return false;
    return used / limit >= threshold;
  }

  return {
    usage,
    isLoading: query.isLoading,
    canCreate,
    canActivate,
    isAtLimit,
    isNearLimit,
    remaining,
  };
}
```

- [ ] **Step 2: Deletar `usePlanRules`**

Run:
```bash
rm packages/frontend/src/hooks/usePlanRules.ts
```

- [ ] **Step 3: Validar imports**

Run: `grep -rn "usePlanRules\|canUseFeature" packages/frontend/src`
Expected: zero matches. Se algum consumidor sobrou, será tratado nas tasks seguintes ou aqui se for trivial.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/usePlanUsage.ts
git rm packages/frontend/src/hooks/usePlanRules.ts
git commit -m "feat(frontend): replace usePlanRules with usePlanUsage"
```

---

### Task 30: Interceptor HTTP 402 + `PlanLimitModal`

**Files:**
- Modify: `packages/frontend/src/lib/api-client.ts`
- Create: `packages/frontend/src/components/PlanLimitModal.tsx`
- Modify: layout root (ex: `packages/frontend/src/App.tsx` ou `DashboardLayout.tsx`)

- [ ] **Step 1: Adicionar event bus + interceptor**

```typescript
// packages/frontend/src/lib/api-client.ts (acrescentar, mantendo o resto)

const planLimitListeners: Array<(detail: any) => void> = [];
export function onPlanLimitExceeded(cb: (detail: any) => void) {
  planLimitListeners.push(cb);
  return () => {
    const i = planLimitListeners.indexOf(cb);
    if (i >= 0) planLimitListeners.splice(i, 1);
  };
}

apiClient.interceptors.response.use(
  (r) => r,
  (error) => {
    const data = error.response?.data;
    if (error.response?.status === 402 && data?.resource) {
      planLimitListeners.forEach(cb => cb(data));
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 2: Criar modal**

```tsx
// packages/frontend/src/components/PlanLimitModal.tsx
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { onPlanLimitExceeded } from '@/lib/api-client';

const RESOURCE_LABEL: Record<string, string> = {
  workspace:   'workspaces',
  ad_account:  'contas de anúncio ativas',
  integration: 'integrações de checkout',
  active_rule: 'regras de automação ativas',
};

export function PlanLimitModal() {
  const [detail, setDetail] = useState<any | null>(null);
  const navigate = useNavigate();

  useEffect(() => onPlanLimitExceeded(setDetail), []);

  if (!detail) return null;
  const label = RESOURCE_LABEL[detail.resource] ?? detail.resource;

  return (
    <Dialog open onOpenChange={() => setDetail(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Limite do plano atingido</DialogTitle>
          <DialogDescription>
            Seu plano <strong>{detail.plan}</strong> permite {detail.limit} {label}.
            Você está usando {detail.current}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button>
          <Button onClick={() => { setDetail(null); navigate('/settings?tab=plan'); }}>
            Fazer upgrade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Montar em layout raiz**

No layout global (ex: `App.tsx` ou `DashboardLayout.tsx`):

```tsx
import { PlanLimitModal } from '@/components/PlanLimitModal';
// ... dentro do JSX raiz:
<PlanLimitModal />
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/lib/api-client.ts packages/frontend/src/components/PlanLimitModal.tsx
# + arquivo do layout que montou o modal
git commit -m "feat(frontend): global 402 interceptor + PlanLimitModal"
```

---

### Task 31: Reescrever página `AdminPlans`

**Files:**
- Modify: `packages/frontend/src/pages/admin/AdminPlans.tsx`

- [ ] **Step 1: Ler versão atual**

Run: `cat packages/frontend/src/pages/admin/AdminPlans.tsx`

- [ ] **Step 2: Substituir por versão nova**

Substitua `limitLabels` e `featureLabels` por apenas `LIMIT_FIELDS` + campo overage:

```tsx
// packages/frontend/src/pages/admin/AdminPlans.tsx

const LIMIT_FIELDS = [
  { key: 'max_sales_monthly',         label: 'Vendas aprovadas por ciclo' },
  { key: 'max_active_ad_accounts',    label: 'Ad accounts ativas' },
  { key: 'max_checkout_integrations', label: 'Integrações de checkout' },
  { key: 'max_workspaces',            label: 'Workspaces' },
  { key: 'max_active_rules',          label: 'Regras automatizadas ativas' },
] as const;

// Campo de overage em reais (converte pra centavos ao salvar)
function OveragePriceField({
  valueCents, onChange,
}: { valueCents: number; onChange: (cents: number) => void }) {
  const brl = (valueCents / 100).toFixed(2).replace('.', ',');
  return (
    <input
      type="text"
      value={brl}
      onChange={(e) => {
        const clean = e.target.value.replace(/[^0-9,]/g, '').replace(',', '.');
        const cents = Math.round((parseFloat(clean) || 0) * 100);
        onChange(cents);
      }}
      placeholder="0,14"
      className="..." // manter classes de estilo existentes
    />
  );
}

// No render do plano, iterar LIMIT_FIELDS (inputs com -1 = Ilimitado)
// + um input separado para overage_price_cents usando OveragePriceField.
// Remover quaisquer seções de feature_* e max_campaigns/sync_interval_minutes.
```

Remova todas as referências a `feature_sales_globe`, `feature_advanced_reports`, `feature_conversion_funnel`, `feature_auto_sync`, `feature_api_access`, `max_campaigns`, `sync_interval_minutes`.

- [ ] **Step 3: Teste manual no dev server**

Run: `npm run dev:frontend`
Navegue pra `/admin/plans`. Valide que os 5 planos aparecem com 5 inputs de limite + 1 de overage cada.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/admin/AdminPlans.tsx
git commit -m "refactor(admin-plans): remove dead fields, add overage_price editor"
```

---

### Task 32: Card "Uso do plano" em Configurações

**Files:**
- Create: `packages/frontend/src/components/PlanUsageCard.tsx`
- Modify: `packages/frontend/src/pages/Settings.tsx` (ou arquivo da aba Plano)

- [ ] **Step 1: Criar componente**

```tsx
// packages/frontend/src/components/PlanUsageCard.tsx
import { usePlanUsage } from '@/hooks/usePlanUsage';

function bar(used: number, limit: number) {
  if (limit === -1) return { pct: 0, label: `${used} / Ilimitado` };
  return {
    pct: Math.min(100, Math.round((used / limit) * 100)),
    label: `${used} / ${limit}`,
  };
}

export function PlanUsageCard() {
  const { usage, isLoading } = usePlanUsage();
  if (isLoading || !usage) return <div>Carregando...</div>;

  const rows = [
    { title: 'Vendas aprovadas este ciclo',  ...bar(usage.sales.used, usage.sales.limit) },
    { title: 'Workspaces',                   ...bar(usage.workspaces.used, usage.workspaces.limit) },
    { title: 'Contas de anúncio ativas',     ...bar(usage.adAccounts.used, usage.adAccounts.limit) },
    { title: 'Integrações de checkout',      ...bar(usage.integrations.used, usage.integrations.limit) },
    { title: 'Regras automatizadas ativas',  ...bar(usage.activeRules.used, usage.activeRules.limit) },
  ];

  return (
    <div className="space-y-4 rounded border p-4">
      <h3 className="font-semibold">Uso do plano {usage.plan}</h3>
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.title} className="flex items-center gap-2">
            <span className="w-56">{r.title}</span>
            <div className="flex-1 h-2 bg-slate-200 rounded">
              <div
                className="h-full bg-blue-500 rounded"
                style={{ width: `${r.pct}%` }}
              />
            </div>
            <span className="w-24 text-right text-sm">{r.label}</span>
          </li>
        ))}
      </ul>

      {usage.sales.blocked > 0 && (
        <div className="rounded bg-amber-50 p-3 text-sm">
          <strong>{usage.sales.blocked}</strong> vendas bloqueadas este ciclo.
          Faça upgrade para processá-las.
        </div>
      )}

      {usage.overage.count > 0 && (
        <div className="rounded bg-slate-50 p-3 text-sm">
          <strong>{usage.overage.count}</strong> vendas extras este ciclo —
          total a cobrar: R$ {(usage.overage.totalCents / 100).toFixed(2).replace('.', ',')}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Incluir na aba Plano**

Localize o arquivo que renderiza a aba "Plano" em Configurações. Adicione:

```tsx
import { PlanUsageCard } from '@/components/PlanUsageCard';
// ... no JSX da aba Plano:
<PlanUsageCard />
```

- [ ] **Step 3: Teste manual**

Run: `npm run dev:frontend`
Configurações → Plano. Validar barras e cards.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/PlanUsageCard.tsx packages/frontend/src/pages/Settings.tsx
git commit -m "feat(frontend): add plan usage card on Settings > Plano"
```

---

### Task 33: Desabilitar botões de criar/ativar em pontos de UI

**Files:** vários (identificar via grep no Step 1).

- [ ] **Step 1: Localizar pontos**

Run:
```bash
grep -rn "Criar workspace\|Novo workspace\|Criar Workspace" packages/frontend/src
grep -rn "Adicionar integração\|Nova integração" packages/frontend/src
grep -rn "facebook_connections" packages/frontend/src
grep -rn "automation_rules\|Regra\b" packages/frontend/src
```

- [ ] **Step 2: Aplicar padrão em cada local**

Exemplo para botão de workspace:

```tsx
import { usePlanUsage } from '@/hooks/usePlanUsage';

const { canCreate, isAtLimit, usage } = usePlanUsage();
const blocked = isAtLimit('workspace');
const tooltip = blocked
  ? `Limite de workspaces atingido (${usage?.workspaces.used}/${usage?.workspaces.limit}). Faça upgrade.`
  : undefined;

<Button disabled={!canCreate('workspace')} title={tooltip}>Criar workspace</Button>
```

Repetir para:
- Integração checkout: `canCreate('integration')`.
- Toggle ativar ad account: `canActivate('adAccount')`.
- Toggle ativar regra: `canActivate('rule')`.

- [ ] **Step 3: Teste manual**

Run: `npm run dev:frontend`
Admin muda plano de um user pra `free`. Na UI do user: "Criar workspace" fica bloqueado quando já existe 1.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/
git commit -m "feat(frontend): disable create/activate buttons when plan limit reached"
```

---

### Task 34: Grupo "Arquivados" no `WorkspaceSwitcher`

**Files:**
- Modify: `packages/backend/src/modules/workspaces/workspaces.controller.ts` (endpoint novo)
- Modify: `packages/frontend/src/components/WorkspaceSwitcher.tsx`

- [ ] **Step 1: Adicionar endpoint backend**

Em `workspaces.controller.ts`:

```typescript
@Get('archived')
async listArchived(@CurrentUser('sub') userId: string) {
  return this.workspacesService.listArchivedByUser(userId);
}
```

> `listArchivedByUser` já foi adicionado em Task 20.

- [ ] **Step 2: Adicionar hook + UI no Switcher**

```tsx
import { useQuery } from '@tanstack/react-query';

const { data: archived = [] } = useQuery({
  queryKey: ['workspaces-archived'],
  queryFn: () => apiClient.get('/api/workspaces/archived').then(r => r.data),
  staleTime: 60_000,
});

// No dropdown, abaixo dos workspaces ativos:
{archived.length > 0 && (
  <>
    <Separator />
    <div className="px-2 py-1 text-xs text-slate-500">Arquivados</div>
    {archived.map((w: any) => (
      <button
        key={w.id}
        disabled
        className="w-full px-2 py-1 flex items-center gap-2 opacity-60 cursor-not-allowed"
        title="Workspace arquivado por downgrade. Faça upgrade para reativar."
      >
        🔒 {w.name}
      </button>
    ))}
  </>
)}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/workspaces/workspaces.controller.ts
git add packages/frontend/src/components/WorkspaceSwitcher.tsx
git commit -m "feat(workspaces): expose archived list + show locked in switcher"
```

---

## Phase 8 — Documentação

### Task 35: Reescrever `docs/features/11-plans-and-limits/plan-rules.md`

**Files:**
- Modify: `docs/features/11-plans-and-limits/plan-rules.md`

- [ ] **Step 1: Reescrita completa**

Siga o template de `docs/features/TEMPLATE.md`. Cobertura obrigatória:

- Tabela `plan_rules` com as colunas atuais (`max_sales_monthly`, `max_active_ad_accounts`, `max_checkout_integrations`, `max_workspaces`, `max_active_rules`, `overage_price_cents`).
- Matriz de limites dos 5 planos (valores do spec §1.2).
- `PlanLimitsService` é o ponto único de enforcement (não há mais `usePlanRules` no frontend).
- Endpoint `GET /api/plan-limits/usage` retorna `UsageSnapshot`.
- Menção a `subscriptions` e `usage_overage` com links para os docs novos.
- Nota sobre integração Stripe futura (marcadores `// TODO(stripe):` no código).

- [ ] **Step 2: Commit**

```bash
git add docs/features/11-plans-and-limits/plan-rules.md
git commit -m "docs(plans): rewrite plan-rules documentation"
```

---

### Task 36: Criar `subscriptions.md`, `overage-billing.md`, `downgrade-auto-trim.md`

**Files:**
- Create: `docs/features/11-plans-and-limits/subscriptions.md`
- Create: `docs/features/11-plans-and-limits/overage-billing.md`
- Create: `docs/features/11-plans-and-limits/downgrade-auto-trim.md`

- [ ] **Step 1: `subscriptions.md`**

Use `docs/features/TEMPLATE.md` como base. Cobrir:
- Propósito da tabela `subscriptions` (fonte de verdade do plano/ciclo).
- Schema completo (da Task 2).
- Relacionamento com `profiles.plan_id` (valor derivado).
- Backfill inicial (vindo de `profiles.subscription_start` / `created_at`).
- Integração futura com Stripe (marcadores `// TODO(stripe):`).

- [ ] **Step 2: `overage-billing.md`**

Cobrir:
- Propósito de `usage_overage`.
- Quando é inserida uma linha (plano pago com `counts.sales >= max_sales_monthly`).
- Fluxo de idempotência (`UNIQUE sale_id`).
- Preço vem de `plan_rules.overage_price_cents`.
- Reporting futuro para Stripe Meter Events (marcado com `// TODO(stripe):`).

- [ ] **Step 3: `downgrade-auto-trim.md`**

Cobrir:
- `applyPlanChange` (RPC `apply_plan_change`) como função central.
- Dois gatilhos: admin (agora) e webhook Stripe (futuro).
- Heurísticas por recurso (§6.3 do spec).
- Soft-disable (`archived_at`, `is_active=false`).
- Upgrade libera `blocked_by_limit` dos últimos 30 dias.

- [ ] **Step 4: Commit**

```bash
git add docs/features/11-plans-and-limits/
git commit -m "docs(plans): add subscriptions, overage-billing and downgrade-auto-trim docs"
```

---

## Phase 9 — Final validation

### Task 37: Rodar suite completa + build

**Files:** nenhum.

- [ ] **Step 1: Lint + tests + build**

Run:
```bash
npm run lint
npm test
npm run build
```

Expected: lint sem erros, todos os testes PASS, builds de backend e frontend OK.

- [ ] **Step 2: Smoke test manual end-to-end**

Com dev server rodando (`npm run dev`):

- [ ] Admin altera plano de um user pra `free` → workspaces/ad_accounts/integrações/rules excedentes ficam arquivados/inativos.
- [ ] User Free já com 30 vendas aprovadas este ciclo: venda nova via webhook aparece em `SELECT * FROM sales WHERE blocked_by_limit=true`.
- [ ] User Pro com 1001 vendas: `SELECT count(*) FROM usage_overage` retorna ≥1.
- [ ] Frontend: tentar criar 2º workspace num Free → modal HTTP 402 dispara.
- [ ] Configurações → Plano: barras refletem contagens; card de overage aparece quando `overage.count > 0`; card de bloqueadas aparece quando `sales.blocked > 0`.
- [ ] AdminPlans: editar `overage_price_cents` de `pro` para 15 e salvar → verificar via `SELECT overage_price_cents FROM plan_rules WHERE plan='pro'`.

- [ ] **Step 3: Verificar marcadores Stripe**

Run:
```bash
grep -rn "TODO(stripe)" packages/backend/src supabase/migrations
```

Expected: vários matches (colunas Stripe em `subscriptions`, colunas Stripe em `usage_overage`, pontos de extensão nos services `sales.ts` e `subscriptions.ts`, comment na RPC). Isso é a lista de pontos a tocar na próxima fase (integração Stripe).

- [ ] **Step 4: Commit final de ajustes (se houver)**

```bash
git add .
git commit -m "chore(plan-limits): final adjustments after smoke tests"
```

---

## Notas gerais para o executor

1. **Ordem das fases é importante.** Fase 1 deixa o banco pronto E mantém o `plans.service.ts` funcional durante todo o refactor. Fase 2-5 constrói a nova lógica. Fase 6 (drop) só acontece depois que o frontend (Fase 7) está limpo de referências a campos mortos.

2. **Use `grep -r "TODO(stripe):"` ao final** para conferir que os marcadores estão nos lugares certos — são o mapa da próxima fase (integração Stripe).

3. **Sempre atualize fixtures de teste** quando forem desatualizados pelos novos campos (`blocked_by_limit`, `archived_at`). Não relaxe asserções.

4. **O RPC (Task 18) é o coração da atomicidade do downgrade/upgrade.** Teste manualmente no SQL editor após aplicar a migration e antes de prosseguir.

5. **Se o nome real de algum arquivo diferir** (ex: service de facebook, método `persist` em sales), ajuste pra nomenclatura real do codebase — os nomes neste plano refletem a análise feita durante o brainstorming e podem divergir em detalhes.

6. **Documentação (Fase 8) é obrigatória** pela Rule 1 do CLAUDE.md.
