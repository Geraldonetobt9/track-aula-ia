/**
 * stripe-scenarios.ts
 *
 * Exercita os principais cenários de negócio da integração Stripe contra
 * test mode real. Objetivo: confiança de que Stripe está configurado
 * corretamente e que nossa modelagem de Products/Prices/Meters aceita
 * as operações que o backend vai executar em runtime.
 *
 * Escopo:
 *   A. Validação do setup (produtos/preços/meters/portal batem com plan_rules)
 *   B. Ciclo de vida de subscription (create → upgrade → downgrade → cancel)
 *   C. Meter event (overage)
 *   D. Idempotência (mesmo identifier não cobra 2x)
 *
 * NÃO inclui (por limitação de execução sem backend rodando + tunnel):
 *   - Webhook signature verification end-to-end
 *   - Checkout Session redirect flow
 *
 * Pra testar webhooks reais: rodar backend com STRIPE_WEBHOOK_SECRET e
 * usar `stripe listen --forward-to http://localhost:3001/api/stripe/webhook`.
 */

import Stripe from 'stripe';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PlanRow = {
  id: string;
  plan: string;
  stripe_product_id: string | null;
  stripe_price_id_base: string | null;
  stripe_price_id_metered: string | null;
  stripe_meter_event_name: string | null;
  max_sales_monthly: number;
  overage_price_cents: number;
};

const CHECK = '\u2713';
const CROSS = '\u2717';
let totalPassed = 0;
let totalFailed = 0;

function pass(msg: string) {
  console.log(`  ${CHECK} ${msg}`);
  totalPassed++;
}

function fail(msg: string) {
  console.log(`  ${CROSS} ${msg}`);
  totalFailed++;
}

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function loadPlans(): Promise<Record<string, PlanRow>> {
  const { data, error } = await supabase
    .from('plan_rules')
    .select('id, plan, stripe_product_id, stripe_price_id_base, stripe_price_id_metered, stripe_meter_event_name, max_sales_monthly, overage_price_cents');
  if (error) throw error;
  const byPlan: Record<string, PlanRow> = {};
  for (const row of data as PlanRow[]) byPlan[row.plan] = row;
  return byPlan;
}

// ---------------------------------------------------------------------------
// Scenario A — Setup validation
// ---------------------------------------------------------------------------

async function scenarioA_validateSetup(plans: Record<string, PlanRow>): Promise<void> {
  section('SCENARIO A — Setup validation');

  // A.1 Free & Unlimited have no Stripe IDs
  for (const slug of ['free', 'unlimited']) {
    const p = plans[slug];
    if (!p) { fail(`plan '${slug}' missing in plan_rules`); continue; }
    if (p.stripe_product_id === null && p.stripe_price_id_base === null) {
      pass(`plan '${slug}' has null Stripe IDs (correct)`);
    } else {
      fail(`plan '${slug}' has non-null Stripe IDs`);
    }
  }

  // A.2 Paid plans have all Stripe IDs populated
  for (const slug of ['pro', 'starter', 'enterprise']) {
    const p = plans[slug];
    if (!p) { fail(`plan '${slug}' missing in plan_rules`); continue; }
    if (p.stripe_product_id && p.stripe_price_id_base && p.stripe_price_id_metered && p.stripe_meter_event_name) {
      pass(`plan '${slug}' has all Stripe IDs populated`);
    } else {
      fail(`plan '${slug}' missing some Stripe IDs`);
    }
  }

  // A.3 Stripe product names match expected
  const expectedNames: Record<string, string> = {
    pro: 'Sentinela Pro',
    starter: 'Sentinela Starter',
    enterprise: 'Sentinela Enterprise',
  };
  for (const slug of Object.keys(expectedNames)) {
    const productId = plans[slug]?.stripe_product_id;
    if (!productId) continue;
    const product = await stripe.products.retrieve(productId);
    if (product.name === expectedNames[slug]) {
      pass(`Stripe product '${slug}' name = '${product.name}'`);
    } else {
      fail(`Stripe product '${slug}' name mismatch: got '${product.name}', expected '${expectedNames[slug]}'`);
    }
  }

  // A.4 Base prices match expected amounts (centavos)
  const expectedBase: Record<string, number> = {
    pro: 5990,
    starter: 11990,
    enterprise: 19990,
  };
  for (const slug of Object.keys(expectedBase)) {
    const priceId = plans[slug]?.stripe_price_id_base;
    if (!priceId) continue;
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount === expectedBase[slug] && price.currency === 'brl' && price.recurring?.interval === 'month') {
      pass(`base price '${slug}' = R$ ${(expectedBase[slug] / 100).toFixed(2)} (month, brl)`);
    } else {
      fail(`base price '${slug}' mismatch`);
    }
  }

  // A.5 Metered prices
  const expectedOverage: Record<string, number> = { pro: 14, starter: 12, enterprise: 7 };
  for (const slug of Object.keys(expectedOverage)) {
    const priceId = plans[slug]?.stripe_price_id_metered;
    if (!priceId) continue;
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount === expectedOverage[slug] && price.recurring?.usage_type === 'metered') {
      pass(`metered price '${slug}' = R$ ${(expectedOverage[slug] / 100).toFixed(2)}/sale (metered)`);
    } else {
      fail(`metered price '${slug}' mismatch`);
    }
  }

  // A.6 Customer Portal configuration exists
  const portals = await stripe.billingPortal.configurations.list({ limit: 10 });
  const ours = portals.data.find((c) => c.business_profile?.headline === 'Sentinela Billing');
  if (ours) {
    pass(`Customer Portal config ${ours.id} exists`);
    if (ours.features.subscription_update?.enabled) pass('  portal subscription_update enabled');
    else fail('  portal subscription_update disabled');
    if (ours.features.subscription_cancel?.enabled) pass('  portal subscription_cancel enabled');
    else fail('  portal subscription_cancel disabled');
    if (ours.features.payment_method_update?.enabled) pass('  portal payment_method_update enabled');
    else fail('  portal payment_method_update disabled');
    if (ours.features.invoice_history?.enabled) pass('  portal invoice_history enabled');
    else fail('  portal invoice_history disabled');
  } else {
    fail('Customer Portal config not found');
  }
}

// ---------------------------------------------------------------------------
// Scenario B — Subscription lifecycle
// ---------------------------------------------------------------------------

async function scenarioB_subscriptionLifecycle(plans: Record<string, PlanRow>): Promise<{
  customerId: string;
  subscriptionId: string;
}> {
  section('SCENARIO B — Subscription lifecycle (create/upgrade/downgrade/cancel)');

  const testEmail = `scenario-b-${Date.now()}@sentinela-test.local`;
  const userId = `user-test-${Date.now()}`;

  // B.1 Create Stripe customer (simulates lazy customer creation)
  const customer = await stripe.customers.create({
    email: testEmail,
    name: 'Scenario B Test User',
    metadata: { user_id: userId, cpf: '' },
  });
  pass(`customer ${customer.id} created for ${testEmail}`);

  // B.2 Attach a test payment method (simulates Checkout completion)
  const pm = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' }, // test token that always succeeds
  });
  await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  pass(`payment method ${pm.id} attached as default`);

  // B.3 Create Pro subscription with both items (base + metered)
  const proPlan = plans.pro;
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [
      { price: proPlan.stripe_price_id_base! },
      { price: proPlan.stripe_price_id_metered! },
    ],
    metadata: { user_id: userId, plan_id: proPlan.id },
    expand: ['latest_invoice.payment_intent'],
  });
  pass(`subscription ${sub.id} created on Pro plan, status=${sub.status}`);

  // Validate: metadata propagated
  if (sub.metadata.user_id === userId && sub.metadata.plan_id === proPlan.id) {
    pass('subscription.metadata has user_id and plan_id');
  } else {
    fail('subscription.metadata missing user_id or plan_id');
  }

  // Validate: status is active (immediate activation with default PM)
  if (sub.status === 'active') pass('subscription status = active');
  else fail(`subscription status = ${sub.status} (expected active)`);

  // B.4 Upgrade Pro → Starter (change price on the base item)
  const starterPlan = plans.starter;
  const baseItem = sub.items.data.find((i) => i.price.id === proPlan.stripe_price_id_base)!;
  const meteredItem = sub.items.data.find((i) => i.price.id === proPlan.stripe_price_id_metered)!;

  const upgraded = await stripe.subscriptions.update(sub.id, {
    items: [
      { id: baseItem.id, price: starterPlan.stripe_price_id_base! },
      { id: meteredItem.id, price: starterPlan.stripe_price_id_metered! },
    ],
    proration_behavior: 'create_prorations',
  });
  const upgradedBasePrice = upgraded.items.data.find((i) => i.price.recurring?.usage_type === 'licensed')?.price.id;
  if (upgradedBasePrice === starterPlan.stripe_price_id_base) {
    pass(`upgrade Pro → Starter succeeded (base price = ${upgradedBasePrice})`);
  } else {
    fail(`upgrade failed, base price = ${upgradedBasePrice}`);
  }

  // B.5 Schedule cancellation at period end (simulates downgrade-to-Free via Portal)
  const canceled = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: true,
  });
  if (canceled.cancel_at_period_end === true) {
    pass('subscription marked cancel_at_period_end=true');
  } else {
    fail('subscription cancel_at_period_end not set');
  }

  // B.6 Reactivate (clear cancel flag)
  const reactivated = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: false,
  });
  if (reactivated.cancel_at_period_end === false) {
    pass('subscription reactivated (cancel_at_period_end=false)');
  } else {
    fail('reactivation did not clear flag');
  }

  return { customerId: customer.id, subscriptionId: sub.id };
}

// ---------------------------------------------------------------------------
// Scenario C — Meter events (overage billing)
// ---------------------------------------------------------------------------

async function scenarioC_meterEvents(
  plans: Record<string, PlanRow>,
  customerId: string,
): Promise<void> {
  section('SCENARIO C — Meter events (overage billing)');

  const eventName = plans.pro.stripe_meter_event_name!;
  const identifier1 = `scenario-c-${Date.now()}-1`;
  const identifier2 = `scenario-c-${Date.now()}-2`;

  // Note: our Pro subscription was upgraded to Starter in Scenario B, but meter
  // events are reported against the customer, not the subscription item directly.
  // Stripe will attribute the event to whichever active subscription uses the
  // meter. For this test, the customer currently has Starter (with starter meter).

  // Use Starter's meter since that's what's active
  const starterMeterName = plans.starter.stripe_meter_event_name!;

  // C.1 Emit first meter event
  const event1 = await stripe.billing.meterEvents.create({
    event_name: starterMeterName,
    identifier: identifier1,
    timestamp: Math.floor(Date.now() / 1000),
    payload: {
      value: '1',
      stripe_customer_id: customerId,
    },
  });
  if (event1.identifier === identifier1) {
    pass(`meter event 1 accepted: ${identifier1}`);
  } else {
    fail('meter event 1 not accepted');
  }

  // C.2 Emit second meter event (different identifier → counts separately)
  const event2 = await stripe.billing.meterEvents.create({
    event_name: starterMeterName,
    identifier: identifier2,
    timestamp: Math.floor(Date.now() / 1000),
    payload: {
      value: '1',
      stripe_customer_id: customerId,
    },
  });
  if (event2.identifier === identifier2) {
    pass(`meter event 2 accepted: ${identifier2}`);
  } else {
    fail('meter event 2 not accepted');
  }

  // C.3 Idempotency: re-send same identifier — Stripe rejects duplicates
  // with a 400 error. Our backend wraps the call in try/catch and treats
  // "already exists" as a success (so retries from reconciliation cron
  // are safe).
  try {
    await stripe.billing.meterEvents.create({
      event_name: starterMeterName,
      identifier: identifier1,
      timestamp: Math.floor(Date.now() / 1000),
      payload: {
        value: '1',
        stripe_customer_id: customerId,
      },
    });
    fail('duplicate meter event did not raise — idempotency not enforced');
  } catch (err: any) {
    if (err?.raw?.message?.includes('already exists')) {
      pass(`duplicate identifier rejected by Stripe (${err.raw.message.split('.')[0]})`);
    } else {
      fail(`unexpected error on duplicate: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario D — Cancel subscription completely
// ---------------------------------------------------------------------------

async function scenarioD_cancelAndCleanup(customerId: string, subscriptionId: string): Promise<void> {
  section('SCENARIO D — Cancel and cleanup');

  // D.1 Cancel subscription immediately
  const canceled = await stripe.subscriptions.cancel(subscriptionId);
  if (canceled.status === 'canceled') {
    pass(`subscription ${subscriptionId} canceled (status=canceled)`);
  } else {
    fail(`subscription status after cancel = ${canceled.status}`);
  }

  // D.2 Delete customer (cleanup)
  const deleted = await stripe.customers.del(customerId);
  if (deleted.deleted === true) {
    pass(`customer ${customerId} deleted`);
  } else {
    fail(`customer deletion returned unexpected shape`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       Sentinela × Stripe — E2E Scenario Tests (test mode)          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  const plans = await loadPlans();

  await scenarioA_validateSetup(plans);

  const { customerId, subscriptionId } = await scenarioB_subscriptionLifecycle(plans);

  await scenarioC_meterEvents(plans, customerId);

  await scenarioD_cancelAndCleanup(customerId, subscriptionId);

  section('RESULT');
  console.log(`  Passed: ${totalPassed}`);
  console.log(`  Failed: ${totalFailed}`);
  if (totalFailed > 0) {
    console.log('\nSome scenarios failed. See output above.');
    process.exit(1);
  } else {
    console.log('\nAll scenarios passed.');
  }
}

main().catch((err) => {
  console.error('\nScenario run crashed:', err);
  process.exit(1);
});
