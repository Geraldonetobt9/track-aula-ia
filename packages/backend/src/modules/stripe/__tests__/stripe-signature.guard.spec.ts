import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { StripeSignatureGuard } from '../stripe-signature.guard';
import { StripeService } from '../stripe.service';

describe('StripeSignatureGuard', () => {
  let guard: StripeSignatureGuard;
  let constructEventMock: jest.Mock;

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    constructEventMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeSignatureGuard,
        {
          provide: StripeService,
          useValue: {
            getClient: () => ({ webhooks: { constructEvent: constructEventMock } }),
          },
        },
      ],
    }).compile();

    guard = module.get(StripeSignatureGuard);
  });

  function makeCtx(headers: Record<string, string>, rawBody: string | undefined) {
    const request: any = { headers, rawBody };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  it('throws when stripe-signature header missing', () => {
    const ctx = makeCtx({}, 'body');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when rawBody missing', () => {
    const ctx = makeCtx({ 'stripe-signature': 'sig' }, undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws when constructEvent throws (invalid signature)', () => {
    constructEventMock.mockImplementation(() => { throw new Error('bad sig'); });
    const ctx = makeCtx({ 'stripe-signature': 'sig' }, 'body');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('returns true and attaches stripeEvent on valid signature', () => {
    const event = { id: 'evt_1', type: 'customer.subscription.created' };
    constructEventMock.mockReturnValue(event);
    const request: any = { headers: { 'stripe-signature': 'sig' }, rawBody: 'body' };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.stripeEvent).toBe(event);
    expect(constructEventMock).toHaveBeenCalledWith('body', 'sig', 'whsec_test');
  });

  // Scenario 48: STRIPE_WEBHOOK_SECRET not configured — reject with 401.
  it('throws when STRIPE_WEBHOOK_SECRET is not configured', () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const ctx = makeCtx({ 'stripe-signature': 'sig' }, 'body');
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
      expect(constructEventMock).not.toHaveBeenCalled();
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = previous;
    }
  });
});
