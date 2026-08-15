import { Test, TestingModule } from '@nestjs/testing';
import { StripeOverageReconciliationCron } from '../stripe-overage-reconciliation.cron';
import { StripeOverageService } from '../stripe-overage.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';

describe('StripeOverageReconciliationCron', () => {
  let cron: StripeOverageReconciliationCron;
  let sendMeterEvent: jest.Mock;
  let logApiError: jest.Mock;
  let capturedQuery: {
    isCol?: string;
    isVal?: any;
    ltCol?: string;
    ltVal?: any;
    limitN?: number;
  };
  let pendingRowsProvider: () => any[];

  beforeEach(() => {
    capturedQuery = {};
    pendingRowsProvider = () => [];
  });

  async function buildCron() {
    sendMeterEvent = jest.fn().mockResolvedValue(undefined);
    logApiError = jest.fn();

    const supabase = {
      getClient: () => ({
        from: (_t: string) => {
          const builder: any = {
            select: () => builder,
            is: (col: string, val: any) => { capturedQuery.isCol = col; capturedQuery.isVal = val; return builder; },
            lt: (col: string, val: any) => { capturedQuery.ltCol = col; capturedQuery.ltVal = val; return builder; },
            limit: (n: number) => { capturedQuery.limitN = n; return builder; },
            then: (resolve: any) => Promise.resolve({ data: pendingRowsProvider(), error: null }).then(resolve),
          };
          return builder;
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeOverageReconciliationCron,
        { provide: StripeOverageService, useValue: { sendMeterEvent } },
        { provide: SupabaseService, useValue: supabase },
        { provide: DiscordLoggerService, useValue: { logApiError } },
      ],
    }).compile();

    cron = module.get(StripeOverageReconciliationCron);
  }

  // Scenario 67 — part 1: processes each pending row via sendMeterEvent.
  it('processes every pending row via sendMeterEvent', async () => {
    pendingRowsProvider = () => [
      { id: 'overage-1' }, { id: 'overage-2' }, { id: 'overage-3' },
    ];
    await buildCron();

    await cron.retryPendingMeterEvents();

    expect(sendMeterEvent).toHaveBeenCalledTimes(3);
    expect(sendMeterEvent).toHaveBeenNthCalledWith(1, { overageId: 'overage-1' });
    expect(sendMeterEvent).toHaveBeenNthCalledWith(2, { overageId: 'overage-2' });
    expect(sendMeterEvent).toHaveBeenNthCalledWith(3, { overageId: 'overage-3' });
  });

  // Scenario 67 — part 2: per-row failure logs but does not abort the loop.
  it('per-row failure is logged but the loop continues', async () => {
    pendingRowsProvider = () => [
      { id: 'overage-a' }, { id: 'overage-b' }, { id: 'overage-c' },
    ];
    await buildCron();
    sendMeterEvent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stripe boom'))
      .mockResolvedValueOnce(undefined);

    await expect(cron.retryPendingMeterEvents()).resolves.toBeUndefined();
    expect(sendMeterEvent).toHaveBeenCalledTimes(3);
  });

  // Scenario 67 — part 3: count > 100 triggers Discord notification.
  it('notifies Discord when count > 100', async () => {
    pendingRowsProvider = () => Array.from({ length: 101 }, (_, i) => ({ id: `overage-${i}` }));
    await buildCron();

    await cron.retryPendingMeterEvents();

    expect(logApiError).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'overage-reconciliation',
      error: expect.stringContaining('101'),
    }));
  });

  // Scenario 67 — part 4: count <= 100 does NOT notify Discord.
  it('does not notify Discord when count <= 100', async () => {
    pendingRowsProvider = () => Array.from({ length: 100 }, (_, i) => ({ id: `overage-${i}` }));
    await buildCron();

    await cron.retryPendingMeterEvents();
    expect(logApiError).not.toHaveBeenCalled();
  });

  // Scenario 68: query filters created_at < 1h ago (ignores hot-path rows).
  it('query filters rows older than 1 hour only', async () => {
    pendingRowsProvider = () => [];
    await buildCron();

    const before = Date.now();
    await cron.retryPendingMeterEvents();
    const after = Date.now();

    expect(capturedQuery.ltCol).toBe('created_at');
    const oneHourAgoSent = Date.parse(capturedQuery.ltVal);
    expect(oneHourAgoSent).toBeGreaterThanOrEqual(before - 60 * 60 * 1000);
    expect(oneHourAgoSent).toBeLessThanOrEqual(after - 60 * 60 * 1000);
    expect(capturedQuery.limitN).toBe(500);
  });

  // Scenario 69: query filters reported_to_stripe_at IS NULL (ignores
  // already-reported rows — otherwise we'd double-report).
  it('query filters reported_to_stripe_at IS NULL', async () => {
    pendingRowsProvider = () => [];
    await buildCron();
    await cron.retryPendingMeterEvents();

    expect(capturedQuery.isCol).toBe('reported_to_stripe_at');
    expect(capturedQuery.isVal).toBeNull();
  });
});
