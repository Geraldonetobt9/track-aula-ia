// packages/backend/src/modules/stripe/__tests__/stripe-billing.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StripeBillingService } from '../stripe-billing.service';
import { StripeService } from '../stripe.service';
import { SupabaseService } from '../../../shared/services/supabase.service';

describe('StripeBillingService', () => {
  let service: StripeBillingService;
  let supabaseMock: any;
  let stripeMock: any;
  let setupIntentsCreate: jest.Mock;

  beforeEach(async () => {
    setupIntentsCreate = jest.fn();
    stripeMock = {
      getClient: () => ({
        setupIntents: { create: setupIntentsCreate },
        customers: { retrieve: jest.fn() },
        paymentMethods: { list: jest.fn(), retrieve: jest.fn(), detach: jest.fn() },
      }),
    };
    const supabaseClient = { from: jest.fn() };
    supabaseMock = { getClient: () => supabaseClient };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeBillingService,
        { provide: StripeService, useValue: stripeMock },
        { provide: SupabaseService, useValue: supabaseMock },
      ],
    }).compile();
    service = module.get(StripeBillingService);
  });

  describe('createSetupIntent', () => {
    it('cria SetupIntent atrelado ao customer e retorna client_secret', async () => {
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_customer_id: 'cus_1' }, error: null,
        })})}),
      }));
      setupIntentsCreate.mockResolvedValue({
        id: 'seti_1',
        client_secret: 'seti_1_secret_xyz',
      });

      const result = await service.createSetupIntent('user-1');

      expect(setupIntentsCreate).toHaveBeenCalledWith({
        customer: 'cus_1',
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: { user_id: 'user-1' },
      });
      expect(result).toEqual({ clientSecret: 'seti_1_secret_xyz' });
    });

    it('rejeita user sem stripe_customer_id', async () => {
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_customer_id: null }, error: null,
        })})}),
      }));

      await expect(service.createSetupIntent('user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('attachPaymentMethod', () => {
    let paymentMethodsRetrieve: jest.Mock;
    let paymentMethodsList: jest.Mock;
    let customersUpdate: jest.Mock;

    beforeEach(() => {
      paymentMethodsRetrieve = jest.fn();
      paymentMethodsList = jest.fn();
      customersUpdate = jest.fn();
      stripeMock.getClient = () => ({
        setupIntents: { create: setupIntentsCreate },
        customers: { retrieve: jest.fn(), update: customersUpdate },
        paymentMethods: { retrieve: paymentMethodsRetrieve, list: paymentMethodsList, detach: jest.fn() },
      });
    });

    function mockCustomerLookup(customerId: string) {
      supabaseMock.getClient().from = jest.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { stripe_customer_id: customerId }, error: null,
        })})}),
      }));
    }

    it('valida ownership e marca primeiro PM como default', async () => {
      mockCustomerLookup('cus_1');
      paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_1' });
      paymentMethodsList.mockResolvedValue({ data: [{ id: 'pm_1' }] }); // só esse
      customersUpdate.mockResolvedValue({ id: 'cus_1' });

      const result = await service.attachPaymentMethod('user-1', 'pm_1', { setAsDefault: false });

      expect(customersUpdate).toHaveBeenCalledWith('cus_1', {
        invoice_settings: { default_payment_method: 'pm_1' },
      });
      expect(result).toEqual({ success: true, is_default: true });
    });

    it('marca como default quando setAsDefault=true mesmo com outros PMs', async () => {
      mockCustomerLookup('cus_1');
      paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_2', customer: 'cus_1' });
      paymentMethodsList.mockResolvedValue({ data: [{ id: 'pm_1' }, { id: 'pm_2' }] });
      customersUpdate.mockResolvedValue({ id: 'cus_1' });

      const result = await service.attachPaymentMethod('user-1', 'pm_2', { setAsDefault: true });

      expect(customersUpdate).toHaveBeenCalledWith('cus_1', {
        invoice_settings: { default_payment_method: 'pm_2' },
      });
      expect(result.is_default).toBe(true);
    });

    it('não toca em default quando setAsDefault=false e já tem outros PMs', async () => {
      mockCustomerLookup('cus_1');
      paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_2', customer: 'cus_1' });
      paymentMethodsList.mockResolvedValue({ data: [{ id: 'pm_1' }, { id: 'pm_2' }] });

      const result = await service.attachPaymentMethod('user-1', 'pm_2', { setAsDefault: false });

      expect(customersUpdate).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, is_default: false });
    });

    it('rejeita PM de outro customer', async () => {
      mockCustomerLookup('cus_1');
      paymentMethodsRetrieve.mockResolvedValue({ id: 'pm_x', customer: 'cus_2' });

      await expect(service.attachPaymentMethod('user-1', 'pm_x', { setAsDefault: false }))
        .rejects.toThrow(/não pertence/i);
    });
  });
});
