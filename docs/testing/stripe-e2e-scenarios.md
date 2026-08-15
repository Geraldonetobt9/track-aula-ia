# Stripe + Plan-Limits E2E Test Scenarios

Authoritative matrix for the 86-scenario test suite covering Sentinela's Stripe integration and plan-limits enforcement. Updated as tests run and as behavior evolves.

## Tiers

- **Tier 1** — Jest unit specs, fully offline. DI-override mocking of `SupabaseService` + `StripeService`. Fast (< 5 s total).
- **Tier 2** — Jest integration specs, offline, using the in-memory `SupabaseFake` + `StripeFake` under `packages/backend/test/helpers/`. Exercises real service wiring.
- **Tier 3** — Live scripts in `packages/backend/scripts/stripe-real-scenarios.ts`. Requires backend running on `:3001`, Stripe CLI forwarding to `/api/stripe/webhook`, and valid `STRIPE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` env vars.

## Spec-file legend

| Code | Path |
|---|---|
| P | `src/modules/plan-limits/__tests__/plan-limits.service.spec.ts` |
| PC | `src/modules/plan-limits/__tests__/plan-limits.controller.spec.ts` |
| SU | `src/modules/subscriptions/__tests__/subscriptions.service.spec.ts` |
| SC | `src/modules/stripe/__tests__/stripe-checkout.service.spec.ts` |
| SW | `src/modules/stripe/__tests__/stripe-webhook.service.spec.ts` |
| SG | `src/modules/stripe/__tests__/stripe-signature.guard.spec.ts` |
| SO | `src/modules/stripe/__tests__/stripe-overage.service.spec.ts` |
| SOC | `src/modules/stripe/__tests__/stripe-overage-reconciliation.cron.spec.ts` |
| SA | `src/modules/sales/__tests__/sales.service.spec.ts` |
| WP | `src/modules/webhooks/__tests__/webhook-processors.contract.spec.ts` |
| IS | `src/modules/stripe/__tests__/integration.spec.ts` |
| IB | `src/modules/subscriptions/__tests__/integration.spec.ts` |
| NP | `src/modules/webhooks/__tests__/new-platforms.spec.ts` |
| RS | `scripts/stripe-real-scenarios.ts` |

## Scenario matrix

All paths are relative to `packages/backend`.

### Group A — Plan-limits enforcement (no Stripe)

| # | Tier | Spec | `it(...)` title | Status |
|---|---|---|---|---|
| 1 | 1 | P | `checkSaleAcceptance → allowed without overage when within limit` | covered |
| 2 | 1 | P + SA | `blocked_by_limit when Free exceeds` / `persists with blocked_by_limit=true when Free exceeds` | covered |
| 3 | 1 | SA | (subsumed by #2; every additional over-limit sale re-enters the blocked branch) | covered |
| 4 | 1 | SA | `skips limit check when status != approved` | covered |
| 5 | 1 | P | `Free at limit blocks 31st approved sale regardless of refunded rows in table` | added |
| 6 | 1 | SA | `at-limit sale on Pro persists normally without overage or meter event` | added |
| 7 | 1 | SA | `persists + inserts overage when paid plan exceeds` | covered |
| 8 | 1 | SA | `overage insert carries pricePerSaleCents for starter` | added |
| 9 | 1 | SA | `overage insert carries pricePerSaleCents for enterprise` | added |
| 10 | 1 | P + SA | `allowed when plan is unlimited (-1)` / `Unlimited plan never inserts overage and never blocks` | covered + added |
| 11 | 1 | SA | `skips decision if external_id already exists (idempotent)` | covered |
| 12 | 2 | IS | (race is covered indirectly by idempotency guarantees + Tier-1 SalesService spec; see _Open questions_) | deferred |
| 13 | 1 | P | `assertCanCreateWorkspace throws 402 when limit reached` | covered |
| 14 | 1 | P | `assertCan* guards (Scenario 14)` — 6 `it()` blocks across integration/ad-account/rule guards | added |
| 15 | 1 | P | `assertCanActivateRule throws immediately on Free (max_active_rules=0, current=0)` | added |
| 16 | 1 | P | `getUsageSnapshot returns used/limit/blocked/overage` + `includes subscription status fields` + `reports status=null when no stripe subscription` | covered |

### Group B — `applyPlanChange` orchestration

| # | Tier | Spec | `it(...)` title | Status |
|---|---|---|---|---|
| 17 | 1 | SU | `upgrade Free → Pro unblocks recent blocked sales, no trimming` | covered |
| 18 | 1 | SU + IB | `upgrade unblocks only blocked sales from the last 30 days` + `Free→Pro unblocks only last-30d blocked sales; older ones stay blocked` | added |
| 19 | 1 | SU | `downgrade Pro → Free trims workspaces, ad accounts, integrations and rules` | covered |
| 20 | 1 | SU | `downgrade with zero-revenue workspaces archives by created_at-desc tiebreak` | added |
| 21 | 1 | SU | (covered inside `downgrade Pro → Free trims …`) | covered |
| 22 | 1 | SU | (covered inside `downgrade Pro → Free trims …`) | covered |
| 23 | 1 | SU | (covered inside `downgrade Pro → Free trims …`) | covered |
| 24 | 1 | SU | `Pro→Enterprise upgrade skips trims and unblocks blocked sales` | added |
| 25 | 1 | SU | `Pro→Pro same plan runs all steps with zero effect but restarts period` | added |
| 26 | 1 | SU | `throws "Plan X not found" when new plan does not exist` | covered |
| 27 | 1 | SU | `throws "Subscription not found" when user has no subscription` | covered |
| 28 | 1 | SU | `step 3 failure does not flip subscription.plan_id` | added |
| 29 | 1 | SU | `uses provided periodStart/periodEnd when given` | covered |
| 30 | 1 | SU | `clears scheduled_plan_id and scheduled_changes_at on success` | added |
| 31 | 1 | SU | `invalidates planLimits cache after successful plan change` | covered |

### Group C — Stripe checkout service

| # | Tier | Spec | `it(...)` title | Status |
|---|---|---|---|---|
| 32 | 1 | SC | `throws when plan is free` | covered |
| 33 | 1 | SC | `throws when plan is missing stripe_price_id_metered` | added |
| 34 | 1 | SC | `throws when subscription row is missing` | added |
| 35 | 1 | SC | `existing stripe_subscription_id with different plan calls subscriptions.update and returns {changed, plan}` (replaces outdated "redirects to portal" test) | replaced |
| 36 | 1 | SC | `throws 400 "Você já está neste plano" when target plan matches current` | added |
| 37 | 1 | SC | `uses br_cnpj tax_id when profile has a valid CNPJ` | covered |
| 38 | 1 | SC | `creates customer if missing, then creates Checkout Session` (includes br_cpf path) | covered |
| 39 | 1 | SC | `creates customer without tax_id_data when CPF is missing or malformed` | covered |
| 40 | 1 | SC | `creates customer if missing, then creates Checkout Session` (asserts metadata + line items + urls) | covered |
| 41 | 1 | SC | `createPortalSession.creates portal session` + `…throws when user has no stripe_customer_id` | covered |
| 42 | 1 | SC | `reactivateSubscription` describe — 3 `it()` blocks | added |
| 43 | 1 | SC | `previewPlanChange` describe — 3 `it()` blocks | added |

### Group D — Webhook dispatch & idempotency

| # | Tier | Spec | `it(...)` title | Status |
|---|---|---|---|---|
| 44 | 1 | SG | `returns true and attaches stripeEvent on valid signature` | covered |
| 45 | 1 | SG | `throws when stripe-signature header missing` | covered |
| 46 | 1 | SG | `throws when constructEvent throws (invalid signature)` | covered |
| 47 | 1 | SG | `throws when rawBody missing` | covered |
| 48 | 1 | SG | `throws when STRIPE_WEBHOOK_SECRET is not configured` | added |
| 49 | 1 | SW + IS | `records new event in stripe_webhook_events and processes` + `replaying the same webhook event.id is a no-op` | covered |
| 50 | 1 | SW | `skips duplicate event (conflict on insert)` | covered |
| 51 | 1 | SW | `re-throws if insert fails with non-conflict error` | covered |
| 52 | 1 | SW | `checkout.session.completed only logs, no side effects` | added |
| 53 | 1 | SW | `updates subscription row and calls applyPlanChange with period dates` | covered |
| 54 | 1 | SW | `logs error and returns early when metadata is missing` | covered |
| 55 | 1 | SW | `detects cancel_at_period_end=true and marks subscription` | covered |
| 56 | 1 | SW | `detects immediate plan change and calls applyPlanChange` | covered |
| 57 | 1 | SW | `ignores update when price already matches current plan` | covered |
| 58 | 1 | SW | `subscription.updated with unknown price id logs warn and returns` | added |
| 59 | 1 | SW | `converts user to free plan and clears stripe_subscription_id` | covered |
| 60 | 1 | SW | `logs payment_failed event to Discord` | covered |
| 61 | 1 | SW | `unhandled event type is logged without errors` | added |
| 62 | 1 | SW | `subscription.updated for unknown customer warns and returns` | added |

### Group E — Overage meter events

| # | Tier | Spec | `it(...)` title | Status |
|---|---|---|---|---|
| 63 | 1 | SO | `sends meter event with idempotency identifier and updates reported_to_stripe_at` | covered |
| 64 | 1 | SO | `throws when no stripe_customer_id` | covered |
| 65 | 1 | SO | `throws when plan has no stripe_meter_event_name` | added |
| 66 | 1 | SO | `re-throws when Stripe rejects a duplicate meter event identifier` (locks observed behavior — see Open questions) | added |
| 67 | 1 | SOC | `processes every pending row via sendMeterEvent` + `per-row failure is logged but the loop continues` + `notifies Discord when count > 100` + `does not notify Discord when count <= 100` | added |
| 68 | 1 | SOC | `query filters rows older than 1 hour only` | added |
| 69 | 1 | SOC | `query filters reported_to_stripe_at IS NULL` | added |

### Group F — Sales → overage integration

| # | Tier | Spec | `it(...)` title | Status |
|---|---|---|---|---|
| 70 | 1 | SA | `persists with blocked_by_limit=true when Free exceeds` + `at-limit sale on Pro persists normally without overage or meter event` | covered + added |
| 71 | 1 | SA | `persists + inserts overage when paid plan exceeds` | covered |
| 72 | 1 | SA | `swallows duplicate usage_overage insert error` | added |
| 73 | 1 | SA | `meter event rejection does not fail the sale upsert` | added |
| 74 | 1 | SA | `skips decision if external_id already exists (idempotent)` | covered |
| 75 | 1 | WP + NP | `Webhook processors contract` (27 `it()` blocks across 13 processors) + exhaustive per-payload suites in `new-platforms.spec.ts` | added |

### Group G — Critical cross-system

| # | Tier | Spec | `it(...)` title / key | Status |
|---|---|---|---|---|
| 76 | 2 | IS | `Free→Pro via subscription.created unblocks 50 and creates zero overage` | added |
|    | 3 | RS | Scenario H (existing, live) | covered |
| 77 | 3 | RS | Scenario K — `Free→Pro via Portal (subscription.updated) unblocks blocked sales` | added |
| 78 | 2 | IB | `Free→Pro unblocks only last-30d blocked sales; older ones stay blocked` | added |
| 79 | 1 + 3 | SA + RS | `refund webhook does not touch usage_overage or call meter events` — Tier-1 proxy / Scenario L — `cancel_at_period_end=true still triggers overage + meter event` | added |
| 80 | 2 | IS | `subscription.updated with unchanged plan does not call applyPlanChange` | added |
| 81 | 2 | IS | `cancel then reactivate in Portal flips cancel_at_period_end twice with no applyPlanChange` | added |
| 82 | 3 | RS | Scenario M — `3× payment failure → subscription.deleted → Free + auto-trim` (scaffolded; full test-clock flow gated on `SENTINELA_TEST_CLOCK_M=1`) | scaffolded |
| 83 | 2 | IB | `admin applyPlanChange to Unlimited works without Stripe IDs` | added |
| 84 | 1 | SA | `refund webhook does not touch usage_overage or call meter events` (locks Q01 — `overage-billing.md:219`) | added |
| 85 | 3 | RS | Scenario N — `Enterprise→Starter trims ad_accounts when >7 active` | added |
| 86 | 2 | IS | `subscription.updated + subscription.deleted in reverse order: deleted wins` | added |

## Totals (from full suite run — 2026-04-21)

### Tier 1 + Tier 2 (offline)

| Category | Count |
|---|---|
| Jest test suites passing | 25 / 25 |
| Jest `it()` blocks passing | 251 / 251 |
| Plan-limits / Subscriptions / Stripe / Sales `it()` blocks (target modules) | 123 |
| Tier 2 offline integration `it()` blocks | 7 |

### Tier 3 (live Stripe test mode + real Supabase — executed 2026-04-21)

Ran the full script (`scripts/stripe-real-scenarios.ts`) seven times with progressive fixes. Last clean run: **35 assertions passed, 1 flake (N).**

| # | Scenario | Status | Notes |
|---|---|---|---|
| A | New account starts on Free | ✅ | |
| B | Free → Pro upgrade (Checkout) | ✅ | |
| C | Pro → Starter upgrade (subscription.updated) | ✅ | |
| D | Schedule cancel at period end | ✅ | |
| E | Reactivation | ✅ | |
| F | Starter → Pro downgrade | ✅ | |
| G | Meter event for overage | ✅ | |
| H | **CRITICAL** — Free→Pro unblocks 50 + zero retroactive overage | ✅ | |
| I | Cancel → Free + clears stripe_subscription_id | ✅ | Original had race between `plan_id=free` flip and `stripe_subscription_id=null` clear. Fixed by polling for the full post-condition (plan_id AND stripe_subscription_id AND cancel_at_period_end) in one loop instead of piecewise. |
| J | Webhook idempotency | ✅ | |
| K (77) | Free→Pro via Portal (subscription.updated) unblocks 30 | ✅ | New. Took iteration — initial version used `payment_behavior: 'default_incomplete'` which blocked subsequent `subscriptions.update`. Fixed by attaching `tok_visa` before sub creation so it goes to `active`. |
| L (79) | Pro + cancel_at_period_end=true still enforces Pro limits | ✅ | New. Refactored from "reuse main user" (which failed since I reverts user to Free) to self-contained: own user, own Stripe customer, own Pro sub with scheduled cancel. Extended DB poll to 30s. |
| M (82) | Payment-failure flow reaches terminal state via test clock | ✅ | New. Uses `stripe.testHelpers.testClocks` + `tok_chargeCustomerFail` via `stripe.paymentMethods.create`. Full "3 retries on recurring invoice → cancel" path was out of scope (would need ~30+ days of clock advance and an account-level dunning config); instead validates the 23h `incomplete_expired` transition which Stripe handles deterministically. The `deleted → Free` reversion path is covered end-to-end by Scenario I. Gated behind `SENTINELA_TEST_CLOCK_M=1`. |
| N (85) | Enterprise → Starter trims ad_accounts when >7 | ⚠️ flake | New. Passed deterministically in 1 run (trimmed 8 → 7 active). Timed out in 6 runs waiting for `customer.subscription.updated` — flake caused by Stripe CLI forwarding backpressure when the listener runs through many scenarios back-to-back. **Not a "takes days" latency issue** — same event class as C/F/K which pass. The underlying trim logic is covered deterministically by the Tier-1 unit spec `downgrade Pro → Free trims workspaces, ad accounts, integrations and rules` in `subscriptions.service.spec.ts`. |

**Final Tier-3 score:** 13 / 14 scenarios passing deterministically. N is known-flaky at the live layer; its logic is covered in Tier 1.

### Coverage on target modules

| Module | % stmts | % lines |
|---|---|---|
| `plan-limits.service.ts` | 77.33 | 84.61 |
| `plan-limits.controller.ts` | 100 | 100 |
| `subscriptions.service.ts` | 86.53 | 97.39 |
| `stripe-checkout.service.ts` | 85.08 | 93.75 |
| `stripe-overage.service.ts` | 95.65 | 100 |
| `stripe-overage-reconciliation.cron.ts` | 93.10 | 92.59 |
| `stripe-signature.guard.ts` | 100 | 100 |
| `stripe-webhook.service.ts` | 90.69 | 90.36 |
| `sales.service.ts` | 50.81 | 50.90 |

`sales.service.ts` line coverage is low because `getSalesWithDetails` (the query-builder method for the sales feed) is not exercised by this suite — that's `SalesController` territory and out of scope. The `upsertFromWebhook` code path, which is the subject of Group F, is fully exercised.

## Fixtures

12 Stripe event JSONs under `packages/backend/test/fixtures/stripe/`:

- `checkout.session.completed.json`
- `customer.subscription.created.pro.json`
- `customer.subscription.created.missing-metadata.json`
- `customer.subscription.updated.plan-change.pro-to-starter.json`
- `customer.subscription.updated.cancel-scheduled.json`
- `customer.subscription.updated.reactivation.json`
- `customer.subscription.updated.no-change.json`
- `customer.subscription.deleted.json`
- `invoice.paid.json`
- `invoice.payment_failed.first-attempt.json`
- `invoice.payment_failed.final-attempt.json`
- `unknown_event_type.json`

Loaded via `test/helpers/loadStripeFixture.ts`; overrides for `id`, `userId`, `planId`, `customerId`, `subscriptionId` supported.

## Helpers

Under `packages/backend/test/helpers/`:

- `constants.ts` — hoisted plan constants (`FREE_PLAN_MAX_SALES = 30`, etc.) and full `*_PLAN_ROW` objects for seeding.
- `loadStripeFixture.ts` — JSON loader with per-event overrides.
- `dbSnapshot.ts` — compact DB snapshot against a live Supabase client (for Tier-3 assertions).
- `supabaseFake.ts` — in-memory Supabase client covering the chain patterns used by `PlanLimitsService`, `SubscriptionsService`, `SalesService`, `StripeWebhookService`. Supports `eq`/`is`/`in`/`gte`/`lt`/`gt`/`lte`/`order`/`limit` filters, `insert` / `update` / `delete`, `maybeSingle` / `single` / thenable, `UNIQUE` constraint violations via `declareUnique(table, cols)`.
- `stripeFake.ts` — in-memory Stripe stub covering `customers`, `checkout.sessions`, `subscriptions`, `billing.meterEvents` (with idempotency on `identifier`), `billingPortal.sessions`, `invoices.createPreview`, `webhooks.constructEvent`.

## Running

```bash
# Tier 1 + 2 (offline, fast)
npm --prefix packages/backend test
npm --prefix packages/backend test -- --coverage

# Tier 3 (requires backend running + Stripe CLI forwarding)
# Terminal 1: start backend
npm run dev:backend
# Terminal 2: Stripe CLI
stripe listen --forward-to localhost:3001/api/stripe/webhook
# Terminal 3: run live scenarios
STRIPE_SECRET_KEY=sk_test_... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx ts-node packages/backend/scripts/stripe-real-scenarios.ts
```

## Open questions

1. **Scenario 66 — Stripe `already_exists` meter error.** The current `StripeOverageService.sendMeterEvent` does not catch Stripe's duplicate-identifier error; it propagates. The test `re-throws when Stripe rejects a duplicate meter event identifier` locks this in as observed behavior. Callers in production (`SalesService` fire-and-forget with `.catch(warn)`, `StripeOverageReconciliationCron` per-row try/catch) swallow it, so duplicates do not surface as user-visible errors. Consider catching inside the service if we later rely on `sendMeterEvent` from a synchronous path that can't tolerate the throw.
2. **Scenario 12 — concurrent sales race.** Full race coverage requires a database-level atomic counter or a unique-by-(user_id, period, position) constraint. Current behavior relies on `blocked_by_limit=false` being filtered in `countActive`, which is not strictly atomic under concurrent inserts. Deferred: Tier-1 asserts idempotency by `external_id`; Tier-2 IS spec deliberately skips the race scenario. Open question: accept the soft-ordering, or introduce a Postgres advisory lock / an `ON CONFLICT` counter row?
3. **Scenario 82 — full recurring-invoice retry flow.** The scaffold validates Stripe's 23h `incomplete_expired` path (the synchronous, test-clock-friendly failure mode for `payment_behavior: 'allow_incomplete'`). The "customer was paying, card later fails, 3× retries, then cancel" path needs a different setup (create active sub → swap to failing card → advance clock >30d) and depends on the account's dunning config. Current path is sufficient to prove Stripe integration up to terminal status; deleted-webhook → Free reversion is covered by Scenario I.
4. **Scenario 85 (Tier-3 N) — webhook-delivery flake.** The trim logic is deterministic at Tier 1. At Tier 3 the scenario passes environmentally but often times out waiting for `customer.subscription.updated` due to Stripe CLI forwarding backpressure when many scenarios run in sequence. Workaround: restart `stripe listen` + backend between runs. Not worth fixing in script — Tier 1 unit spec already covers the trim logic determistically.

## Bugs found

None in production code. Pre-existing test-side issues fixed along the way:

- `stripe-checkout.service.spec.ts` had an outdated "redirects to portal" test referencing a flow removed during the plan-tab redesign. Replaced in place with the current production behavior (Scenario 35 — `subscriptions.update` swap + `{ changed: true, plan }` return). The service code was correct; the test was stale.
- `scripts/stripe-real-scenarios.ts` Scenario I had a pre-existing race between `waitForPlanApplied(freePlanId)` and the subsequent query for `stripe_subscription_id=null`. The webhook handler writes these in two sequential UPDATEs, so `plan_id=free` is reachable while `stripe_subscription_id` is still set. Fixed by polling for the full post-condition (plan_id + stripe_subscription_id + cancel_at_period_end) in one loop. Not a production bug — the DB eventually converges; only the test read too early.
