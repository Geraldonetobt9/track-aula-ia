import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
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

async function syncPlan(cfg: PlanConfig): Promise<{ slug: string; productId: string; basePriceId: string; meteredPriceId: string }> {
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
  console.log(`  plan_rules row updated`);

  return { slug: cfg.slug, productId, basePriceId, meteredPriceId };
}

async function upsertPortalConfig(productIds: Awaited<ReturnType<typeof syncPlan>>[]): Promise<void> {
  console.log('\nCustomer Portal');

  const existing = await stripe.billingPortal.configurations.list({ limit: 10 });
  const found = existing.data.find((c) => c.business_profile?.headline === 'Sentinela Billing');

  const config: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: { headline: 'Sentinela Billing' },
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        // Portal's subscription_update only accepts licensed (fixed) prices.
        // Metered prices travel automatically with any subscription that uses
        // these products, so only the base price belongs here.
        products: productIds.map((p) => ({
          product: p.productId,
          prices: [p.basePriceId],
        })),
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'],
        },
      },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
    },
  };

  if (found) {
    await stripe.billingPortal.configurations.update(found.id, config as Stripe.BillingPortal.ConfigurationUpdateParams);
    console.log(`  Configuration ${found.id} [updated]`);
  } else {
    const created = await stripe.billingPortal.configurations.create(config);
    console.log(`  Configuration ${created.id} [created]`);
  }
}

async function main(): Promise<void> {
  const isTestKey = STRIPE_SECRET_KEY!.startsWith('sk_test');
  console.log(`Syncing Stripe for ${isTestKey ? 'TEST' : 'LIVE'} mode (key: ${STRIPE_SECRET_KEY!.slice(0, 8)}...)`);

  const productIds: Awaited<ReturnType<typeof syncPlan>>[] = [];
  for (const cfg of PLANS) {
    productIds.push(await syncPlan(cfg));
  }

  await upsertPortalConfig(productIds);

  console.log(`
Sync complete. Next steps:
  [ ] Stripe Dashboard -> Settings -> Billing -> Subscriptions and emails -> Manage failed payment retries:
      Number of retries: 2
      After failed payments: Cancel subscription
  [ ] Developers -> Webhooks -> Add endpoint:
      URL: https://<backend>/api/stripe/webhook
      Events: checkout.session.completed,
              customer.subscription.created,
              customer.subscription.updated,
              customer.subscription.deleted,
              invoice.paid,
              invoice.payment_failed
      Copy signing secret -> STRIPE_WEBHOOK_SECRET env var
`);
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
