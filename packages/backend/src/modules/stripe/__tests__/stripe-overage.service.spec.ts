import { Test, TestingModule } from '@nestjs/testing';
import { StripeOverageService } from '../stripe-overage.service';
import { StripeService } from '../stripe.service';
import { SupabaseService } from '../../../shared/services/supabase.service';

describe('StripeOverageService', () => {
  let service: StripeOverageService;
  let meterCreateMock: jest.Mock;
  let supabaseUpdateMock: jest.Mock;

  function buildSupabase(overrideCtx?: any | null) {
    const ctx = overrideCtx === undefined ? {
      id: 'overage-1',
      user_id: 'user-1',
      sale_id: 'sale-1',
      price_cents: 14,
      subscription: {
        stripe_customer_id: 'cus_abc',
        plan: { stripe_meter_event_name: 'sentinela_approved_sales_pro' },
      },
    } : overrideCtx;

    return {
      getClient: () => ({
        from: (t: string) => {
          if (t === 'usage_overage') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: ctx, error: null }),
                }),
              }),
              update: supabaseUpdateMock,
            };
          }
          return {};
        },
      }),
    };
  }

  beforeEach(async () => {
    meterCreateMock = jest.fn().mockResolvedValue({ identifier: 'overage-1' });
    supabaseUpdateMock = jest.fn().mockReturnValue({
      eq: async () => ({ error: null }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeOverageService,
        {
          provide: StripeService,
          useValue: {
            getClient: () => ({
              billing: { meterEvents: { create: meterCreateMock } },
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: buildSupabase(),
        },
      ],
    }).compile();

    service = module.get(StripeOverageService);
  });

  it('sends meter event with idempotency identifier and updates reported_to_stripe_at', async () => {
    await service.sendMeterEvent({ overageId: 'overage-1' });

    expect(meterCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'sentinela_approved_sales_pro',
      identifier: 'overage-1',
      payload: expect.objectContaining({
        value: '1',
        stripe_customer_id: 'cus_abc',
      }),
    }));

    expect(supabaseUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      reported_to_stripe_at: expect.any(String),
      stripe_usage_record_id: 'overage-1',
    }));
  });

  it('throws when overage not found', async () => {
    const noCtx = await Test.createTestingModule({
      providers: [
        StripeOverageService,
        {
          provide: StripeService,
          useValue: {
            getClient: () => ({
              billing: { meterEvents: { create: meterCreateMock } },
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: buildSupabase(null),
        },
      ],
    }).compile();

    const svc = noCtx.get(StripeOverageService);
    await expect(svc.sendMeterEvent({ overageId: 'nope' }))
      .rejects.toThrow(/not found/i);
    expect(meterCreateMock).not.toHaveBeenCalled();
  });

  // Scenario 65: plan without stripe_meter_event_name — the join resolved but
  // the nested plan row has a null event name. Service must fail loud.
  it('throws when plan has no stripe_meter_event_name', async () => {
    const missingEventName = await Test.createTestingModule({
      providers: [
        StripeOverageService,
        {
          provide: StripeService,
          useValue: {
            getClient: () => ({ billing: { meterEvents: { create: meterCreateMock } } }),
          },
        },
        {
          provide: SupabaseService,
          useValue: buildSupabase({
            id: 'overage-1', user_id: 'user-1', sale_id: 'sale-1', price_cents: 14,
            subscription: {
              stripe_customer_id: 'cus_abc',
              plan: { stripe_meter_event_name: null },
            },
          }),
        },
      ],
    }).compile();

    const svc = missingEventName.get(StripeOverageService);
    await expect(svc.sendMeterEvent({ overageId: 'overage-1' }))
      .rejects.toThrow(/meter_event_name/i);
    expect(meterCreateMock).not.toHaveBeenCalled();
  });

  // Scenario 66: Stripe rejects a duplicate meter event (same identifier
  // replayed). Current service does NOT catch — it re-throws. The caller
  // (SalesService fire-and-forget OR the reconciliation cron) is responsible
  // for swallowing. Locked in as observed behavior. See docs/testing/
  // stripe-e2e-scenarios.md → Open questions.
  it('re-throws when Stripe rejects a duplicate meter event identifier', async () => {
    const dupError: any = new Error('Meter event with identifier overage-1 already exists');
    dupError.code = 'already_exists';
    dupError.statusCode = 400;
    meterCreateMock.mockRejectedValueOnce(dupError);

    await expect(service.sendMeterEvent({ overageId: 'overage-1' }))
      .rejects.toThrow(/already exists/i);
    // Crucial invariant: no UPDATE on usage_overage when the meter call fails,
    // otherwise reconciliation would never retry.
    expect(supabaseUpdateMock).not.toHaveBeenCalled();
  });

  it('throws when no stripe_customer_id', async () => {
    const missingCust = await Test.createTestingModule({
      providers: [
        StripeOverageService,
        {
          provide: StripeService,
          useValue: {
            getClient: () => ({
              billing: { meterEvents: { create: meterCreateMock } },
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: buildSupabase({
            id: 'overage-1',
            user_id: 'user-1',
            sale_id: 'sale-1',
            price_cents: 14,
            subscription: {
              stripe_customer_id: null,
              plan: { stripe_meter_event_name: 'sentinela_approved_sales_pro' },
            },
          }),
        },
      ],
    }).compile();

    const svc = missingCust.get(StripeOverageService);
    await expect(svc.sendMeterEvent({ overageId: 'overage-1' }))
      .rejects.toThrow(/stripe_customer_id/i);
  });
});
