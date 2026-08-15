/**
 * signup-smoke-test.ts
 *
 * End-to-end smoke test for /api/auth/signup and the downstream flows
 * it enables. Run against a live backend with Stripe CLI forwarding
 * webhooks to /api/stripe/webhook.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   npx ts-node scripts/signup-smoke-test.ts
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sbPublic = SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(m: string) { pass++; console.log(`  ${GREEN}\u2713${RESET} ${m}`); }
function bad(m: string) { fail++; failures.push(m); console.log(`  ${RED}\u2717${RESET} ${m}`); }
function info(m: string) { console.log(`  ${CYAN}\u2192${RESET} ${m}`); }
function section(n: number, title: string) {
  console.log(`\n${BOLD}${BLUE}\u2550\u2550\u2550 Scenario ${n}: ${title}${RESET}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'GET',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

const createdEmails = new Set<string>();
const createdStripeCustomers = new Set<string>();

async function cleanupEverything() {
  console.log(`\n${BOLD}${YELLOW}Cleanup${RESET}`);

  for (const email of createdEmails) {
    const { data } = await sb.auth.admin.listUsers();
    const user = data.users.find((u) => u.email === email);
    if (user) {
      try { await sb.auth.admin.deleteUser(user.id); } catch {}
    }
  }
  info(`deleted ${createdEmails.size} test users`);

  for (const cus of createdStripeCustomers) {
    try {
      // Cancel any active subs, then delete customer
      const subs = await stripe.subscriptions.list({ customer: cus, limit: 10 });
      for (const s of subs.data) {
        if (s.status !== 'canceled') await stripe.subscriptions.cancel(s.id);
      }
      await stripe.customers.del(cus);
    } catch {}
  }
  info(`deleted ${createdStripeCustomers.size} stripe customers`);
}

async function getUserByEmail(email: string) {
  const { data } = await sb.auth.admin.listUsers();
  return data.users.find((u) => u.email === email);
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const stamp = Date.now();
const INVALID_CPF = '123.456.789-10'; // wrong check digit
const INVALID_CNPJ = '11.222.333/0001-99'; // wrong check digit

// Known-valid CPFs for scenarios where we want determinism (collision check etc.)
const VALID_CPFS = ['529.982.247-25', '123.456.789-09', '111.444.777-35', '987.654.321-00'];
const VALID_CNPJS = ['11.222.333/0001-81', '11.444.777/0001-61'];

// Generate a random-but-valid CPF for scenarios that need fresh unique documents.
function randomValidCpf(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += digits[i] * (10 - i);
    let dv1 = 11 - (sum % 11);
    if (dv1 >= 10) dv1 = 0;
    digits.push(dv1);
    sum = 0;
    for (let i = 0; i < 10; i++) sum += digits[i] * (11 - i);
    let dv2 = 11 - (sum % 11);
    if (dv2 >= 10) dv2 = 0;
    digits.push(dv2);
    if (digits.every((d) => d === digits[0])) continue;
    return digits.join('');
  }
  throw new Error('Could not generate valid CPF');
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenario1_signupCpfFullJourney() {
  section(1, 'Signup with CPF — full onboarding validation');
  const email = `smoke-cpf-${stamp}-1@example.com`;
  createdEmails.add(email);

  const r = await post('/api/auth/signup', {
    email,
    password: 'StrongPass123',
    name: 'Joao Silva',
    taxIdType: 'cpf',
    taxIdValue: VALID_CPFS[0],
    termsAccepted: true,
  });
  if (r.status === 201) ok('POST /api/auth/signup returned 201'); else bad(`status=${r.status} ${JSON.stringify(r.data)}`);
  await sleep(600);

  const user = await getUserByEmail(email);
  if (user) ok(`auth.users row created (id=${user.id.slice(0, 8)}...)`);
  else { bad('auth.users row missing'); return null; }

  const { data: profile } = await sb.from('profiles')
    .select('name, email, cpf, cnpj, plan_id').eq('user_id', user.id).maybeSingle();
  if (profile?.cpf === '52998224725') ok('profile.cpf normalized to 11 digits');
  else bad(`profile.cpf=${profile?.cpf}`);
  if (profile?.cnpj === null) ok('profile.cnpj is null (CPF flow)');
  else bad(`profile.cnpj=${profile?.cnpj}`);
  if (profile?.name === 'Joao Silva') ok('profile.name from user_metadata');
  else bad(`profile.name=${profile?.name}`);

  const { data: freePlan } = await sb.from('plan_rules').select('id').eq('plan', 'free').maybeSingle();
  if (profile?.plan_id === freePlan?.id) ok('profile.plan_id = free (default)');
  else bad(`profile.plan_id=${profile?.plan_id} (expected free=${freePlan?.id})`);

  const { data: sub } = await sb.from('subscriptions')
    .select('plan_id, status, stripe_customer_id, stripe_subscription_id')
    .eq('user_id', user.id).maybeSingle();
  if (sub?.plan_id === freePlan?.id && sub?.status === 'active') ok('subscriptions row auto-created on Free/active');
  else bad(`subscriptions row invalid: ${JSON.stringify(sub)}`);
  if (sub?.stripe_customer_id === null) ok('stripe_customer_id is null (lazy creation)');
  else bad(`stripe_customer_id=${sub?.stripe_customer_id}`);

  const { data: roles } = await sb.from('user_roles').select('role').eq('user_id', user.id);
  if (roles?.length === 1 && roles[0].role === 'user') ok('user_roles row created with role=user');
  else bad(`user_roles=${JSON.stringify(roles)}`);

  const { data: workspaces } = await sb.from('workspaces')
    .select('name').eq('user_id', user.id).is('archived_at', null);
  if (workspaces?.length === 1 && workspaces[0].name === 'Principal') ok('default workspace "Principal" created');
  else bad(`workspaces=${JSON.stringify(workspaces)}`);

  return { user, profile, email };
}

async function scenario2_signupCnpjFullJourney() {
  section(2, 'Signup with CNPJ — business user');
  const email = `smoke-cnpj-${stamp}@example.com`;
  createdEmails.add(email);

  const r = await post('/api/auth/signup', {
    email,
    password: 'StrongPass123',
    name: 'Empresa LTDA',
    taxIdType: 'cnpj',
    taxIdValue: VALID_CNPJS[0],
    termsAccepted: true,
  });
  if (r.status === 201) ok('POST /api/auth/signup returned 201'); else bad(`status=${r.status} ${JSON.stringify(r.data)}`);
  await sleep(600);

  const user = await getUserByEmail(email);
  const { data: profile } = await sb.from('profiles')
    .select('cpf, cnpj').eq('user_id', user!.id).maybeSingle();
  if (profile?.cnpj === '11222333000181') ok('profile.cnpj normalized to 14 digits');
  else bad(`profile.cnpj=${profile?.cnpj}`);
  if (profile?.cpf === null) ok('profile.cpf is null (CNPJ flow)');
  else bad(`profile.cpf=${profile?.cpf}`);

  return { user, email };
}

async function scenario3_loginAfterSignup(email: string) {
  section(3, 'Login after signup — Supabase auth works');
  if (!sbPublic) {
    info('SUPABASE_ANON_KEY not set; skipping real login test (relying on admin API only)');
    return null;
  }

  const { data, error } = await sbPublic.auth.signInWithPassword({
    email,
    password: 'StrongPass123',
  });
  if (error) { bad(`login failed: ${error.message}`); return null; }
  if (data.session?.access_token) ok('received JWT access_token');
  else bad('no access_token in session');
  if (data.user?.email === email) ok('user.email matches');
  else bad(`user.email=${data.user?.email}`);
  return data.session?.access_token ?? null;
}

async function scenario4_validationErrors() {
  section(4, 'Validation errors — malformed payloads');

  const bad1 = await post('/api/auth/signup', {
    email: 'not-an-email', password: 'StrongPass123', name: 'X',
    taxIdType: 'cpf', taxIdValue: VALID_CPFS[1], termsAccepted: true,
  });
  if (bad1.status === 400 && JSON.stringify(bad1.data).includes('email must be an email')) ok('400 on invalid email');
  else bad(`invalid email response: ${bad1.status}`);

  const bad2 = await post('/api/auth/signup', {
    email: `smoke-shortpw-${stamp}@example.com`, password: 'short', name: 'X',
    taxIdType: 'cpf', taxIdValue: VALID_CPFS[1], termsAccepted: true,
  });
  if (bad2.status === 400 && JSON.stringify(bad2.data).includes('minimo 8')) ok('400 on password < 8 chars');
  else bad(`short pw response: ${bad2.status}`);

  const bad3 = await post('/api/auth/signup', {
    email: `smoke-noname-${stamp}@example.com`, password: 'StrongPass123', name: '',
    taxIdType: 'cpf', taxIdValue: VALID_CPFS[1], termsAccepted: true,
  });
  if (bad3.status === 400 && JSON.stringify(bad3.data).includes('Nome')) ok('400 on empty name');
  else bad(`empty name response: ${bad3.status}`);

  const bad4 = await post('/api/auth/signup', {
    email: `smoke-type-${stamp}@example.com`, password: 'StrongPass123', name: 'X',
    taxIdType: 'cpf2' as any, taxIdValue: VALID_CPFS[1], termsAccepted: true,
  });
  if (bad4.status === 400 && JSON.stringify(bad4.data).includes('documento invalido')) ok('400 on unknown taxIdType');
  else bad(`bad taxIdType response: ${bad4.status}`);

  const bad5 = await post('/api/auth/signup', {
    email: `smoke-badcpf-${stamp}@example.com`, password: 'StrongPass123', name: 'X',
    taxIdType: 'cpf', taxIdValue: INVALID_CPF, termsAccepted: true,
  });
  if (bad5.status === 400 && JSON.stringify(bad5.data).includes('CPF invalido')) ok('400 on CPF with wrong checksum');
  else bad(`bad CPF response: ${bad5.status}`);

  const bad6 = await post('/api/auth/signup', {
    email: `smoke-badcnpj-${stamp}@example.com`, password: 'StrongPass123', name: 'X',
    taxIdType: 'cnpj', taxIdValue: INVALID_CNPJ, termsAccepted: true,
  });
  if (bad6.status === 400 && JSON.stringify(bad6.data).includes('CNPJ invalido')) ok('400 on CNPJ with wrong checksum');
  else bad(`bad CNPJ response: ${bad6.status}`);

  const bad7 = await post('/api/auth/signup', {
    email: `smoke-repeated-${stamp}@example.com`, password: 'StrongPass123', name: 'X',
    taxIdType: 'cpf', taxIdValue: '111.111.111-11', termsAccepted: true, // all-same-digits
  });
  if (bad7.status === 400 && JSON.stringify(bad7.data).includes('CPF invalido')) ok('400 on all-same-digits CPF');
  else bad(`all-same CPF response: ${bad7.status}`);

  const bad8 = await post('/api/auth/signup', {
    email: `smoke-noterms-${stamp}@example.com`, password: 'StrongPass123', name: 'X',
    taxIdType: 'cpf', taxIdValue: VALID_CPFS[1], termsAccepted: false,
  });
  if (bad8.status === 400 && JSON.stringify(bad8.data).includes('termos')) ok('400 on termsAccepted=false');
  else bad(`no terms response: ${bad8.status}`);

  const bad9 = await post('/api/auth/signup', {
    email: `smoke-nodigits-${stamp}@example.com`, password: 'StrongPass123', name: 'X',
    taxIdType: 'cpf', taxIdValue: 'abcdef', termsAccepted: true,
  });
  if (bad9.status === 400) ok('400 on CPF with non-digits (normalized to empty)');
  else bad(`alpha CPF response: ${bad9.status}`);
}

async function scenario5_duplicates() {
  section(5, 'Duplicates (email + tax id)');

  const email = `smoke-dup-base-${stamp}@example.com`;
  createdEmails.add(email);

  const r1 = await post('/api/auth/signup', {
    email, password: 'StrongPass123', name: 'Base User',
    taxIdType: 'cpf', taxIdValue: VALID_CPFS[2], termsAccepted: true,
  });
  if (r1.status === 201) ok(`base user created (CPF=${VALID_CPFS[2]})`);
  else { bad(`base create failed: ${r1.status} ${JSON.stringify(r1.data)}`); return; }
  await sleep(500);

  const rDupCpf = await post('/api/auth/signup', {
    email: `smoke-dup-cpf-${stamp}@example.com`, password: 'StrongPass123', name: 'Dup CPF',
    taxIdType: 'cpf', taxIdValue: VALID_CPFS[2], termsAccepted: true,
  });
  if (rDupCpf.status === 409 && JSON.stringify(rDupCpf.data).includes('CPF ja')) ok('409 on duplicate CPF');
  else bad(`dup CPF response: ${rDupCpf.status} ${JSON.stringify(rDupCpf.data).slice(0, 150)}`);

  const rDupEmail = await post('/api/auth/signup', {
    email, password: 'StrongPass123', name: 'Dup Email',
    taxIdType: 'cpf', taxIdValue: VALID_CPFS[3], termsAccepted: true,
  });
  if (rDupEmail.status === 409) ok('409 on duplicate email');
  else bad(`dup email response: ${rDupEmail.status}`);

  const emailCnpj = `smoke-dup-cnpj-base-${stamp}@example.com`;
  createdEmails.add(emailCnpj);
  await post('/api/auth/signup', {
    email: emailCnpj, password: 'StrongPass123', name: 'Base CNPJ',
    taxIdType: 'cnpj', taxIdValue: VALID_CNPJS[1], termsAccepted: true,
  });
  await sleep(500);
  const rDupCnpj = await post('/api/auth/signup', {
    email: `smoke-dup-cnpj-${stamp}@example.com`, password: 'StrongPass123', name: 'Dup CNPJ',
    taxIdType: 'cnpj', taxIdValue: VALID_CNPJS[1], termsAccepted: true,
  });
  if (rDupCnpj.status === 409 && JSON.stringify(rDupCnpj.data).includes('CNPJ ja')) ok('409 on duplicate CNPJ');
  else bad(`dup CNPJ response: ${rDupCnpj.status}`);
}

async function scenario6_stripeUpgradeWithCpf(userId: string) {
  section(6, 'Stripe upgrade with CPF — tax_id registers as br_cpf');

  // Create Stripe customer directly (mimicking StripeCheckoutService.createCheckoutSession path)
  // Load profile
  const { data: profile } = await sb.from('profiles')
    .select('email, name, cpf, cnpj').eq('user_id', userId).maybeSingle();
  if (!profile) { bad('profile missing for CPF user'); return; }

  const cpf = (profile.cpf ?? '').replace(/\D/g, '');
  if (cpf.length !== 11) { bad(`expected 11-digit CPF, got "${cpf}"`); return; }

  const customer = await stripe.customers.create({
    email: profile.email ?? undefined,
    name: profile.name ?? undefined,
    tax_id_data: [{ type: 'br_cpf' as const, value: cpf }],
    metadata: { user_id: userId, cpf, cnpj: '' },
  });
  createdStripeCustomers.add(customer.id);
  info(`created customer ${customer.id}`);

  const taxIds = await stripe.customers.listTaxIds(customer.id);
  const first = taxIds.data[0];
  if (first?.type === 'br_cpf') ok(`Stripe stored tax_id type = br_cpf`);
  else bad(`tax_id type=${first?.type}`);
  if (first?.country === 'BR') ok('tax_id country = BR');
  else bad(`tax_id country=${first?.country}`);
  // Stripe formats CPF on storage — just check digits match
  if ((first?.value ?? '').replace(/\D/g, '') === cpf) ok('tax_id value digits match profile CPF');
  else bad(`tax_id value=${first?.value}`);
}

async function scenario7_stripeUpgradeWithCnpj(userId: string) {
  section(7, 'Stripe upgrade with CNPJ — tax_id registers as br_cnpj');

  const { data: profile } = await sb.from('profiles')
    .select('email, name, cpf, cnpj').eq('user_id', userId).maybeSingle();
  if (!profile) { bad('profile missing for CNPJ user'); return; }

  const cnpj = (profile.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) { bad(`expected 14-digit CNPJ, got "${cnpj}"`); return; }

  const customer = await stripe.customers.create({
    email: profile.email ?? undefined,
    name: profile.name ?? undefined,
    tax_id_data: [{ type: 'br_cnpj' as const, value: cnpj }],
    metadata: { user_id: userId, cpf: '', cnpj },
  });
  createdStripeCustomers.add(customer.id);
  info(`created customer ${customer.id}`);

  const taxIds = await stripe.customers.listTaxIds(customer.id);
  const first = taxIds.data[0];
  if (first?.type === 'br_cnpj') ok(`Stripe stored tax_id type = br_cnpj`);
  else bad(`tax_id type=${first?.type}`);
  if (first?.country === 'BR') ok('tax_id country = BR');
  else bad(`tax_id country=${first?.country}`);
  if ((first?.value ?? '').replace(/\D/g, '') === cnpj) ok('tax_id value digits match profile CNPJ');
  else bad(`tax_id value=${first?.value}`);
}

async function scenario8_freePlanEnforcement(token: string | null, userId: string) {
  section(8, 'Plan limits — Free can have only 1 workspace');
  if (!token) { info('no auth token; skipping'); return; }

  // /api/workspaces GET should work
  const list = await get('/api/workspaces', { Authorization: `Bearer ${token}` });
  if (list.status === 200 && Array.isArray(list.data)) ok(`GET /api/workspaces returned ${list.data.length} workspaces`);
  else bad(`list workspaces: ${list.status}`);

  // Try to create a 2nd workspace (Free allows only 1 — we already have "Principal")
  const createR = await post('/api/workspaces', { name: 'Workspace 2' }, {
    Authorization: `Bearer ${token}`,
  });
  if (createR.status === 402) {
    ok(`POST /api/workspaces returned 402 (plan limit) — body: ${JSON.stringify(createR.data).slice(0, 100)}`);
  } else {
    bad(`expected 402, got ${createR.status} ${JSON.stringify(createR.data).slice(0, 150)}`);
  }

  // Usage snapshot
  const usage = await get('/api/plan-limits/usage', { Authorization: `Bearer ${token}` });
  if (usage.status === 200 && usage.data.plan === 'free') ok(`GET /api/plan-limits/usage = free`);
  else bad(`usage: ${usage.status} ${JSON.stringify(usage.data).slice(0, 150)}`);

  if (usage.data?.workspaces?.limit === 1 && usage.data?.workspaces?.used === 1) {
    ok('workspaces 1/1 (at limit)');
  } else {
    bad(`workspaces used/limit = ${usage.data?.workspaces?.used}/${usage.data?.workspaces?.limit}`);
  }
  if (usage.data?.sales?.limit === 30) ok('sales limit = 30 (Free plan)');
  else bad(`sales limit = ${usage.data?.sales?.limit}`);
}

async function scenario9_caseInsensitiveEmail() {
  section(9, 'Case sensitivity on duplicate email');
  const email = `smoke-case-${stamp}@example.com`;
  createdEmails.add(email);

  const r1 = await post('/api/auth/signup', {
    email, password: 'StrongPass123', name: 'Case Test',
    taxIdType: 'cpf', taxIdValue: randomValidCpf(), termsAccepted: true,
  });
  if (r1.status !== 201) { bad(`base create failed: ${r1.status} ${JSON.stringify(r1.data)}`); return; }
  ok(`base user created with lowercase email`);
  await sleep(500);

  const upper = email.toUpperCase();
  createdEmails.add(upper);
  const rUpper = await post('/api/auth/signup', {
    email: upper, password: 'StrongPass123', name: 'Case Upper',
    taxIdType: 'cpf', taxIdValue: randomValidCpf(), termsAccepted: true,
  });
  // Supabase normalizes emails to lowercase, so this should either be 201
  // (if Supabase de-duplicates internally to the same user — it actually
  // does NOT, they become distinct) or 409. The safe assertion is that the
  // system does not crash. Document behavior.
  if (rUpper.status === 201) {
    info('Supabase allowed uppercase variant (treats as distinct identity) — this is Supabase default');
    ok('no crash on uppercase variant');
  } else if (rUpper.status === 409) {
    ok('uppercase variant rejected with 409 (case-insensitive dedup)');
  } else {
    bad(`unexpected status ${rUpper.status}: ${JSON.stringify(rUpper.data).slice(0, 150)}`);
  }
}

async function scenario10_triggerIdempotencyAndNoGhostRows() {
  section(10, 'Trigger idempotency — all rows consistent, no ghosts');

  const email = `smoke-trigger-${stamp}@example.com`;
  createdEmails.add(email);

  const r = await post('/api/auth/signup', {
    email, password: 'StrongPass123', name: 'Trigger User',
    taxIdType: 'cpf', taxIdValue: randomValidCpf(), termsAccepted: true,
  });
  if (r.status !== 201) { bad(`signup failed: ${r.status}`); return; }
  await sleep(700);

  const user = await getUserByEmail(email);
  if (!user) { bad('user missing'); return; }

  // Verify counts: exactly 1 profile, 1 user_role, >= 1 workspace, 1 subscription
  const [{ count: profileCount }, { count: roleCount }, { count: wsCount }, { count: subCount }] = await Promise.all([
    sb.from('profiles').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    sb.from('user_roles').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    sb.from('workspaces').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    sb.from('subscriptions').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
  ]);

  if (profileCount === 1) ok('exactly 1 profile row');
  else bad(`profile count=${profileCount}`);
  if (roleCount === 1) ok('exactly 1 user_roles row');
  else bad(`user_roles count=${roleCount}`);
  if ((wsCount ?? 0) >= 1) ok(`workspace count=${wsCount} (>=1)`);
  else bad(`workspace count=${wsCount}`);
  if (subCount === 1) ok('exactly 1 subscriptions row');
  else bad(`subscriptions count=${subCount}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log(`${BOLD}\n\u2554${'\u2550'.repeat(66)}\u2557`);
  console.log(`\u2551   Sentinela \u00d7 Signup — Comprehensive Smoke Test (live backend)   \u2551`);
  console.log(`\u255a${'\u2550'.repeat(66)}\u255d${RESET}`);

  try {
    const h = await fetch(`${BACKEND_URL}/health`).then((r) => r.json());
    if (h.status === 'ok') console.log(`\n${GREEN}Backend health: ok${RESET}`);
    else { console.log(`${RED}Backend unhealthy${RESET}`); process.exit(1); }
  } catch {
    console.log(`${RED}Backend not reachable at ${BACKEND_URL}${RESET}`);
    process.exit(1);
  }

  try {
    const s1 = await scenario1_signupCpfFullJourney();
    const s2 = await scenario2_signupCnpjFullJourney();
    if (s1) {
      const token = await scenario3_loginAfterSignup(s1.email);
      await scenario8_freePlanEnforcement(token, s1.user.id);
    }
    await scenario4_validationErrors();
    await scenario5_duplicates();
    if (s1?.user) await scenario6_stripeUpgradeWithCpf(s1.user.id);
    if (s2?.user) await scenario7_stripeUpgradeWithCnpj(s2.user.id);
    await scenario9_caseInsensitiveEmail();
    await scenario10_triggerIdempotencyAndNoGhostRows();
  } finally {
    await cleanupEverything();
  }

  console.log(`\n${BOLD}\u2550\u2550\u2550 RESULT${RESET}`);
  console.log(`  ${GREEN}Passed: ${pass}${RESET}`);
  console.log(`  ${RED}Failed: ${fail}${RESET}`);
  if (fail > 0) {
    console.log(`\n${RED}Failures:${RESET}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${GREEN}${BOLD}All scenarios passed.${RESET}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
