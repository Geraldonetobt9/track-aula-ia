# Plans Tab Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the **Plano** tab in Settings with the "Focus & Glance" layout — a two-column hero (current plan + compact usage) and a refined plan grid below.

**Architecture:** Frontend-only refactor of 4 existing files. No new data, no new hooks, no backend changes. Each component is modified independently so the page stays functional between tasks. Final task stitches the 2-column layout in `Settings.tsx`.

**Tech Stack:** React 18 + TypeScript + Tailwind + shadcn/ui + TanStack Query. Tailwind arbitrary values for lime accent where shadcn tokens don't cover it.

**Spec:** `docs/superpowers/specs/2026-04-20-plans-tab-redesign-design.md`

**Verification strategy:** Vitest has no UI tests for these components, so each task ends with: (a) running the dev server, (b) manually checking the Plano tab renders without runtime errors, (c) running `npm run lint` and `npm run build` before commit.

---

## Task 0: Start dev server and capture baseline

**Files:** none

- [ ] **Step 1: Start the dev server (run in background)**

Run: `cd packages/frontend && npm run dev`
Expected: Vite serves on `http://localhost:5173`. Open `/settings` → **Plano** tab to see the current layout. Keep this running for the whole session.

- [ ] **Step 2: Confirm the current baseline loads without errors**

Check the browser console. Expected: no React errors, usage bars render, plan cards render, "Gerenciar assinatura" button shows. If the user is not logged in, log in first.

---

## Task 1: Redesign `CurrentPlanCard` as hero

**Files:**
- Modify: `packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx`

**What changes:** Replace the plain bordered card with a two-part hero. Top row: plan chip + name + price/overage on the left, action buttons on the right. Bottom row (separated by divider): inline meta items for *Próxima cobrança* and *Status*. Keep all existing logic for `cancel_at_period_end`, `scheduled_plan`, `reactivate`, and portal.

- [ ] **Step 1: Replace the file contents with the new hero component**

Write `packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx`:

```tsx
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { useStripePortal } from '@/hooks/useStripePortal';
import { useStripeReactivate } from '@/hooks/useStripeReactivate';
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

const PLAN_PRICING: Record<string, { price: string; overage: string | null }> = {
  free:       { price: 'Grátis',         overage: null },
  pro:        { price: 'R$ 59,90 / mês', overage: '+ R$ 0,14 por venda extra' },
  starter:    { price: 'R$ 119,90 / mês', overage: '+ R$ 0,12 por venda extra' },
  enterprise: { price: 'R$ 199,90 / mês', overage: '+ R$ 0,07 por venda extra' },
  unlimited:  { price: 'Sob consulta',    overage: null },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function StatusChip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'danger' }) {
  const dot =
    tone === 'ok'
      ? 'bg-primary shadow-[0_0_8px_hsl(var(--primary))]'
      : tone === 'warn'
      ? 'bg-amber-400'
      : 'bg-red-500';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
    </span>
  );
}

export function CurrentPlanCard() {
  const { usage } = usePlanUsage();
  const portal = useStripePortal();
  const reactivate = useStripeReactivate();

  if (!usage) return null;

  const pricing = PLAN_PRICING[usage.plan] ?? { price: '—', overage: null };
  const isPaid = !!usage.subscription.status;
  const isCanceling = usage.subscription.cancel_at_period_end;
  const cancelEndsOn = usage.subscription.next_billing_date
    ? formatDate(usage.subscription.next_billing_date)
    : '—';

  const statusTone: 'ok' | 'warn' | 'danger' = isCanceling
    ? 'warn'
    : usage.subscription.status === 'past_due'
    ? 'danger'
    : 'ok';
  const statusLabel = isCanceling
    ? 'Cancelamento agendado'
    : usage.subscription.status === 'past_due'
    ? 'Pagamento pendente'
    : isPaid
    ? 'Ativa'
    : 'Plano gratuito';

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#151b22] to-[#0f1419] p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-primary/10 blur-2xl"
      />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Plano atual
          </span>
          <h3 className="mt-2 text-3xl font-semibold capitalize tracking-tight text-white">
            {usage.plan}
          </h3>
          <p className="mt-1 text-sm text-[#a1a4a5]">
            {pricing.price}
            {pricing.overage ? ` · ${pricing.overage}` : ''}
          </p>
        </div>

        {usage.plan !== 'unlimited' && (
          <div className="flex flex-wrap gap-2">
            {isCanceling ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    className="!bg-green-600 !text-white hover:!bg-green-700"
                    disabled={reactivate.isPending}
                  >
                    {reactivate.isPending ? 'Reativando...' : 'Reativar assinatura'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reativar assinatura?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O cancelamento agendado para {cancelEndsOn} será descartado e a sua
                      assinatura continuará ativa normalmente, com renovação automática.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      className="!bg-green-600 !text-white hover:!bg-green-700"
                      onClick={() => reactivate.mutate()}
                    >
                      Sim, reativar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : isPaid ? (
              <Button onClick={() => portal.mutate()} disabled={portal.isPending}>
                {portal.isPending ? 'Redirecionando...' : 'Gerenciar assinatura'}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {(isPaid || isCanceling || usage.subscription.scheduled_plan) && (
        <div className="relative mt-6 flex flex-wrap gap-x-10 gap-y-3 border-t border-white/10 pt-4 text-sm">
          {usage.subscription.next_billing_date && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#a1a4a5]/70">
                {isCanceling ? 'Encerra em' : 'Próxima cobrança'}
              </div>
              <div className="mt-0.5 font-medium text-white">
                {formatDate(usage.subscription.next_billing_date)}
              </div>
            </div>
          )}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#a1a4a5]/70">Status</div>
            <div className="mt-0.5 font-medium text-white">
              <StatusChip label={statusLabel} tone={statusTone} />
            </div>
          </div>
          {usage.subscription.scheduled_plan && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#a1a4a5]/70">
                Próximo plano
              </div>
              <div className="mt-0.5 font-medium capitalize text-white">
                {usage.subscription.scheduled_plan.slug} em{' '}
                {formatDate(usage.subscription.scheduled_plan.changes_at)}
              </div>
            </div>
          )}
        </div>
      )}

      {usage.plan === 'unlimited' && (
        <p className="relative mt-5 text-sm text-[#a1a4a5]">
          Plano Unlimited — gerenciado pelo suporte. Entre em contato para ajustes.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Reload the browser, navigate to /settings → Plano**

Expected: the current plan block is now a gradient hero with a lime accent glow, "Plano atual" chip, large plan name, status chip, and action button on the right. No console errors.

- [ ] **Step 3: Test the action paths**

- Hover/click "Gerenciar assinatura" → calls portal.mutate (button shows "Redirecionando..."). Cancel the redirect in DevTools if needed so you stay on the page.
- If the workspace has `cancel_at_period_end`, the button switches to green "Reativar assinatura" and the status chip shows amber.

- [ ] **Step 4: Lint and build**

Run: `cd packages/frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx
git commit -m "feat(plans): redesign current plan card as hero with status chip"
```

---

## Task 2: Redesign `PlanUsageCard` as compact side panel

**Files:**
- Modify: `packages/frontend/src/components/PlanUsageCard.tsx`

**What changes:** Tighter layout meant to sit next to the hero in a narrower column. Adds title row with "Uso do ciclo" + days-remaining subtext, keeps the 5 metric rows and the blocked/overage alerts.

- [ ] **Step 1: Replace the file contents**

Write `packages/frontend/src/components/PlanUsageCard.tsx`:

```tsx
import { usePlanUsage } from '@/hooks/usePlanUsage';

type Row = { title: string; used: number; limit: number };

function pctFill(used: number, limit: number): number {
  if (limit === -1) return 100;
  if (limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function fillLabel(used: number, limit: number): string {
  if (limit === -1) return `${used.toLocaleString('pt-BR')} / ∞`;
  return `${used.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')}`;
}

function daysUntil(iso: string): number {
  const end = new Date(iso).getTime();
  const diff = end - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function PlanUsageCard() {
  const { usage, isLoading } = usePlanUsage();

  if (isLoading || !usage) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const rows: Row[] = [
    { title: 'Vendas aprovadas',     used: usage.sales.used,        limit: usage.sales.limit },
    { title: 'Workspaces',           used: usage.workspaces.used,   limit: usage.workspaces.limit },
    { title: 'Contas de anúncio',    used: usage.adAccounts.used,   limit: usage.adAccounts.limit },
    { title: 'Integrações',          used: usage.integrations.used, limit: usage.integrations.limit },
    { title: 'Regras automatizadas', used: usage.activeRules.used,  limit: usage.activeRules.limit },
  ];

  const days = daysUntil(usage.period.end);

  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Uso do ciclo</h4>
        <span className="text-[11px] text-[#a1a4a5]/70">
          {days === 0 ? 'reseta hoje' : `reseta em ${days} dia${days === 1 ? '' : 's'}`}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const pct = pctFill(r.used, r.limit);
          const isEmpty = r.used === 0;
          return (
            <li key={r.title} className="space-y-1.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-[#a1a4a5]">{r.title}</span>
                <span className="font-medium text-white tabular-nums">{fillLabel(r.used, r.limit)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all ${isEmpty ? 'bg-white/10' : 'bg-primary'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {(usage.sales.blocked > 0 || usage.overage.count > 0) && (
        <div className="mt-auto space-y-2 pt-1">
          {usage.sales.blocked > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
              <strong>{usage.sales.blocked}</strong> venda{usage.sales.blocked !== 1 ? 's' : ''} bloqueada
              {usage.sales.blocked !== 1 ? 's' : ''} este ciclo. Faça upgrade para processá-las.
            </div>
          )}
          {usage.overage.count > 0 && (
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-[#a1a4a5]">
              <strong className="text-white">{usage.overage.count}</strong> venda
              {usage.overage.count !== 1 ? 's' : ''} extra{usage.overage.count !== 1 ? 's' : ''} · total a
              cobrar: R$ {(usage.overage.totalCents / 100).toFixed(2).replace('.', ',')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Reload the browser and check**

Expected: usage panel now shows "Uso do ciclo" title + "reseta em N dias" subtext, tighter rows with lime bars, empty rows showing faded gray bars. Alerts (blocked/overage) still appear at the bottom when applicable.

- [ ] **Step 3: Lint and build**

Run: `cd packages/frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/PlanUsageCard.tsx
git commit -m "feat(plans): compact usage card with cycle countdown"
```

---

## Task 3: Refine `PlanCards` styling

**Files:**
- Modify: `packages/frontend/src/components/PlanTab/PlanCards.tsx`

**What changes:** Larger border-radius, hover lift, repositioned badges, tighter price block, sharper current-plan highlight (border + subtle lime tint), button hierarchy so the popular plan stands out. No logic changes — `renderAction` stays untouched.

- [ ] **Step 1: Update only the markup inside the `.map` and the section header**

In `packages/frontend/src/components/PlanTab/PlanCards.tsx`, find the `return` block of the exported `PlanCards` component (around line 84) and replace it with:

```tsx
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Trocar de plano</h3>
        <p className="mt-1 text-sm text-[#a1a4a5]/70">
          Escolha o plano que melhor atende seu volume de vendas.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_ORDER.map((slug) => {
          const rule = rulesBySlug.get(slug);
          const display = PLAN_DISPLAY[slug];
          const isCurrent = slug === currentSlug;
          const isScheduled = scheduledSlug === slug;
          const features = rule ? buildFeatures(rule) : [];

          const borderClass = isCurrent
            ? 'border-primary/60 bg-gradient-to-b from-primary/[0.04] to-transparent'
            : display.highlighted
            ? 'border-white/20'
            : 'border-white/10';

          return (
            <div
              key={slug}
              className={`group relative flex flex-col rounded-2xl border bg-[#0f1419] p-6 transition-all hover:-translate-y-0.5 hover:border-white/20 ${borderClass}`}
            >
              {isCurrent ? (
                <Badge className="absolute -top-2.5 left-5 bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  Plano atual
                </Badge>
              ) : display.highlighted ? (
                <Badge className="absolute -top-2.5 left-5 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#0a0c0e]">
                  Mais popular
                </Badge>
              ) : null}

              <div>
                <h4 className="text-base font-semibold text-white">{display.name}</h4>
                <p className="mt-0.5 text-xs text-[#a1a4a5]/70">{display.tagline}</p>
              </div>

              <div className="mt-5">
                {display.priceCents === 0 ? (
                  <p className="text-3xl font-semibold tracking-tight text-white">Grátis</p>
                ) : display.priceCents !== null ? (
                  <p className="text-3xl font-semibold tracking-tight text-white">
                    R$ {formatBRL(display.priceCents)}
                    <span className="ml-1 text-sm font-normal text-[#a1a4a5]/70">/mês</span>
                  </p>
                ) : (
                  <p className="text-3xl font-semibold tracking-tight text-white">Sob consulta</p>
                )}
                {rule && rule.overage_price_cents > 0 ? (
                  <p className="mt-1 text-xs text-[#a1a4a5]/70">
                    + {formatOverage(rule.overage_price_cents)} por venda extra
                  </p>
                ) : slug === 'free' ? (
                  <p className="mt-1 text-xs text-[#a1a4a5]/70">
                    Vendas excedentes não são processadas
                  </p>
                ) : null}
              </div>

              <div className="my-5 h-px bg-white/10" />

              <ul className="flex-1 space-y-2.5 text-[13px] text-[#d4d7d8]">
                {features.map((f) => (
                  <li key={f.label} className="flex items-start gap-2.5">
                    {f.unlimited ? (
                      <InfinityIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {renderAction({
                  slug,
                  rule,
                  isCurrent,
                  isScheduled,
                  currentSlug,
                  hasPaidSubscription,
                  anyPending,
                  onCheckout: (planId) => checkout.mutate(planId),
                  onPortal: () => portal.mutate(),
                  isLoadingRules: isLoading,
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Leave the rest of the file (`PlanRule` type, `PLAN_DISPLAY`, `buildFeatures`, `renderAction`) untouched.

- [ ] **Step 2: Reload the browser and inspect**

Expected: plan cards now have `rounded-2xl`, badges sit flush on the top-left of each card, a subtle `-translate-y-0.5` hover, the current plan has a stronger lime border + faint lime wash, price is 3xl with "/mês" in muted text, feature list has a bit more breathing room.

- [ ] **Step 3: Lint and build**

Run: `cd packages/frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/PlanTab/PlanCards.tsx
git commit -m "feat(plans): refine plan cards with stronger visual hierarchy"
```

---

## Task 4: Two-column layout in `Settings.tsx`

**Files:**
- Modify: `packages/frontend/src/pages/Settings.tsx:197-205` (the `<TabsContent value="plan">` block)

**What changes:** Wrap `CurrentPlanCard` + `PlanUsageCard` in a 2-column grid (1.3fr / 1fr on desktop, stacked on tablet/mobile). Keep `CheckoutReturnHandler` at the top and `PlanCards` full-width at the bottom.

- [ ] **Step 1: Replace the `TabsContent value="plan"` block**

Find the existing block in `packages/frontend/src/pages/Settings.tsx`:

```tsx
          {/* Plan Tab */}
          <TabsContent value="plan">
            <div className="space-y-6">
              <CheckoutReturnHandler />
              <CurrentPlanCard />
              <PlanUsageCard />
              <PlanCards />
            </div>
          </TabsContent>
```

Replace it with:

```tsx
          {/* Plan Tab */}
          <TabsContent value="plan">
            <div className="space-y-6">
              <CheckoutReturnHandler />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
                <CurrentPlanCard />
                <PlanUsageCard />
              </div>
              <PlanCards />
            </div>
          </TabsContent>
```

- [ ] **Step 2: Reload and verify the full layout**

Expected: on desktop (≥1024px) the hero and usage panel sit side-by-side with the hero slightly wider. The usage panel has a min-height matching the hero via `h-full`. Below, the 4 plan cards span the full width. On tablet/mobile both columns stack.

- [ ] **Step 3: Resize the browser to check breakpoints**

- At `<1024px`: hero and usage stack vertically.
- At `<768px`: plan cards collapse to 1 column.
- At `<1280px` but `≥768px`: plan cards collapse to 2 columns.

No overflow, no console errors.

- [ ] **Step 4: Lint and build**

Run: `cd packages/frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/Settings.tsx
git commit -m "feat(plans): two-column hero layout for plan tab"
```

---

## Task 5: Final regression sweep

**Files:** none

- [ ] **Step 1: Walk through every interactive path in the browser**

With the dev server still running, in the **Plano** tab verify:

1. Hero shows plan name, pricing, status chip, and buttons render with the right labels for the current state.
2. Usage panel shows all 5 metric rows with correct `used / limit` values, and bars for zeroed metrics render as faded gray.
3. Clicking "Gerenciar assinatura" triggers the portal mutation (button goes to "Redirecionando...").
4. Plan cards: exactly one card has the "Plano atual" badge, Starter has "Mais popular", and the current plan's button is disabled.
5. If `cancel_at_period_end` is true in the DB, the hero switches to the reactivate flow and status chip shows amber "Cancelamento agendado".
6. `CheckoutReturnHandler` still renders at the top (invisible when no checkout params, toast when returning from Stripe).

- [ ] **Step 2: Run the full frontend toolchain**

Run: `cd packages/frontend && npm run lint && npm run test && npm run build`
Expected: lint clean, existing tests pass, build succeeds.

- [ ] **Step 3: Update the feature doc**

Per `CLAUDE.md` Rule 1 ("Feature changes → Update existing docs"), skim `docs/features/` for the plans-related doc and update the "Frontend components" section if it describes the old layout.

Run: `ls docs/features/ | grep -i plan`

If a matching doc exists, open it and update the UI description (1–2 paragraphs) to mention the hero + usage + plan grid structure. If no doc exists, skip this step — the spec in `docs/superpowers/specs/` already captures the new design.

- [ ] **Step 4: Final commit (if docs changed)**

```bash
git add docs/features/
git commit -m "docs(plans): reflect new plan tab layout"
```

- [ ] **Step 5: Stop the dev server**

Kill the background Vite process you started in Task 0.

---

## Self-review notes

- **Spec coverage:** Hero ✓ (Task 1), compact usage ✓ (Task 2), refined plan grid ✓ (Task 3), 2-col layout ✓ (Task 4), responsiveness ✓ (Task 4 Step 3), regression sweep ✓ (Task 5).
- **Out of scope from the spec stays out:** no annual toggle, no payment-method chip — not touched in any task.
- **Type consistency:** reusing existing types from `usePlanUsage` (`UsageSnapshot`), no new exports/contracts introduced.
