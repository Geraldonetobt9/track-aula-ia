// packages/backend/src/modules/stripe/__tests__/stripe-checkout.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StripeCheckoutService } from '../stripe-checkout.service';
import { StripeService } from '../stripe.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { PlanLimitsService } from '../../plan-limits/plan-limits.service';

describe('StripeCheckoutService', () => {
  let service: StripeCheckoutService;
  let supabaseMock: any;
  let stripeMock: any;
  let planLimitsMock: { invalidate: jest.Mock };
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

    const supabaseClient = { from: jest.fn() };
    supabaseMock = {
      getClient: () => supabaseClient,
    };

    planLimitsMock = { invalidate: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeCheckoutService,
        { provide: StripeService, useValue: stripeMock },
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PlanLimitsService, useValue: planLimitsMock },
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
                // Formatted CPF (with dots and dash) — service normalizes it
                data: { user_id: 'user-1', email: 'u@example.com', name: 'User', cpf: '529.982.247-25', cnpj: null },
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
      tax_id_data: [{ type: 'br_cpf', value: '52998224725' }],
      metadata: { user_id: 'user-1', cpf: '52998224725', cnpj: '' },
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

  // Scenario 33: Plan has stripe_price_id_base but NULL stripe_price_id_metered.
  it('throws when plan is missing stripe_price_id_metered', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { id: 'plan-broken', plan: 'broken', stripe_price_id_base: 'price_base_x', stripe_price_id_metered: null },
            error: null,
          }) }) }),
        };
      }
      return {};
    });
    await expect(service.createCheckoutSession('user-1', 'plan-broken'))
      .rejects.toThrow(BadRequestException);
  });

  // Scenario 34: user has no subscription row yet — signup flow incomplete.
  it('throws when subscription row is missing', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { id: 'plan-pro', plan: 'pro', stripe_price_id_base: 'price_base_pro', stripe_price_id_metered: 'price_metered_pro' },
            error: null,
          }) }) }),
        };
      }
      if (table === 'subscriptions') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      return {};
    });
    await expect(service.createCheckoutSession('user-1', 'plan-pro'))
      .rejects.toThrow(/Subscription not found/i);
  });

  // Scenario 36: user has stripe_subscription_id and requests the SAME plan.
  it('throws 400 "Você já está neste plano" when target plan matches current', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { id: 'plan-pro', plan: 'pro', stripe_price_id_base: 'price_base_pro', stripe_price_id_metered: 'price_metered_pro' },
            error: null,
          }) }) }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: 'sub-1', user_id: 'user-1', plan_id: 'plan-pro',
              stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1',
            },
            error: null,
          }) }) }),
        };
      }
      return {};
    });
    await expect(service.createCheckoutSession('user-1', 'plan-pro'))
      .rejects.toThrow(/já está neste plano/i);
  });

  it('creates customer without tax_id_data when CPF is missing or malformed', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'plan-pro', plan: 'pro',
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
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                // No CPF, no CNPJ (realistic for users who didn't fill onboarding)
                data: { user_id: 'user-1', email: 'u@example.com', name: 'User', cpf: null, cnpj: null },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    customersCreate.mockResolvedValue({ id: 'cus_456' });
    sessionsCreate.mockResolvedValue({ id: 'cs_456', url: 'https://checkout.stripe.com/y' });

    await service.createCheckoutSession('user-1', 'plan-pro');

    const callArgs = customersCreate.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      email: 'u@example.com',
      name: 'User',
      metadata: { user_id: 'user-1', cpf: '', cnpj: '' },
    });
    // tax_id_data should be omitted entirely (undefined), not passed as []
    expect(callArgs.tax_id_data).toBeUndefined();
  });

  it('uses br_cnpj tax_id when profile has a valid CNPJ', async () => {
    supabaseMock.getClient().from = jest.fn((table: string) => {
      if (table === 'plan_rules') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'plan-pro', plan: 'pro',
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
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                // Business customer with CNPJ
                data: {
                  user_id: 'user-1', email: 'biz@example.com', name: 'Empresa LTDA',
                  cpf: null, cnpj: '11.222.333/0001-81',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    customersCreate.mockResolvedValue({ id: 'cus_999' });
    sessionsCreate.mockResolvedValue({ id: 'cs_999', url: 'https://checkout.stripe.com/z' });

    await service.createCheckoutSession('user-1', 'plan-pro');

    const callArgs = customersCreate.mock.calls[0][0];
    expect(callArgs.tax_id_data).toEqual([{ type: 'br_cnpj', value: '11222333000181' }]);
    expect(callArgs.metadata).toEqual({ user_id: 'user-1', cpf: '', cnpj: '11222333000181' });
  });

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

  // Scenario 42: reactivateSubscription branches.
  describe('reactivateSubscription', () => {
    let subscriptionsUpdate: jest.Mock;

    beforeEach(() => {
      subscriptionsUpdate = jest.fn().mockResolvedValue({});
      stripeMock.getClient = () => ({
        customers: { create: customersCreate },
        checkout: { sessions: { create: sessionsCreate } },
        subscriptions: { update: subscriptionsUpdate },
      });
    });

    it('throws 400 when no stripe_subscription_id', async () => {
      supabaseMock.getClient().from = (_t: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_subscription_id: null, cancel_at_period_end: true }, error: null,
        }) }) }),
      });
      await expect(service.reactivateSubscription('user-1')).rejects.toThrow(BadRequestException);
      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('throws 400 when subscription is already active (cancel_at_period_end=false)', async () => {
      supabaseMock.getClient().from = (_t: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_subscription_id: 'sub_1', cancel_at_period_end: false }, error: null,
        }) }) }),
      });
      await expect(service.reactivateSubscription('user-1')).rejects.toThrow(/já está ativa/i);
      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('flips cancel_at_period_end=false on Stripe when scheduled to cancel', async () => {
      const supabaseEq = jest.fn().mockResolvedValue({ error: null });
      const supabaseUpdate = jest.fn().mockReturnValue({ eq: supabaseEq });
      supabaseMock.getClient().from = (_t: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_subscription_id: 'sub_1', cancel_at_period_end: true }, error: null,
        }) }) }),
        update: supabaseUpdate,
      });
      const result = await service.reactivateSubscription('user-1');
      expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: false });
      // Write-through: local DB updated immediately after the Stripe call
      expect(supabaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ cancel_at_period_end: false, updated_at: expect.any(String) }),
      );
      expect(supabaseEq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('cancelSubscription', () => {
    let subscriptionsUpdate: jest.Mock;
    let subscriptionsRetrieve: jest.Mock;

    beforeEach(() => {
      subscriptionsUpdate = jest.fn().mockResolvedValue({});
      subscriptionsRetrieve = jest.fn().mockResolvedValue({ cancel_at_period_end: false, current_period_end: 0 });
      stripeMock.getClient = () => ({
        customers: { create: customersCreate },
        checkout: { sessions: { create: sessionsCreate } },
        subscriptions: { update: subscriptionsUpdate, retrieve: subscriptionsRetrieve },
      });
    });

    it('marks cancel_at_period_end=true and returns ends_at', async () => {
      const supabaseEq = jest.fn().mockResolvedValue({ error: null });
      const supabaseUpdate = jest.fn().mockReturnValue({ eq: supabaseEq });
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: {
            stripe_subscription_id: 'sub_123',
            cancel_at_period_end: false,
            plan_rules: { plan: 'pro' },
          },
          error: null,
        })})}),
        update: supabaseUpdate,
      }));
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_123',
        cancel_at_period_end: false,
        current_period_end: 1714300000,
      });
      subscriptionsUpdate.mockResolvedValue({
        id: 'sub_123',
        cancel_at_period_end: true,
        current_period_end: 1714300000,
      });

      const result = await service.cancelSubscription('user-1');

      expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_123', { cancel_at_period_end: true });
      // Write-through: local DB updated immediately after the Stripe call
      expect(supabaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ cancel_at_period_end: true, updated_at: expect.any(String) }),
      );
      expect(supabaseEq).toHaveBeenCalledWith('user_id', 'user-1');
      // Plan-limits cache invalidated so the next /usage refetch sees fresh state
      expect(planLimitsMock.invalidate).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({
        canceled_at: expect.any(String),
        ends_at: new Date(1714300000 * 1000).toISOString(),
        already_scheduled: false,
      });
    });

    it('is idempotent when already scheduled', async () => {
      const supabaseUpdate = jest.fn();
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: {
            stripe_subscription_id: 'sub_123',
            cancel_at_period_end: true,
            plan_rules: { plan: 'pro' },
          },
          error: null,
        })})}),
        update: supabaseUpdate,
      }));
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_123',
        cancel_at_period_end: true,
        current_period_end: 1714300000,
      });

      const result = await service.cancelSubscription('user-1');

      expect(subscriptionsUpdate).not.toHaveBeenCalled();
      // Idempotent path returns early — no write-through needed
      expect(supabaseUpdate).not.toHaveBeenCalled();
      expect(result.already_scheduled).toBe(true);
    });

    it('rejects user without subscription', async () => {
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_subscription_id: null, cancel_at_period_end: false, plan_rules: { plan: 'free' } },
          error: null,
        })})}),
      }));

      await expect(service.cancelSubscription('user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects unlimited plan', async () => {
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: {
            stripe_subscription_id: 'sub_123',
            cancel_at_period_end: false,
            plan_rules: { plan: 'unlimited' },
          },
          error: null,
        })})}),
      }));

      await expect(service.cancelSubscription('user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('previewPlanChange (new DTO)', () => {
    let pricesRetrieve: jest.Mock;
    let subscriptionsRetrieve: jest.Mock;

    beforeEach(() => {
      pricesRetrieve = jest.fn();
      subscriptionsRetrieve = jest.fn();
      stripeMock.getClient = () => ({
        prices: { retrieve: pricesRetrieve },
        subscriptions: { retrieve: subscriptionsRetrieve },
      });
    });

    function mockSubscriptionAndPlanLookups(opts: {
      targetSlug: string;
      targetPriceBase: string;
      currentPriceBase: string;
      currentSlug: string;
      currentPeriodEnd: number;
      totalSales?: number;
      targetMaxSales?: number;
      targetOverageCents?: number;
    }) {
      const totalSales = opts.totalSales ?? 0;
      supabaseMock.getClient().from = jest.fn((table: string) => {
        if (table === 'plan_rules') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: 'plan-target',
              plan: opts.targetSlug,
              stripe_price_id_base: opts.targetPriceBase,
              stripe_price_id_metered: 'price_metered_target',
              max_sales_monthly: opts.targetMaxSales ?? 2500,
              overage_price_cents: opts.targetOverageCents ?? 12,
            },
            error: null,
          })})})};
        }
        if (table === 'subscriptions') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              plan_id: 'plan-current',
              stripe_customer_id: 'cus_1',
              stripe_subscription_id: 'sub_1',
              plan_rules: { plan: opts.currentSlug, stripe_price_id_base: opts.currentPriceBase },
            },
            error: null,
          })})})};
        }
        if (table === 'sales') {
          const tail: any = { count: totalSales, error: null };
          const make: any = () => ({ eq: jest.fn(make), gte: jest.fn(make), lt: jest.fn(() => Promise.resolve(tail)) });
          return { select: () => make() };
        }
        return {};
      });
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        current_period_start: opts.currentPeriodEnd - 30 * 24 * 60 * 60,
        current_period_end: opts.currentPeriodEnd,
        currency: 'brl',
      });
    }

    it('classifies upgrade and computes diff cheio', async () => {
      mockSubscriptionAndPlanLookups({
        targetSlug: 'starter',
        targetPriceBase: 'price_starter',
        currentSlug: 'pro',
        currentPriceBase: 'price_pro',
        currentPeriodEnd: 1714300000,
      });
      pricesRetrieve.mockImplementation(async (id: string) => {
        if (id === 'price_starter') return { id, unit_amount: 11990, currency: 'brl' };
        if (id === 'price_pro')     return { id, unit_amount: 5990,  currency: 'brl' };
        throw new Error(`unexpected price ${id}`);
      });

      const result = await service.previewPlanChange('user-1', 'plan-target');

      expect(result).toEqual({
        kind: 'upgrade',
        currentPlan: 'pro',
        targetPlan: 'starter',
        chargeNowCents: 6000,
        nextChargeCents: 11990,
        effectiveDate: new Date(1714300000 * 1000).toISOString(),
        currency: 'brl',
      });
    });

    it('classifies downgrade with chargeNowCents=0', async () => {
      mockSubscriptionAndPlanLookups({
        targetSlug: 'pro',
        targetPriceBase: 'price_pro',
        currentSlug: 'starter',
        currentPriceBase: 'price_starter',
        currentPeriodEnd: 1714300000,
      });
      pricesRetrieve.mockImplementation(async (id: string) => {
        if (id === 'price_starter') return { id, unit_amount: 11990, currency: 'brl' };
        if (id === 'price_pro')     return { id, unit_amount: 5990,  currency: 'brl' };
        throw new Error(`unexpected price ${id}`);
      });

      const result = await service.previewPlanChange('user-1', 'plan-target');

      expect(result.kind).toBe('downgrade');
      expect(result.chargeNowCents).toBe(0);
      expect(result.nextChargeCents).toBe(5990);
    });

    it('inclui overage do ciclo em chargeNowCents quando vendas excedem novo limite', async () => {
      mockSubscriptionAndPlanLookups({
        targetSlug: 'starter',
        targetPriceBase: 'price_starter',
        currentSlug: 'pro',
        currentPriceBase: 'price_pro',
        currentPeriodEnd: 1714300000,
        totalSales: 2700,        // 200 acima do limite Starter (2500)
        targetMaxSales: 2500,
        targetOverageCents: 12,  // R$ 0,12
      });
      pricesRetrieve.mockImplementation(async (id: string) => {
        if (id === 'price_starter') return { id, unit_amount: 11990, currency: 'brl' };
        if (id === 'price_pro')     return { id, unit_amount: 5990,  currency: 'brl' };
        throw new Error(`unexpected price ${id}`);
      });

      const result = await service.previewPlanChange('user-1', 'plan-target');

      // diff = 11990 − 5990 = 6000; overage = 200 × 12 = 2400; total = 8400
      expect(result.kind).toBe('upgrade');
      expect(result.chargeNowCents).toBe(8400);
      expect(result.nextChargeCents).toBe(11990);
    });

    it('rejects same plan', async () => {
      supabaseMock.getClient().from = jest.fn((table: string) => {
        if (table === 'plan_rules') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { id: 'plan-same', plan: 'pro', stripe_price_id_base: 'price_pro', stripe_price_id_metered: 'pm' },
            error: null,
          })})})};
        }
        if (table === 'subscriptions') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { plan_id: 'plan-same', stripe_customer_id: 'cus', stripe_subscription_id: 'sub',
                    plan_rules: { plan: 'pro', stripe_price_id_base: 'price_pro' } },
            error: null,
          })})})};
        }
        return {};
      });

      await expect(service.previewPlanChange('user-1', 'plan-same'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects user without active Stripe subscription', async () => {
      supabaseMock.getClient().from = jest.fn((table: string) => {
        if (table === 'plan_rules') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: 'plan-target',
              plan: 'pro',
              stripe_price_id_base: 'price_pro_base',
              stripe_price_id_metered: 'price_pro_metered',
            },
            error: null,
          })})})};
        }
        if (table === 'subscriptions') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              plan_id: 'plan-free',
              stripe_customer_id: null,
              stripe_subscription_id: null,
              plan_rules: { plan: 'free', stripe_price_id_base: null },
            },
            error: null,
          })})})};
        }
        return {};
      });

      await expect(service.previewPlanChange('user-1', 'plan-target'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('changeExistingPlan (upgrade)', () => {
    let invoiceItemsCreate: jest.Mock;
    let invoiceItemsDelete: jest.Mock;
    let invoicesCreate: jest.Mock;
    let invoicesFinalize: jest.Mock;
    let invoicesPay: jest.Mock;
    let subscriptionsRetrieve: jest.Mock;
    let subscriptionsUpdate: jest.Mock;
    let pricesRetrieve: jest.Mock;
    let customersRetrieve: jest.Mock;

    beforeEach(() => {
      invoiceItemsCreate = jest.fn();
      invoiceItemsDelete = jest.fn();
      invoicesCreate = jest.fn();
      invoicesFinalize = jest.fn();
      invoicesPay = jest.fn();
      subscriptionsRetrieve = jest.fn();
      subscriptionsUpdate = jest.fn();
      pricesRetrieve = jest.fn();
      customersRetrieve = jest.fn();
      stripeMock.getClient = () => ({
        customers: { create: customersCreate, retrieve: customersRetrieve },
        checkout: { sessions: { create: sessionsCreate } },
        invoiceItems: { create: invoiceItemsCreate, del: invoiceItemsDelete },
        invoices: {
          create: invoicesCreate,
          finalizeInvoice: invoicesFinalize,
          pay: invoicesPay,
        },
        subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
        prices: { retrieve: pricesRetrieve },
      });
    });

    function mockUpgradeContext(opts: { totalSales?: number } = {}) {
      const totalSales = opts.totalSales ?? 0;
      supabaseMock.getClient().from = jest.fn((table: string) => {
        if (table === 'plan_rules') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: 'plan-starter',
              plan: 'starter',
              stripe_price_id_base: 'price_starter_base',
              stripe_price_id_metered: 'price_starter_metered',
              max_sales_monthly: 2500,
              overage_price_cents: 12,
            },
            error: null,
          })})})};
        }
        if (table === 'subscriptions') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: {
                id: 'sub-row',
                plan_id: 'plan-pro',
                stripe_customer_id: 'cus_1',
                stripe_subscription_id: 'sub_1',
                plan_rules: { plan: 'pro', stripe_price_id_base: 'price_pro_base' },
              },
              error: null,
            })})}),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'sales') {
          // Chain: .select('*', { count, head }).eq().eq().eq().eq().gte().lt() → { count, error }
          const tail: any = { count: totalSales, error: null };
          const make: any = () => ({ eq: jest.fn(make), gte: jest.fn(make), lt: jest.fn(() => Promise.resolve(tail)) });
          return { select: () => make() };
        }
        if (table === 'usage_overage') {
          // Chain: .update(...).eq().gte().lt().is() → { error: null }
          const tail = { error: null };
          const make = (): any => ({ eq: jest.fn(make), gte: jest.fn(make), lt: jest.fn(make), is: jest.fn(() => Promise.resolve(tail)) });
          return { update: jest.fn(() => make()) };
        }
        return {};
      });
      customersRetrieve.mockResolvedValue({
        id: 'cus_1',
        invoice_settings: { default_payment_method: 'pm_default' },
      });
      pricesRetrieve.mockImplementation(async (id: string) => {
        if (id === 'price_starter_base') return { id, unit_amount: 11990, currency: 'brl' };
        if (id === 'price_pro_base')     return { id, unit_amount: 5990,  currency: 'brl' };
        throw new Error(`unexpected price ${id}`);
      });
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        cancel_at_period_end: false,
        status: 'active',
        current_period_start: 1711700000,
        current_period_end: 1714300000,
        items: { data: [
          { id: 'si_base',    price: { id: 'price_pro_base',    recurring: { usage_type: 'licensed' } } },
          { id: 'si_metered', price: { id: 'price_pro_metered', recurring: { usage_type: 'metered'  } } },
        ]},
      });
    }

    it('cobra antes de trocar e preserva billing cycle', async () => {
      mockUpgradeContext();
      invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
      invoicesCreate.mockResolvedValue({ id: 'in_1' });
      invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
      invoicesPay.mockResolvedValue({ id: 'in_1', status: 'paid' });
      subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' });

      const result = await service.createCheckoutSession('user-1', 'plan-starter');

      expect(invoiceItemsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_1',
          amount: 6000,
          currency: 'brl',
          description: expect.stringContaining('starter'),
        }),
        expect.objectContaining({ idempotencyKey: expect.stringContaining('invoiceItem:user-1:plan-starter:') }),
      );
      expect(invoicesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_1',
          auto_advance: false,
          collection_method: 'charge_automatically',
          pending_invoice_items_behavior: 'include',
        }),
        expect.objectContaining({ idempotencyKey: expect.stringContaining('upgrade:user-1:plan-starter') }),
      );
      expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_1', expect.objectContaining({
        proration_behavior: 'none',
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'si_base',    price: 'price_starter_base' }),
          expect.objectContaining({ id: 'si_metered', price: 'price_starter_metered' }),
        ]),
      }));
      // Não passa billing_cycle_anchor (preserva)
      expect(subscriptionsUpdate.mock.calls[0][1]).not.toHaveProperty('billing_cycle_anchor');
      expect(result).toEqual({ changed: true, plan: 'starter' });
    });

    it('rolls back invoice item se invoices.pay falha — sub não muda', async () => {
      mockUpgradeContext();
      invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
      invoicesCreate.mockResolvedValue({ id: 'in_1' });
      invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
      invoicesPay.mockRejectedValue(Object.assign(new Error('Card declined'), { code: 'card_declined' }));

      await expect(service.createCheckoutSession('user-1', 'plan-starter'))
        .rejects.toMatchObject({ status: 402 });

      expect(invoiceItemsDelete).toHaveBeenCalledWith('ii_1');
      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('bloqueia upgrade sem default payment method', async () => {
      mockUpgradeContext();
      customersRetrieve.mockResolvedValue({
        id: 'cus_1',
        invoice_settings: { default_payment_method: null },
      });

      await expect(service.createCheckoutSession('user-1', 'plan-starter'))
        .rejects.toThrow(/cartão/i);
      expect(invoiceItemsCreate).not.toHaveBeenCalled();
    });

    it('bloqueia upgrade quando sub está past_due', async () => {
      mockUpgradeContext();
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        cancel_at_period_end: false,
        status: 'past_due',
        current_period_end: 1714300000,
        items: { data: [] },
      });

      await expect(service.createCheckoutSession('user-1', 'plan-starter'))
        .rejects.toThrow(/pendente|past[_ ]due/i);
    });

    it('reativa cancel_at_period_end antes de cobrar', async () => {
      mockUpgradeContext();
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        cancel_at_period_end: true,
        status: 'active',
        current_period_start: 1711700000,
        current_period_end: 1714300000,
        items: { data: [
          { id: 'si_base',    price: { id: 'price_pro_base',    recurring: { usage_type: 'licensed' } } },
          { id: 'si_metered', price: { id: 'price_pro_metered', recurring: { usage_type: 'metered'  } } },
        ]},
      });
      invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
      invoicesCreate.mockResolvedValue({ id: 'in_1' });
      invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
      invoicesPay.mockResolvedValue({ id: 'in_1', status: 'paid' });
      subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' });

      await service.createCheckoutSession('user-1', 'plan-starter');

      // Reativação acontece antes da invoice
      const reactivateCall = subscriptionsUpdate.mock.calls.find(
        ([, body]) => body.cancel_at_period_end === false,
      );
      expect(reactivateCall).toBeTruthy();
    });

    it('restaura cancel_at_period_end se cobrança falha após reativação', async () => {
      mockUpgradeContext();
      // Sub começa com cancel_at_period_end=true (agendado pra cancelar)
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        cancel_at_period_end: true,
        status: 'active',
        current_period_start: 1711700000,
        current_period_end: 1714300000,
        items: { data: [
          { id: 'si_base',    price: { id: 'price_pro_base',    recurring: { usage_type: 'licensed' } } },
          { id: 'si_metered', price: { id: 'price_pro_metered', recurring: { usage_type: 'metered'  } } },
        ]},
      });
      invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
      invoicesCreate.mockResolvedValue({ id: 'in_1' });
      invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
      invoicesPay.mockRejectedValue(Object.assign(new Error('Card declined'), { code: 'card_declined' }));
      subscriptionsUpdate.mockResolvedValue({});

      await expect(service.createCheckoutSession('user-1', 'plan-starter'))
        .rejects.toMatchObject({ status: 402 });

      // Verifica que houve update pra reativar (false) E depois pra restaurar (true).
      const reactivateCall = subscriptionsUpdate.mock.calls.find(
        ([, body]) => body.cancel_at_period_end === false,
      );
      const restoreCall = subscriptionsUpdate.mock.calls.find(
        ([, body]) => body.cancel_at_period_end === true,
      );
      expect(reactivateCall).toBeTruthy();
      expect(restoreCall).toBeTruthy();
      // E que a sub não foi trocada de plano
      const itemSwap = subscriptionsUpdate.mock.calls.find(
        ([, body]) => Array.isArray(body.items),
      );
      expect(itemSwap).toBeFalsy();
      // Invoice item rolled back
      expect(invoiceItemsDelete).toHaveBeenCalledWith('ii_1');
    });
  });

  describe('changeExistingPlan (upgrade overage settle)', () => {
    let invoiceItemsCreate: jest.Mock;
    let invoiceItemsDelete: jest.Mock;
    let invoicesCreate: jest.Mock;
    let invoicesFinalize: jest.Mock;
    let invoicesPay: jest.Mock;
    let subscriptionsRetrieve: jest.Mock;
    let subscriptionsUpdate: jest.Mock;
    let pricesRetrieve: jest.Mock;
    let customersRetrieve: jest.Mock;
    let overageUpdate: jest.Mock;
    let overageUpdateIs: jest.Mock;

    beforeEach(() => {
      invoiceItemsCreate = jest.fn();
      invoiceItemsDelete = jest.fn();
      invoicesCreate = jest.fn();
      invoicesFinalize = jest.fn();
      invoicesPay = jest.fn();
      subscriptionsRetrieve = jest.fn();
      subscriptionsUpdate = jest.fn();
      pricesRetrieve = jest.fn();
      customersRetrieve = jest.fn();
      overageUpdate = jest.fn();
      overageUpdateIs = jest.fn(() => Promise.resolve({ error: null }));
      stripeMock.getClient = () => ({
        customers: { create: customersCreate, retrieve: customersRetrieve },
        checkout: { sessions: { create: sessionsCreate } },
        invoiceItems: { create: invoiceItemsCreate, del: invoiceItemsDelete },
        invoices: {
          create: invoicesCreate,
          finalizeInvoice: invoicesFinalize,
          pay: invoicesPay,
        },
        subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
        prices: { retrieve: pricesRetrieve },
      });
    });

    function setupMocks(totalSales: number) {
      supabaseMock.getClient().from = jest.fn((table: string) => {
        if (table === 'plan_rules') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: 'plan-starter',
              plan: 'starter',
              stripe_price_id_base: 'price_starter_base',
              stripe_price_id_metered: 'price_starter_metered',
              max_sales_monthly: 2500,
              overage_price_cents: 12,
            },
            error: null,
          })})})};
        }
        if (table === 'subscriptions') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: {
                id: 'sub-row', plan_id: 'plan-pro', stripe_customer_id: 'cus_1',
                stripe_subscription_id: 'sub_1',
                plan_rules: { plan: 'pro', stripe_price_id_base: 'price_pro_base' },
              },
              error: null,
            })})}),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'sales') {
          const tail: any = { count: totalSales, error: null };
          const make: any = () => ({ eq: jest.fn(make), gte: jest.fn(make), lt: jest.fn(() => Promise.resolve(tail)) });
          return { select: () => make() };
        }
        if (table === 'usage_overage') {
          const make: any = () => ({ eq: jest.fn(make), gte: jest.fn(make), lt: jest.fn(make), is: overageUpdateIs });
          overageUpdate.mockImplementation(() => make());
          return { update: overageUpdate };
        }
        return {};
      });
      customersRetrieve.mockResolvedValue({ id: 'cus_1', invoice_settings: { default_payment_method: 'pm_default' } });
      pricesRetrieve.mockImplementation(async (id: string) => {
        if (id === 'price_starter_base') return { id, unit_amount: 11990, currency: 'brl' };
        if (id === 'price_pro_base')     return { id, unit_amount: 5990,  currency: 'brl' };
        throw new Error(`unexpected price ${id}`);
      });
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1', cancel_at_period_end: false, status: 'active',
        current_period_start: 1711700000, current_period_end: 1714300000,
        items: { data: [
          { id: 'si_base',    price: { id: 'price_pro_base',    recurring: { usage_type: 'licensed' } } },
          { id: 'si_metered', price: { id: 'price_pro_metered', recurring: { usage_type: 'metered'  } } },
        ]},
      });
      invoiceItemsCreate.mockResolvedValue({ id: 'ii_1' });
      invoicesCreate.mockResolvedValue({ id: 'in_1' });
      invoicesFinalize.mockResolvedValue({ id: 'in_1', status: 'open' });
      invoicesPay.mockResolvedValue({ id: 'in_1', status: 'paid' });
      subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' });
    }

    it('cria invoice item de overage quando vendas excedem limite do novo plano', async () => {
      // 2600 vendas, Starter limita em 2500 → 100 overage × R$ 0,12 = R$ 12,00 = 1200 cents
      setupMocks(2600);

      await service.createCheckoutSession('user-1', 'plan-starter');

      // Dois invoice items: diff (6000) + overage settle (1200)
      const items = invoiceItemsCreate.mock.calls.map((c) => c[0]);
      const diffItem = items.find((i) => i.metadata.kind === 'plan_upgrade_diff');
      const overageItem = items.find((i) => i.metadata.kind === 'plan_upgrade_overage_settle');
      expect(diffItem).toMatchObject({ amount: 6000 });
      expect(overageItem).toMatchObject({
        amount: 1200,
        currency: 'brl',
        description: expect.stringMatching(/100 vendas.*R\$ 0,12/),
        metadata: expect.objectContaining({
          overage_units: '100',
          target_plan_id: 'plan-starter',
        }),
      });
    });

    it('NÃO cria invoice item de overage quando vendas estão dentro do limite do novo plano', async () => {
      // 2000 vendas, Starter limita em 2500 → 0 overage
      setupMocks(2000);

      await service.createCheckoutSession('user-1', 'plan-starter');

      const items = invoiceItemsCreate.mock.calls.map((c) => c[0]);
      const overageItem = items.find((i) => i.metadata.kind === 'plan_upgrade_overage_settle');
      expect(overageItem).toBeUndefined();
      // Só o diff
      const diffItem = items.find((i) => i.metadata.kind === 'plan_upgrade_diff');
      expect(diffItem).toMatchObject({ amount: 6000 });
    });

    it('marca usage_overage rows do ciclo como settled após pagamento', async () => {
      setupMocks(2600);

      await service.createCheckoutSession('user-1', 'plan-starter');

      // Verifica que houve update na tabela usage_overage com settled_at + settled_by_invoice_id
      expect(overageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        settled_at: expect.any(String),
        settled_by_invoice_id: 'in_1',
      }));
    });

    it('rollback deleta AMBOS invoice items (diff + overage) se pay falha', async () => {
      setupMocks(2600);
      invoiceItemsCreate
        .mockResolvedValueOnce({ id: 'ii_diff' })       // diff item
        .mockResolvedValueOnce({ id: 'ii_overage' });   // overage item
      invoicesPay.mockRejectedValue(Object.assign(new Error('Card declined'), { code: 'card_declined' }));

      await expect(service.createCheckoutSession('user-1', 'plan-starter'))
        .rejects.toMatchObject({ status: 402 });

      expect(invoiceItemsDelete).toHaveBeenCalledWith('ii_diff');
      expect(invoiceItemsDelete).toHaveBeenCalledWith('ii_overage');
      // Sub não foi trocada
      const itemSwap = subscriptionsUpdate.mock.calls.find(
        ([, body]: any) => Array.isArray(body.items),
      );
      expect(itemSwap).toBeFalsy();
    });
  });

  describe('changeExistingPlan (downgrade)', () => {
    let subscriptionsRetrieve: jest.Mock;
    let subscriptionsUpdate: jest.Mock;
    let pricesRetrieve: jest.Mock;
    let customersRetrieve: jest.Mock;
    let scheduleCreate: jest.Mock;
    let scheduleUpdate: jest.Mock;
    let supabaseUpdateChain: { update: jest.Mock; eq: jest.Mock };

    beforeEach(() => {
      subscriptionsRetrieve = jest.fn();
      subscriptionsUpdate = jest.fn();
      pricesRetrieve = jest.fn();
      customersRetrieve = jest.fn();
      scheduleCreate = jest.fn();
      scheduleUpdate = jest.fn();

      stripeMock.getClient = () => ({
        customers: { create: customersCreate, retrieve: customersRetrieve },
        checkout: { sessions: { create: sessionsCreate } },
        subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
        prices: { retrieve: pricesRetrieve },
        subscriptionSchedules: { create: scheduleCreate, update: scheduleUpdate },
      });

      // Track the Supabase update chain so we can assert it
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      supabaseUpdateChain = { update, eq };
    });

    function mockDowngradeContext() {
      supabaseMock.getClient().from = jest.fn((table: string) => {
        if (table === 'plan_rules') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: {
              id: 'plan-pro',
              plan: 'pro',
              stripe_price_id_base: 'price_pro_base',
              stripe_price_id_metered: 'price_pro_metered',
            },
            error: null,
          })})})};
        }
        if (table === 'subscriptions') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: {
                id: 'sub-row',
                plan_id: 'plan-starter',
                stripe_customer_id: 'cus_1',
                stripe_subscription_id: 'sub_1',
                plan_rules: { plan: 'starter', stripe_price_id_base: 'price_starter_base' },
              },
              error: null,
            })})}),
            update: supabaseUpdateChain.update,
          };
        }
        return {};
      });
      customersRetrieve.mockResolvedValue({
        id: 'cus_1',
        invoice_settings: { default_payment_method: 'pm_default' },
      });
      pricesRetrieve.mockImplementation(async (id: string) => {
        if (id === 'price_pro_base')     return { id, unit_amount: 5990,  currency: 'brl' };
        if (id === 'price_starter_base') return { id, unit_amount: 11990, currency: 'brl' };
        throw new Error(`unexpected price ${id}`);
      });
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        cancel_at_period_end: false,
        status: 'active',
        current_period_end: 1714300000,
        items: { data: [
          { id: 'si_base',    price: { id: 'price_starter_base',    recurring: { usage_type: 'licensed' } } },
          { id: 'si_metered', price: { id: 'price_starter_metered', recurring: { usage_type: 'metered'  } } },
        ]},
      });
    }

    it('cria subscription schedule com fase atual + fase do plano alvo', async () => {
      mockDowngradeContext();
      scheduleCreate.mockResolvedValue({
        id: 'sub_sched_1',
        phases: [{
          items: [
            { price: 'price_starter_base', quantity: 1 },
            { price: 'price_starter_metered', quantity: undefined },
          ],
          start_date: 1711700000,
          end_date: 1714300000,
        }],
      });
      scheduleUpdate.mockResolvedValue({ id: 'sub_sched_1' });

      await service.createCheckoutSession('user-1', 'plan-pro');

      expect(scheduleCreate).toHaveBeenCalledWith({ from_subscription: 'sub_1' });
      expect(scheduleUpdate).toHaveBeenCalledWith('sub_sched_1', expect.objectContaining({
        end_behavior: 'release',
        phases: expect.arrayContaining([
          expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({ price: 'price_starter_base' }),
              expect.objectContaining({ price: 'price_starter_metered' }),
            ]),
            end_date: 1714300000,
          }),
          expect.objectContaining({
            items: expect.arrayContaining([
              { price: 'price_pro_base' },
              { price: 'price_pro_metered' },
            ]),
            iterations: 1,
          }),
        ]),
      }));
    });

    it('persiste scheduled_plan_id e scheduled_changes_at na linha de subscriptions', async () => {
      mockDowngradeContext();
      scheduleCreate.mockResolvedValue({
        id: 'sub_sched_1',
        phases: [{
          items: [{ price: 'price_starter_base' }, { price: 'price_starter_metered' }],
          start_date: 1711700000,
          end_date: 1714300000,
        }],
      });
      scheduleUpdate.mockResolvedValue({ id: 'sub_sched_1' });

      await service.createCheckoutSession('user-1', 'plan-pro');

      expect(supabaseUpdateChain.update).toHaveBeenCalledWith(expect.objectContaining({
        scheduled_plan_id: 'plan-pro',
        scheduled_changes_at: new Date(1714300000 * 1000).toISOString(),
      }));
    });

    it('NÃO chama subscriptions.update do Stripe', async () => {
      mockDowngradeContext();
      scheduleCreate.mockResolvedValue({
        id: 'sub_sched_1',
        phases: [{
          items: [{ price: 'price_starter_base' }, { price: 'price_starter_metered' }],
          start_date: 1711700000,
          end_date: 1714300000,
        }],
      });
      scheduleUpdate.mockResolvedValue({ id: 'sub_sched_1' });

      await service.createCheckoutSession('user-1', 'plan-pro');

      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });
  });
});
