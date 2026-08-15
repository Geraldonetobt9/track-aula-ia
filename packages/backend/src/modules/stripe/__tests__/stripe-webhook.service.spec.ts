import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookService } from '../stripe-webhook.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';

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
        { provide: SubscriptionsService, useValue: { applyPlanChange: jest.fn() } },
        { provide: DiscordLoggerService, useValue: { logApiError: jest.fn() } },
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

  // ─── Task 12: customer.subscription.created ───────────────────────

  describe('customer.subscription.created', () => {
    let applyPlanChange: jest.Mock;
    let updateCalls: any[];

    beforeEach(async () => {
      updateCalls = [];
      applyPlanChange = jest.fn().mockResolvedValue({
        old_plan: 'free',
        new_plan: 'pro',
        unblocked_sales: 0,
        trimmed: {},
      });

      const supabase = {
        getClient: () => ({
          from: (t: string) => {
            if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
            if (t === 'subscriptions') {
              return {
                update: (payload: any) => {
                  updateCalls.push(payload);
                  return { eq: async () => ({ error: null }) };
                },
              };
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

    it('updates subscription row and calls applyPlanChange with period dates', async () => {
      const event = {
        id: 'evt_sub_created_1',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_abc',
            metadata: { user_id: 'user-1', plan_id: 'plan-pro' },
            current_period_start: 1735257600,
            current_period_end: 1737936000,
          },
        },
      } as any;

      await service.handle(event);

      expect(updateCalls[0]).toMatchObject({
        stripe_subscription_id: 'sub_123',
        stripe_customer_id: 'cus_abc',
      });

      expect(applyPlanChange).toHaveBeenCalledWith('user-1', 'plan-pro', {
        periodStart: new Date(1735257600 * 1000).toISOString(),
        periodEnd:   new Date(1737936000 * 1000).toISOString(),
      });
    });

    it('logs error and returns early when metadata is missing', async () => {
      const event = {
        id: 'evt_sub_created_2',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_456',
            customer: 'cus_def',
            metadata: {},
            current_period_start: 1735257600,
            current_period_end: 1737936000,
          },
        },
      } as any;

      await service.handle(event);

      expect(applyPlanChange).not.toHaveBeenCalled();
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ─── Task 13: customer.subscription.deleted ───────────────────────

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

  // ─── Task 14: customer.subscription.updated ───────────────────────

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
        newPlanRulesData: { id: 'plan-pro', plan: 'pro' },
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

  // Scenario 52: checkout.session.completed is informational — no DB writes,
  // no call to SubscriptionsService, just a log line.
  it('checkout.session.completed only logs, no side effects', async () => {
    const applyPlanChange = jest.fn();
    const logApiError = jest.fn();
    const supabase = {
      getClient: () => ({
        from: (t: string) => {
          if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
          return {};
        },
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: SupabaseService, useValue: supabase },
        { provide: SubscriptionsService, useValue: { applyPlanChange } },
        { provide: DiscordLoggerService, useValue: { logApiError } },
      ],
    }).compile();
    const svc = module.get(StripeWebhookService);

    const event = {
      id: 'evt_cs_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1' } },
    } as any;
    await svc.handle(event);

    expect(applyPlanChange).not.toHaveBeenCalled();
    expect(logApiError).not.toHaveBeenCalled();
  });

  // Scenario 58: subscription.updated with a base price id that isn't in
  // plan_rules — logs a warning and returns. No applyPlanChange.
  it('subscription.updated with unknown price id logs warn and returns', async () => {
    const applyPlanChange = jest.fn();
    const supabase = {
      getClient: () => ({
        from: (t: string) => {
          if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
          if (t === 'subscriptions') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: { user_id: 'user-1', plan_id: 'plan-pro', cancel_at_period_end: false },
              error: null,
            }) }) }) };
          }
          if (t === 'plan_rules') {
            // No plan_rules row for this price
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
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
    const svc = module.get(StripeWebhookService);

    const event = {
      id: 'evt_upd_unknown_price', type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1', customer: 'cus_1', cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_unknown', recurring: { usage_type: 'licensed' } } }] },
          current_period_start: 1000, current_period_end: 2000,
        },
        previous_attributes: {},
      },
    } as any;

    await svc.handle(event);
    expect(applyPlanChange).not.toHaveBeenCalled();
  });

  // Scenario 61: event type outside the supported set — logs and returns.
  it('unhandled event type is logged without errors', async () => {
    const applyPlanChange = jest.fn();
    const logApiError = jest.fn();
    const supabase = {
      getClient: () => ({
        from: (t: string) => {
          if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
          return {};
        },
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: SupabaseService, useValue: supabase },
        { provide: SubscriptionsService, useValue: { applyPlanChange } },
        { provide: DiscordLoggerService, useValue: { logApiError } },
      ],
    }).compile();
    const svc = module.get(StripeWebhookService);

    const event = {
      id: 'evt_unknown_type', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    } as any;

    await expect(svc.handle(event)).resolves.toBeUndefined();
    expect(applyPlanChange).not.toHaveBeenCalled();
    expect(logApiError).not.toHaveBeenCalled();
  });

  // Scenario 62: subscription.updated for a Stripe customer we don't know —
  // warns and returns without side effects.
  it('subscription.updated for unknown customer warns and returns', async () => {
    const applyPlanChange = jest.fn();
    const supabase = {
      getClient: () => ({
        from: (t: string) => {
          if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
          if (t === 'subscriptions') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
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
    const svc = module.get(StripeWebhookService);

    const event = {
      id: 'evt_upd_orphan', type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_ghost', customer: 'cus_ghost', cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_base_pro', recurring: { usage_type: 'licensed' } } }] },
          current_period_start: 1000, current_period_end: 2000,
        },
        previous_attributes: {},
      },
    } as any;

    await svc.handle(event);
    expect(applyPlanChange).not.toHaveBeenCalled();
  });

  // ─── Task 15: invoice.payment_failed logs to Discord ──────────────

  it('logs payment_failed event to Discord', async () => {
    const logApiError = jest.fn();
    const supabase = {
      getClient: () => ({
        from: (t: string) => {
          if (t === 'stripe_webhook_events') return { insert: async () => ({ error: null }) };
          return {};
        },
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: SupabaseService, useValue: supabase },
        { provide: SubscriptionsService, useValue: { applyPlanChange: jest.fn() } },
        { provide: DiscordLoggerService, useValue: { logApiError } },
      ],
    }).compile();

    const svc = module.get(StripeWebhookService);

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

    await svc.handle(event);

    expect(logApiError).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'stripe_payment_failed',
      error: expect.stringContaining('attempt 2'),
    }));
  });
});
