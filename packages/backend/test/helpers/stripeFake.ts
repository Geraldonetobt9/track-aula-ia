/**
 * Minimal in-memory Stripe client fake for Tier-2 integration tests.
 * Covers: customers, checkout.sessions, subscriptions, billing.meterEvents,
 * billingPortal.sessions, invoices. Not a general-purpose Stripe stub.
 */

interface Customer {
  id: string;
  email?: string;
  name?: string;
  tax_id_data?: any;
  metadata?: Record<string, string>;
}

interface MeterEvent {
  event_name: string;
  identifier: string;
  timestamp: number;
  payload: Record<string, string>;
}

export class StripeFake {
  readonly customers = new Map<string, Customer>();
  readonly subscriptions = new Map<string, any>();
  readonly checkoutSessions: any[] = [];
  readonly portalSessions: any[] = [];
  readonly meterEvents: MeterEvent[] = [];
  readonly meterEventIdentifiers = new Set<string>();
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}_${Date.now()}`;
  }

  getClient() {
    return {
      customers: {
        create: async (payload: Partial<Customer>) => {
          const customer: Customer = { id: this.nextId('cus'), ...payload };
          this.customers.set(customer.id, customer);
          return customer;
        },
      },
      checkout: {
        sessions: {
          create: async (payload: any) => {
            const session = {
              id: this.nextId('cs'),
              url: `https://checkout.stripe.com/${this.counter}`,
              ...payload,
            };
            this.checkoutSessions.push(session);
            return session;
          },
        },
      },
      subscriptions: {
        retrieve: async (id: string) => {
          const sub = this.subscriptions.get(id);
          if (!sub) throw new Error(`No such subscription: ${id}`);
          return sub;
        },
        update: async (id: string, payload: any) => {
          const sub = this.subscriptions.get(id);
          if (!sub) throw new Error(`No such subscription: ${id}`);
          Object.assign(sub, payload);
          return sub;
        },
      },
      billing: {
        meterEvents: {
          create: async (payload: MeterEvent) => {
            if (this.meterEventIdentifiers.has(payload.identifier)) {
              const err: any = new Error(`Meter event with identifier ${payload.identifier} already exists`);
              err.code = 'already_exists';
              err.statusCode = 400;
              throw err;
            }
            this.meterEventIdentifiers.add(payload.identifier);
            this.meterEvents.push(payload);
            return { ...payload };
          },
        },
      },
      billingPortal: {
        sessions: {
          create: async (payload: any) => {
            const session = {
              id: this.nextId('bps'),
              url: `https://billing.stripe.com/${this.counter}`,
              ...payload,
            };
            this.portalSessions.push(session);
            return session;
          },
        },
      },
      invoices: {
        createPreview: async (_payload: any) => ({
          lines: { data: [{ proration: true, amount: 500 }] },
          amount_due: 5000,
          total: 5000,
          next_payment_attempt: null,
          currency: 'brl',
        }),
      },
      webhooks: {
        constructEvent: (rawBody: string | Buffer, signature: string, _secret: string) => {
          if (!signature || signature === 'invalid') throw new Error('Invalid signature');
          return typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString());
        },
      },
    };
  }

  seedSubscription(id: string, data: any): void {
    this.subscriptions.set(id, { id, ...data });
  }
}
