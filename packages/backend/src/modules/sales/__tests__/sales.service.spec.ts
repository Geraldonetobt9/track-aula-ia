import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from '../sales.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { PlanLimitsService } from '../../plan-limits/plan-limits.service';
import { StripeOverageService } from '../../stripe/stripe-overage.service';
import { VisitorMatchingService } from '../../tracking/visitor-matching.service';

const mockSupabase = {
  getClient: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ data: [{ id: 'sale-default' }], error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  }),
};

const mockPlanLimits = {
  checkSaleAcceptance: jest.fn(),
  invalidate: jest.fn().mockResolvedValue(undefined),
};

const mockStripeOverage = {
  sendMeterEvent: jest.fn().mockResolvedValue(undefined),
};

const mockVisitorMatching = {
  matchSale: jest.fn().mockResolvedValue(undefined),
};

describe('SalesService', () => {
  let service: SalesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: PlanLimitsService, useValue: mockPlanLimits },
        { provide: StripeOverageService, useValue: mockStripeOverage },
        { provide: VisitorMatchingService, useValue: mockVisitorMatching },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
  });

  describe('upsertFromWebhook (plan limit)', () => {
    it('persists with blocked_by_limit=true when Free exceeds', async () => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: true, overage: false,
          subscriptionId: 'sub-1', periodStart: 'x', periodEnd: 'y',
        }),
        invalidate: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      const persistSpy = jest.spyOn(service as any, 'persist')
        .mockResolvedValue({ id: 'sale-1' });

      const sale = {
        user_id: 'user-1', status: 'approved',
        external_id: 'ext-1', platform: 'kiwify',
      } as any;
      await service.upsertFromWebhook(sale);

      expect(persistSpy).toHaveBeenCalledWith(
        expect.objectContaining({ blocked_by_limit: true })
      );
    });

    it('persists + inserts overage when paid plan exceeds', async () => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: false, overage: true,
          pricePerSaleCents: 14,
          subscriptionId: 'sub-1', periodStart: '2026-04-01', periodEnd: '2026-05-01',
        }),
        invalidate: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      const persistSpy = jest.spyOn(service as any, 'persist')
        .mockResolvedValue({ id: 'sale-1' });
      const insertOverageSpy = jest.spyOn(service as any, 'insertOverage')
        .mockResolvedValue(undefined);

      const sale = {
        user_id: 'user-1', status: 'approved',
        external_id: 'ext-1', platform: 'kiwify',
      } as any;
      await service.upsertFromWebhook(sale);

      expect(persistSpy).toHaveBeenCalled();
      expect(insertOverageSpy).toHaveBeenCalledWith('sale-1', 'user-1', expect.objectContaining({
        pricePerSaleCents: 14,
      }));
    });

    it('skips limit check when status != approved', async () => {
      const checkMock = jest.fn();
      (service as any).planLimits = { checkSaleAcceptance: checkMock, invalidate: jest.fn() };
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-2' });

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'pending',
        external_id: 'ext-1', platform: 'kiwify',
      } as any);

      expect(checkMock).not.toHaveBeenCalled();
    });

    it('skips decision if external_id already exists (idempotent)', async () => {
      const checkMock = jest.fn();
      (service as any).planLimits = { checkSaleAcceptance: checkMock, invalidate: jest.fn() };
      jest.spyOn(service as any, 'findByExternalId')
        .mockResolvedValue({ id: 'existing' });

      const result = await service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved',
        external_id: 'ext-1', platform: 'kiwify',
      } as any);

      expect(result).toEqual({ id: 'existing' });
      expect(checkMock).not.toHaveBeenCalled();
    });

    // Scenario 6: Pro 1000th sale (at-but-not-over) persists normally with no
    // overage insert and no meter event.
    it('at-limit sale on Pro persists normally without overage or meter event', async () => {
      const insertOverageSpy = jest.spyOn(service as any, 'insertOverage');
      const sendMeterSpy = jest.fn();
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: false, overage: false,
          subscriptionId: 'sub-1', periodStart: 'x', periodEnd: 'y',
        }),
        invalidate: jest.fn(),
      };
      (service as any).stripeOverage = { sendMeterEvent: sendMeterSpy };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-1000' });

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved', external_id: 'ext-pro-1000', platform: 'kiwify',
      } as any);

      expect(insertOverageSpy).not.toHaveBeenCalled();
      expect(sendMeterSpy).not.toHaveBeenCalled();
    });

    // Scenarios 8 + 9: Starter 12¢ and Enterprise 7¢ overage prices come from
    // plan_rules.overage_price_cents (via decision.pricePerSaleCents).
    it.each([
      { plan: 'starter',    pricePerSaleCents: 12 },
      { plan: 'enterprise', pricePerSaleCents: 7  },
    ])('overage insert carries pricePerSaleCents for $plan', async ({ pricePerSaleCents }) => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: false, overage: true,
          pricePerSaleCents,
          subscriptionId: 'sub-1', periodStart: '2026-04-01', periodEnd: '2026-05-01',
        }),
        invalidate: jest.fn(),
      };
      (service as any).stripeOverage = { sendMeterEvent: jest.fn().mockResolvedValue(undefined) };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-x' });
      const insertOverageSpy = jest.spyOn(service as any, 'insertOverage')
        .mockResolvedValue('overage-x');

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved', external_id: 'ext-x', platform: 'hotmart',
      } as any);

      expect(insertOverageSpy).toHaveBeenCalledWith('sale-x', 'user-1', expect.objectContaining({
        pricePerSaleCents,
      }));
    });

    // Scenario 10: Unlimited plan — decision says no overage, no block.
    it('Unlimited plan never inserts overage and never blocks', async () => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: false, overage: false,
          subscriptionId: 'sub-1', periodStart: 'x', periodEnd: 'y',
        }),
        invalidate: jest.fn(),
      };
      const sendMeterSpy = jest.fn();
      (service as any).stripeOverage = { sendMeterEvent: sendMeterSpy };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      const persistSpy = jest.spyOn(service as any, 'persist')
        .mockResolvedValue({ id: 'sale-unlimited-10k' });
      const insertOverageSpy = jest.spyOn(service as any, 'insertOverage');

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved', external_id: 'ext-unl-10k', platform: 'guru',
      } as any);

      expect(persistSpy).toHaveBeenCalledWith(expect.not.objectContaining({ blocked_by_limit: true }));
      expect(insertOverageSpy).not.toHaveBeenCalled();
      expect(sendMeterSpy).not.toHaveBeenCalled();
    });

    // Scenario 72: UNIQUE(sale_id) violation on usage_overage insert is
    // silently swallowed — webhook retry must not fail.
    it('swallows duplicate usage_overage insert error', async () => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: false, overage: true,
          pricePerSaleCents: 14,
          subscriptionId: 'sub-1', periodStart: 'x', periodEnd: 'y',
        }),
        invalidate: jest.fn(),
      };
      (service as any).stripeOverage = { sendMeterEvent: jest.fn() };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-dup' });
      jest.spyOn(service as any, 'insertOverage')
        .mockRejectedValue(new Error('duplicate key value violates unique constraint'));

      await expect(service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved', external_id: 'ext-dup', platform: 'kiwify',
      } as any)).resolves.toEqual({ id: 'sale-dup' });
    });

    // Scenario 73: fire-and-forget meter event rejection does not fail the
    // whole sale upsert — reconciliation cron will retry.
    it('meter event rejection does not fail the sale upsert', async () => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({
          allowed: true, blocked_by_limit: false, overage: true,
          pricePerSaleCents: 14,
          subscriptionId: 'sub-1', periodStart: 'x', periodEnd: 'y',
        }),
        invalidate: jest.fn(),
      };
      const sendMeterSpy = jest.fn().mockRejectedValue(new Error('stripe 500'));
      (service as any).stripeOverage = { sendMeterEvent: sendMeterSpy };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-overage' });
      jest.spyOn(service as any, 'insertOverage').mockResolvedValue('overage-fire');

      await expect(service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved', external_id: 'ext-fire', platform: 'kiwify',
      } as any)).resolves.toEqual({ id: 'sale-overage' });

      // Allow microtask queue to drain so the .catch(...) on the fire-and-forget
      // sendMeterEvent has a chance to run and confirm it doesn't surface.
      await new Promise((r) => setImmediate(r));
      expect(sendMeterSpy).toHaveBeenCalled();
    });

    // Scenario 84: Refund of a sale whose overage was already reported to Stripe.
    // Sale path for status='refunded' bypasses limit check entirely — no
    // interaction with usage_overage, no Stripe meter event. Locks in Q01
    // (overage-billing.md:219): the usage_overage row stays, reported_to_stripe_at
    // stays set, and manual case-by-case handling is required off-platform.
    it('refund webhook does not touch usage_overage or call meter events', async () => {
      const checkMock = jest.fn();
      const invalidateMock = jest.fn();
      const sendMeterMock = jest.fn();
      (service as any).planLimits = { checkSaleAcceptance: checkMock, invalidate: invalidateMock };
      (service as any).stripeOverage = { sendMeterEvent: sendMeterMock };
      const insertOverageSpy = jest.spyOn(service as any, 'insertOverage');
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-refund' });

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'refunded', external_id: 'ext-refund', platform: 'kiwify',
      } as any);

      expect(checkMock).not.toHaveBeenCalled();
      expect(insertOverageSpy).not.toHaveBeenCalled();
      expect(sendMeterMock).not.toHaveBeenCalled();
      expect(invalidateMock).not.toHaveBeenCalled();
    });
  });

  describe('upsertFromWebhook (rastreio de visitantes)', () => {
    beforeEach(() => {
      (service as any).planLimits = {
        checkSaleAcceptance: jest.fn().mockResolvedValue({ allowed: true, overage: false }),
        invalidate: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue(null);
    });

    it('tenta casar a venda aprovada com uma visita depois de gravar', async () => {
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-9' });

      await service.upsertFromWebhook({ user_id: 'user-1', status: 'approved', external_id: 'ext-9' });

      expect(mockVisitorMatching.matchSale).toHaveBeenCalledWith('sale-9');
    });

    it('tenta casar tambem a venda pendente', async () => {
      jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-p' });

      await service.upsertFromWebhook({ user_id: 'user-1', status: 'pending', external_id: 'ext-p' });

      expect(mockVisitorMatching.matchSale).toHaveBeenCalledWith('sale-p');
    });

    it('nao casa de novo uma venda repetida (webhook reenviado)', async () => {
      jest.spyOn(service as any, 'findByExternalId').mockResolvedValue({ id: 'existing' });

      await service.upsertFromWebhook({ user_id: 'user-1', status: 'approved', external_id: 'ext-1' });

      expect(mockVisitorMatching.matchSale).not.toHaveBeenCalled();
    });

    it('tira o marcador stl_ do ad_id, mas guarda no metadata para o casamento', async () => {
      const persistSpy = jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-s' });

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved', external_id: 'ext-s',
        ad_id: 'stl_0b7c9f4e-1a2b-4c3d-8e9f-001122334455',
        metadata: { original_amount: 97 },
      });

      expect(persistSpy).toHaveBeenCalledWith(expect.objectContaining({
        ad_id: null,
        metadata: {
          original_amount: 97,
          tracking_ref: 'stl_0b7c9f4e-1a2b-4c3d-8e9f-001122334455',
        },
      }));
    });

    it('mantem o ad_id numerico', async () => {
      const persistSpy = jest.spyOn(service as any, 'persist').mockResolvedValue({ id: 'sale-n' });

      await service.upsertFromWebhook({
        user_id: 'user-1', status: 'approved', external_id: 'ext-n', ad_id: '120245519580910309',
      });

      expect(persistSpy).toHaveBeenCalledWith(expect.objectContaining({ ad_id: '120245519580910309' }));
    });
  });

  describe('upsertManyImported', () => {
    it('batch-upserts with source=import and blocked_by_limit=false, returns inserted ids', async () => {
      (service as any).supabase = {
        getClient: () => ({
          from: () => ({
            upsert: (rows: any[], _opts: any) => ({
              select: () => Promise.resolve({
                data: rows.map((r, i) => ({ id: `id-${i}`, external_id: r.external_id })),
                error: null,
              }),
            }),
          }),
        }),
      };

      const rows = [
        { external_id: 'HP1', workspace_id: 'ws-1', user_id: 'u-1', amount: 10, currency: 'BRL', status: 'approved', sold_at: '2026-04-20T20:00:00Z' },
        { external_id: 'HP2', workspace_id: 'ws-1', user_id: 'u-1', amount: 20, currency: 'BRL', status: 'approved', sold_at: '2026-04-20T20:05:00Z' },
      ];

      const result = await service.upsertManyImported(rows as any);

      expect(result).toHaveLength(2);
      expect(result[0].external_id).toBe('HP1');
      expect(result[1].external_id).toBe('HP2');
    });

    it('chunks rows into batches of 500', async () => {
      const calls: number[] = [];
      (service as any).supabase = {
        getClient: () => ({
          from: () => ({
            upsert: (rows: any[]) => {
              calls.push(rows.length);
              return {
                select: () => Promise.resolve({
                  data: rows.map((r, i) => ({ id: `id-${i}`, external_id: r.external_id })),
                  error: null,
                }),
              };
            },
          }),
        }),
      };

      const rows = Array.from({ length: 1001 }, (_, i) => ({
        external_id: `HP${i}`,
        workspace_id: 'ws-1',
        user_id: 'u-1',
        amount: 10,
        currency: 'BRL',
        status: 'approved',
        sold_at: '2026-04-20T20:00:00Z',
      }));

      await service.upsertManyImported(rows as any);

      expect(calls).toEqual([500, 500, 1]);
    });

    it('stamps source=import and blocked_by_limit=false on every row regardless of caller input', async () => {
      let receivedRows: any[] = [];
      (service as any).supabase = {
        getClient: () => ({
          from: () => ({
            upsert: (rows: any[]) => {
              receivedRows = rows;
              return {
                select: () => Promise.resolve({
                  data: rows.map((r, i) => ({ id: `id-${i}`, external_id: r.external_id })),
                  error: null,
                }),
              };
            },
          }),
        }),
      };

      await service.upsertManyImported([
        { external_id: 'HP1', workspace_id: 'ws-1', user_id: 'u-1', amount: 10, currency: 'BRL', status: 'approved', sold_at: '2026-04-20T20:00:00Z', source: 'webhook', blocked_by_limit: true },
      ] as any);

      expect(receivedRows[0].source).toBe('import');
      expect(receivedRows[0].blocked_by_limit).toBe(false);
    });
  });
});
