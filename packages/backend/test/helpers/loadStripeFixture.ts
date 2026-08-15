import { readFileSync } from 'fs';
import { join } from 'path';
import type Stripe from 'stripe';

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'stripe');

export interface FixtureOverrides {
  id?: string;
  userId?: string;
  planId?: string;
  customerId?: string;
  subscriptionId?: string;
}

export function loadStripeFixture<T extends Stripe.Event = Stripe.Event>(
  filename: string,
  overrides: FixtureOverrides = {},
): T {
  const path = join(FIXTURES_DIR, filename);
  const raw = readFileSync(path, 'utf-8');
  const event = JSON.parse(raw) as T;

  if (overrides.id) {
    (event as any).id = overrides.id;
  }

  const obj: any = event.data?.object;
  if (obj) {
    if (overrides.userId && obj.metadata) obj.metadata.user_id = overrides.userId;
    if (overrides.planId && obj.metadata) obj.metadata.plan_id = overrides.planId;
    if (overrides.customerId) obj.customer = overrides.customerId;
    if (overrides.subscriptionId) obj.id = overrides.subscriptionId;
  }

  return event;
}
