import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
import { SalesService } from '../../sales/sales.service';
import { HublaProcessor } from '../processors/hubla.processor';
import { CartPandaProcessor } from '../processors/cartpanda.processor';
import { GGCheckoutProcessor } from '../processors/ggcheckout.processor';
import { LastLinkProcessor } from '../processors/lastlink.processor';

// ─── Test user / workspace ───────────────────────────────────────────────
const TEST_USER_ID = 'cfbc8829-f8c0-4514-89b5-f40b5dff513b';
const TEST_WORKSPACE_ID = 'ws-test-001';
const TEST_INTEGRATION_ID = 'int-test-001';
const TEST_TOKEN = 'test-webhook-token-2026';

// ─── Shared mock helpers ─────────────────────────────────────────────────
function createMockSupabase(overrides: Record<string, any> = {}) {
  const chainable: any = {};
  const methods = [
    'from', 'select', 'eq', 'filter', 'insert', 'upsert', 'update',
    'single', 'maybeSingle', 'limit', 'order', 'lte',
  ];
  for (const m of methods) {
    chainable[m] = jest.fn().mockReturnValue(chainable);
  }
  // Default: integration found (both single and maybeSingle)
  const integrationResult = {
    data: {
      id: TEST_INTEGRATION_ID,
      user_id: TEST_USER_ID,
      workspace_id: TEST_WORKSPACE_ID,
      is_active: true,
      ...overrides.integration,
    },
    error: null,
  };
  chainable.single.mockResolvedValue(integrationResult);
  chainable.maybeSingle.mockResolvedValue(integrationResult);
  return chainable;
}

function createMockWebhooksService() {
  return {
    extractNumericAdId: jest.fn((v: string | null) => {
      if (!v) return null;
      const parts = v.split('|');
      for (let i = parts.length - 1; i >= 0; i--) {
        const t = parts[i].trim().split('::')[0].trim();
        if (/^\d{6,}$/.test(t)) return t;
      }
      return null;
    }),
    getStateFromPhone: jest.fn((phone: string | null) => {
      if (!phone) return null;
      const digits = phone.replace(/\D/g, '');
      const ddd = digits.length >= 12 ? digits.substring(2, 4) : digits.substring(0, 2);
      const map: Record<string, string> = {
        '11': 'SP', '21': 'RJ', '31': 'MG', '41': 'PR',
        '51': 'RS', '54': 'RS', '61': 'DF', '71': 'BA',
        '79': 'SE', '82': 'AL',
      };
      return map[ddd] || null;
    }),
    matchAndUpdateSale: jest.fn(),
    findAndRefundOriginalSale: jest.fn().mockResolvedValue(null),
  };
}

function createMockSalesService(saleId = 'mock-sale-id') {
  return {
    upsertFromWebhook: jest.fn().mockResolvedValue({ id: saleId }),
  };
}

// ════════════════════════════════════════════════════════════════════════
// HUBLA
// ════════════════════════════════════════════════════════════════════════
describe('HublaProcessor', () => {
  let processor: HublaProcessor;
  let mockClient: any;
  let mockWS: ReturnType<typeof createMockWebhooksService>;
  let mockSalesService: ReturnType<typeof createMockSalesService>;

  beforeEach(async () => {
    mockClient = createMockSupabase();
    mockWS = createMockWebhooksService();
    mockSalesService = createMockSalesService('sale-hubla-001');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HublaProcessor,
        { provide: SupabaseService, useValue: { getClient: () => mockClient } },
        { provide: WebhooksService, useValue: mockWS },
        { provide: DiscordLoggerService, useValue: { logSale: jest.fn(), logRefund: jest.fn(), logError: jest.fn(), logTestIgnored: jest.fn() } },
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();

    processor = module.get(HublaProcessor);
  });

  it('should process a sale webhook (invoice.payment_succeeded)', async () => {
    const payload = {
      type: 'invoice.payment_succeeded',
      version: '2.0.0',
      event: {
        product: { id: 'prod-001', name: 'Curso de Marketing' },
        products: [
          {
            id: 'prod-001',
            name: 'Curso de Marketing',
            offers: [{ id: 'offer-001', name: 'Principal' }],
          },
        ],
        invoice: {
          id: 'inv-hubla-12345',
          subscriptionId: 'sub-hubla-001',
          sellerId: 'seller-001',
          payerId: 'payer-001',
          installments: 1,
          paymentMethod: 'pix',
          currency: 'BRL',
          type: 'sell',
          status: 'paid',
          amount: {
            subtotalCents: 9900,
            discountCents: 0,
            prorataCents: 0,
            installmentFeeCents: 0,
            totalCents: 9900,
          },
          firstPaymentSession: {
            ip: '189.44.10.22',
            utm: {
              source: 'FBjLj696036368',
              medium: 'CJ+TESTE|120241859179090404',
              campaign: 'CAMPANHA+TESTE|120241859179080404',
              content: 'AD+TESTE|120241859179100404',
              term: 'Instagram_Stories',
            },
          },
          billingAddress: {
            countryCode: 'BR',
            state: 'São Paulo',
            city: 'São Paulo',
          },
          saleDate: '2026-04-02T14:30:00.000Z',
        },
        user: {
          id: 'user-hubla-001',
          firstName: 'Maria',
          lastName: 'Silva',
          document: '12345678900',
          email: 'maria@test.com',
          phone: '+5511999888777',
        },
      },
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.sale_id).toBe('sale-hubla-001');
    expect(result.body.status).toBe('approved');

    // Verify upsertFromWebhook was called with correct data
    expect(mockSalesService.upsertFromWebhook).toHaveBeenCalledTimes(1);
    const saleData = mockSalesService.upsertFromWebhook.mock.calls[0][0];

    expect(saleData.user_id).toBe(TEST_USER_ID);
    expect(saleData.workspace_id).toBe(TEST_WORKSPACE_ID);
    expect(saleData.external_id).toBe('inv-hubla-12345');
    expect(saleData.amount).toBe(99); // 9900 centavos / 100
    expect(saleData.customer_name).toBe('Maria Silva');
    expect(saleData.customer_email).toBe('maria@test.com');
    expect(saleData.customer_phone).toBe('+5511999888777');
    expect(saleData.customer_doc).toBe('12345678900');
    expect(saleData.customer_city).toBe('São Paulo');
    expect(saleData.product_name).toBe('Curso de Marketing');
    expect(saleData.payment_method).toBe('pix');
    expect(saleData.currency).toBe('BRL');
    expect(saleData.status).toBe('approved');
    expect(saleData.checkout_integration_id).toBe(TEST_INTEGRATION_ID);
    expect(saleData.utm_source).toBe('FBjLj696036368');
    expect(saleData.utm_medium).toBe('CJ+TESTE|120241859179090404');
    expect(saleData.utm_campaign).toBe('CAMPANHA+TESTE|120241859179080404');
    expect(saleData.utm_content).toBe('AD+TESTE|120241859179100404');
    expect(saleData.utm_term).toBe('Instagram_Stories');

    // Verify ad matching was triggered
    expect(mockWS.matchAndUpdateSale).toHaveBeenCalledWith(
      'sale-hubla-001',
      TEST_USER_ID,
      expect.objectContaining({
        adId: '120241859179100404',
        utmCampaign: 'CAMPANHA+TESTE|120241859179080404',
        utmContent: 'AD+TESTE|120241859179100404',
        utmTerm: 'Instagram_Stories',
      }),
    );
  });

  it('should process a refund webhook (refund_request.accepted)', async () => {
    // Integration lookup uses .single() (defaulted to integration data by createMockSupabase).
    // The refund path does .maybeSingle() to find the existing approved sale by external_id.
    mockClient.maybeSingle.mockResolvedValueOnce({
      data: { id: 'sale-hubla-existing', status: 'approved' },
      error: null,
    });

    const payload = {
      type: 'refund_request.accepted',
      version: '2.0.0',
      event: {
        product: { id: 'prod-001', name: 'Curso de Marketing' },
        invoice: {
          id: 'inv-hubla-12345',
          paymentMethod: 'pix',
          currency: 'BRL',
          amount: { totalCents: 9900 },
          saleDate: '2026-04-02T14:30:00.000Z',
        },
        refund: {
          id: 'refund-001',
          status: 'accepted',
          isAutoAccepted: false,
        },
        user: {
          id: 'user-hubla-001',
          firstName: 'Maria',
          lastName: 'Silva',
          email: 'maria@test.com',
          phone: '+5511999888777',
        },
      },
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('refunded');

    // Refund path updates the existing sale status instead of creating a new record
    expect(mockSalesService.upsertFromWebhook).not.toHaveBeenCalled();
    expect(mockClient.update).toHaveBeenCalledWith({ status: 'refunded' });
  });

  it('should ignore unknown events', async () => {
    const result = await processor.process(
      { type: 'subscription.created' },
      TEST_TOKEN,
    );
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
  });

  it('should handle missing auth token gracefully', async () => {
    const result = await processor.process({}, null);
    expect(result.status).toBe(200);
    expect(result.body.message).toContain('No authentication token');
  });

  it('should return 401 for invalid token', async () => {
    mockClient.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const result = await processor.process(
      { type: 'invoice.payment_succeeded', event: {} },
      'invalid-token',
    );
    expect(result.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════
// CARTPANDA
// ════════════════════════════════════════════════════════════════════════
describe('CartPandaProcessor', () => {
  let processor: CartPandaProcessor;
  let mockClient: any;
  let mockWS: ReturnType<typeof createMockWebhooksService>;
  let mockSalesService: ReturnType<typeof createMockSalesService>;

  beforeEach(async () => {
    mockClient = createMockSupabase();
    mockWS = createMockWebhooksService();
    mockSalesService = createMockSalesService('sale-cp-001');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartPandaProcessor,
        { provide: SupabaseService, useValue: { getClient: () => mockClient } },
        { provide: WebhooksService, useValue: mockWS },
        { provide: DiscordLoggerService, useValue: { logSale: jest.fn(), logRefund: jest.fn(), logError: jest.fn(), logTestIgnored: jest.fn() } },
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();

    processor = module.get(CartPandaProcessor);
  });

  it('should process a sale webhook (order.paid) with real payload structure', async () => {
    const payload = {
      event: 'order.paid',
      order: {
        id: 44723052,
        email: 'vaniagre123@gmail.com',
        created_at: '2026-01-08 19:43:27',
        currency: 'BRL',
        customer: {
          id: 91643168,
          cpf: '000.373.770-51',
          email: 'vaniagre123@gmail.com',
          phone: '+5554999322033',
          full_name: 'Vania Grezzana',
        },
        payment: {
          id: 42822054,
          type: 'pix',
          amount: 32.8,
          payment_type: 'pix',
          gateway: 'cartpanda_pay',
        },
        line_items: [
          {
            id: 55581615,
            title: 'Congela Fácil Fit - Plano Completo',
            product_id: 26437300,
            price: 19.9,
          },
          {
            id: 55581616,
            title: 'Receitas Saladas Fit & Saborosas',
            product_id: 28304475,
            price: 12.9,
          },
        ],
        tracking_parameters: [
          { parameter_name: 'utm_source', parameter_value: 'FBjLj69603255248cbbb65c39ebcb' },
          { parameter_name: 'utm_medium', parameter_value: 'CRIATIVO 59|120239247454680535' },
          { parameter_name: 'utm_campaign', parameter_value: 'MARMITA 59|120239247454700535' },
          { parameter_name: 'utm_term', parameter_value: 'Instagram_Reels' },
          { parameter_name: 'utm_content', parameter_value: 'CTV 59|120239247454720535::PAZXh0bgNhZW0BMABhZGlkAass9WVojWdzcnRjBmFwcF9pZA81NjcwNjczNDMzNTI0MjcAAad27oiOHWU_ms4lhDukgpjl_mC0fWcAUjT10Ds4HLaqoB2uMcbGhBF9z2Zxiw_aem_UhAQzQsOLEBSAsKHO2ufeg::' },
        ],
        number: 3429,
        shop_id: 742838,
        click_id: '4266658168',
        no_of_installments: 1,
        coproducer_slug: 'mundoconhecimento',
        coproducer_amount: '30.87',
      },
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.sale_id).toBe('sale-cp-001');
    expect(result.body.status).toBe('approved');

    expect(mockSalesService.upsertFromWebhook).toHaveBeenCalledTimes(1);
    const saleData = mockSalesService.upsertFromWebhook.mock.calls[0][0];

    expect(saleData.user_id).toBe(TEST_USER_ID);
    expect(saleData.external_id).toBe('44723052');
    expect(saleData.amount).toBe(32.8);
    expect(saleData.customer_name).toBe('Vania Grezzana');
    expect(saleData.customer_email).toBe('vaniagre123@gmail.com');
    expect(saleData.customer_phone).toBe('+5554999322033');
    expect(saleData.customer_doc).toBe('000.373.770-51');
    expect(saleData.customer_state).toBe('RS'); // DDD 54
    expect(saleData.product_name).toBe('Congela Fácil Fit - Plano Completo');
    expect(saleData.payment_method).toBe('pix');
    expect(saleData.checkout_integration_id).toBe(TEST_INTEGRATION_ID);

    // UTM extraction
    expect(saleData.utm_source).toBe('FBjLj69603255248cbbb65c39ebcb');
    expect(saleData.utm_medium).toBe('CRIATIVO 59|120239247454680535');
    expect(saleData.utm_campaign).toBe('MARMITA 59|120239247454700535');
    expect(saleData.utm_term).toBe('Instagram_Reels');
    expect(saleData.utm_content).toContain('CTV 59|120239247454720535');

    // Date with timezone offset
    expect(saleData.sold_at).toBe('2026-01-08T19:43:27-03:00');

    // Ad matching
    expect(mockWS.extractNumericAdId).toHaveBeenCalled();
    expect(mockWS.matchAndUpdateSale).toHaveBeenCalledWith(
      'sale-cp-001',
      TEST_USER_ID,
      expect.objectContaining({
        utmCampaign: 'MARMITA 59|120239247454700535',
      }),
    );
  });

  it('should process a refund webhook (order.refunded)', async () => {
    // Integration lookup uses .single() (defaulted by createMockSupabase).
    // The refund path does .maybeSingle() to find the existing approved sale by external_id.
    mockClient.maybeSingle.mockResolvedValueOnce({
      data: { id: 'sale-cp-existing', status: 'approved' },
      error: null,
    });

    const payload = {
      event: 'order.refunded',
      order: {
        id: 44723052,
        customer: {
          email: 'vaniagre123@gmail.com',
          full_name: 'Vania Grezzana',
          phone: '+5554999322033',
        },
        payment: { amount: 32.8, payment_type: 'pix' },
        line_items: [{ title: 'Congela Fácil Fit' }],
        tracking_parameters: [],
        created_at: '2026-01-08 19:43:27',
      },
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('refunded');

    // Refund path updates the existing sale status instead of creating a new record
    expect(mockSalesService.upsertFromWebhook).not.toHaveBeenCalled();
    expect(mockClient.update).toHaveBeenCalledWith({ status: 'refunded' });
  });

  it('should ignore unknown events', async () => {
    const result = await processor.process(
      { event: 'order.cancelled' },
      TEST_TOKEN,
    );
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// GGCHECKOUT
// ════════════════════════════════════════════════════════════════════════
describe('GGCheckoutProcessor', () => {
  let processor: GGCheckoutProcessor;
  let mockClient: any;
  let mockWS: ReturnType<typeof createMockWebhooksService>;
  let mockSalesService: ReturnType<typeof createMockSalesService>;

  beforeEach(async () => {
    mockClient = createMockSupabase();
    mockWS = createMockWebhooksService();
    mockSalesService = createMockSalesService('sale-gg-001');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GGCheckoutProcessor,
        { provide: SupabaseService, useValue: { getClient: () => mockClient } },
        { provide: WebhooksService, useValue: mockWS },
        { provide: DiscordLoggerService, useValue: { logSale: jest.fn(), logRefund: jest.fn(), logError: jest.fn(), logTestIgnored: jest.fn() } },
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();

    processor = module.get(GGCheckoutProcessor);
  });

  it('should process a sale webhook (pix.paid) with real payload structure', async () => {
    const payload = {
      event: 'pix.paid',
      params: {
        sck: '1772387201341_17723875827815',
        src: 'FB',
        gclid: null,
        utm_term: 'Instagram_Stories',
        utm_medium: 'CJ|120240276410330446',
        utm_source: 'FB',
        utm_content: '33|120240276410340446',
        utm_campaign: '[15S]+[Bid+Cap]|120240276410310446',
      },
      payment: {
        id: '1774227253839eu8ggmk70xuaa',
        amount: 26.19,
        method: 'pix.paid',
        status: 'paid',
        gateway: null,
        paymentMethod: 'pix',
      },
      product: {
        id: 'cgSkgLjS98OUOal6XSrK',
        type: 'main',
        title: '15 Sentadas da Rainha - Plano VIP',
      },
      products: [
        {
          id: 'cgSkgLjS98OUOal6XSrK',
          type: 'main',
          title: '15 Sentadas da Rainha - Plano VIP',
        },
      ],
      customer: {
        ip: '172.64.222.34',
        name: 'Gláucia Calheiros',
        email: 'glauciabcontabeis@gmail.com',
        phone: '5582994033731',
        document: '***.763.104-**',
      },
      createdAt: {
        _seconds: 1774227284,
        _nanoseconds: 479000000,
      },
      webhook: {
        id: 'vFquxKREpg1YUPzLupDE',
        businessId: 'GU6Ne8PvzEhUNCZN3GWkJBrNtl13',
      },
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.sale_id).toBe('sale-gg-001');
    expect(result.body.status).toBe('approved');

    expect(mockSalesService.upsertFromWebhook).toHaveBeenCalledTimes(1);
    const saleData = mockSalesService.upsertFromWebhook.mock.calls[0][0];

    expect(saleData.user_id).toBe(TEST_USER_ID);
    expect(saleData.external_id).toBe('1774227253839eu8ggmk70xuaa');
    expect(saleData.amount).toBe(26.19);
    expect(saleData.customer_name).toBe('Gláucia Calheiros');
    expect(saleData.customer_email).toBe('glauciabcontabeis@gmail.com');
    expect(saleData.customer_phone).toBe('5582994033731');
    expect(saleData.customer_doc).toBe('***.763.104-**');
    expect(saleData.customer_state).toBe('AL'); // DDD 82
    expect(saleData.product_name).toBe('15 Sentadas da Rainha - Plano VIP');
    expect(saleData.payment_method).toBe('pix');
    expect(saleData.checkout_integration_id).toBe(TEST_INTEGRATION_ID);

    // UTMs
    expect(saleData.utm_source).toBe('FB');
    expect(saleData.utm_medium).toBe('CJ|120240276410330446');
    expect(saleData.utm_campaign).toBe('[15S]+[Bid+Cap]|120240276410310446');
    expect(saleData.utm_content).toBe('33|120240276410340446');
    expect(saleData.utm_term).toBe('Instagram_Stories');

    // Firestore timestamp conversion
    expect(saleData.sold_at).toBe(new Date(1774227284 * 1000).toISOString());

    // raw_data extras
    expect(saleData.metadata.sck).toBe('1772387201341_17723875827815');
    expect(saleData.metadata.src).toBe('FB');
    expect(saleData.metadata.customer_ip).toBe('172.64.222.34');

    // Ad matching
    expect(mockWS.matchAndUpdateSale).toHaveBeenCalledWith(
      'sale-gg-001',
      TEST_USER_ID,
      expect.objectContaining({
        adId: '120240276410340446',
      }),
    );
  });

  it('should process card.paid event', async () => {
    mockSalesService = createMockSalesService('sale-gg-card');
    // Re-compile with new mock
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GGCheckoutProcessor,
        { provide: SupabaseService, useValue: { getClient: () => mockClient } },
        { provide: WebhooksService, useValue: mockWS },
        { provide: DiscordLoggerService, useValue: { logSale: jest.fn(), logRefund: jest.fn(), logError: jest.fn(), logTestIgnored: jest.fn() } },
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();
    processor = module.get(GGCheckoutProcessor);

    const result = await processor.process(
      {
        event: 'card.paid',
        payment: { id: 'pay-card-001', amount: 50, paymentMethod: 'credit_card' },
        customer: { name: 'João', email: 'joao@test.com' },
        product: { title: 'Produto X' },
        params: {},
        createdAt: { _seconds: 1774227284 },
      },
      TEST_TOKEN,
    );

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('approved');
  });

  it('should process refund events (pix.refunded, card.chargeback)', async () => {
    for (const event of ['pix.refunded', 'card.chargeback']) {
      // Each refund iteration needs its own mocked existing sale lookup
      mockClient.maybeSingle.mockResolvedValueOnce({
        data: { id: `sale-gg-${event}`, status: 'approved' },
        error: null,
      });

      const result = await processor.process(
        {
          event,
          payment: { id: `pay-${event}`, amount: 10, paymentMethod: 'pix' },
          customer: { email: 'test@test.com' },
          product: { title: 'Produto' },
          params: {},
          createdAt: { _seconds: 1774227284 },
        },
        TEST_TOKEN,
      );

      expect(result.status).toBe(200);
      expect(result.body.status).toBe('refunded');
    }
  });

  it('should ignore pix.generated event', async () => {
    const result = await processor.process(
      { event: 'pix.generated' },
      TEST_TOKEN,
    );
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// LASTLINK
// ════════════════════════════════════════════════════════════════════════
describe('LastLinkProcessor', () => {
  let processor: LastLinkProcessor;
  let mockClient: any;
  let mockWS: ReturnType<typeof createMockWebhooksService>;
  let mockSalesService: ReturnType<typeof createMockSalesService>;

  beforeEach(async () => {
    mockClient = createMockSupabase();
    mockWS = createMockWebhooksService();
    mockSalesService = createMockSalesService('sale-ll-001');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LastLinkProcessor,
        { provide: SupabaseService, useValue: { getClient: () => mockClient } },
        { provide: WebhooksService, useValue: mockWS },
        { provide: DiscordLoggerService, useValue: { logSale: jest.fn(), logRefund: jest.fn(), logError: jest.fn(), logTestIgnored: jest.fn() } },
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();

    processor = module.get(LastLinkProcessor);
  });

  it('should process a purchase webhook with real payload structure', async () => {
    const payload = {
      Utm: {
        UtmId: '120241859179080404',
        UtmTerm: 'Instagram_Stories',
        UtmMedium: '17+DEZ+CJ+1|120241859179090404',
        UtmSource: 'FBjLj69603636805f8dc5b54358e9',
        UtmContent: 'AD+1+TEST+17+DEZ|120241859179100404::PAZXh0bgNhZW0BMABhZGlkAasv9eIxYoRzcnRjBmFwcF9pZA81NjcwNjczNDMzNTI0MjcAAafS_dqVP5k9MVgt3tqL5WhIuvQaFzcDiVqW2MoDBEH7Y9B2kM3iSvLSTNYYMA_aem_S9yGhwS-O2kD0Fq_pzJ3UA::',
        UtmCampaign: 'AD+TEST+QUIZ+17+DEZ|120241859179080404',
      },
      Buyer: {
        Id: 'd41101bb-8eb5-4520-83bc-dee84d09cdf4',
        Name: 'Adriana Maria dos Santos Neris ',
        Email: 'adrianasneris@gmail.com',
        PhoneNumber: '+5579988181021',
      },
      Offer: {
        Id: 'ab183050-1187-4ad2-94a9-49bcf96fa643',
        Name: 'Guia Kids Nutri',
      },
      Seller: {
        Id: '44096315-6f74-4198-b6d2-a087fd57b850',
        Email: 'lucasreduamkt@gmail.com',
      },
      Products: [
        {
          Id: '3aa2115b-111d-496d-980c-3d139bc04c43',
          Name: 'Receitas Nutritivas',
          Price: 29.9,
        },
      ],
      Purchase: {
        Price: { Value: 29.9 },
        Payment: {
          PaymentMethod: 'pix',
          InterestRateAmount: 0,
          NumberOfInstallments: 1,
        },
        PaymentId: '4c10722c-b190-4d24-b6db-4ae60eefebd4',
        Recurrency: 0,
        PaymentDate: '2026-01-08T23:00:51',
        OriginalPrice: { Value: 29.9 },
      },
      DeviceInfo: {
        ip: '168.181.112.236',
        UserAgent: 'Mozilla/5.0 Instagram/411.0.0.23.257',
      },
      Commissions: [
        { Value: 3.98, Source: 'MARKETPLACE' },
        { Value: 25.92, Source: 'PRODUCER' },
      ],
      Subscriptions: [
        {
          Id: '8d6b7c6b-0fc7-4a59-b512-de5f75c78242',
          ProductId: '3aa2115b-111d-496d-980c-3d139bc04c43',
        },
      ],
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.sale_id).toBe('sale-ll-001');
    expect(result.body.status).toBe('approved');

    expect(mockSalesService.upsertFromWebhook).toHaveBeenCalledTimes(1);
    const saleData = mockSalesService.upsertFromWebhook.mock.calls[0][0];

    expect(saleData.user_id).toBe(TEST_USER_ID);
    expect(saleData.external_id).toBe('4c10722c-b190-4d24-b6db-4ae60eefebd4');
    expect(saleData.amount).toBe(29.9);
    expect(saleData.customer_name).toBe('Adriana Maria dos Santos Neris');
    expect(saleData.customer_email).toBe('adrianasneris@gmail.com');
    expect(saleData.customer_phone).toBe('+5579988181021');
    expect(saleData.customer_state).toBe('SE'); // DDD 79
    expect(saleData.product_name).toBe('Receitas Nutritivas');
    expect(saleData.payment_method).toBe('pix');
    expect(saleData.status).toBe('approved');
    expect(saleData.checkout_integration_id).toBe(TEST_INTEGRATION_ID);

    // UTMs (PascalCase source)
    expect(saleData.utm_source).toBe('FBjLj69603636805f8dc5b54358e9');
    expect(saleData.utm_medium).toBe('17+DEZ+CJ+1|120241859179090404');
    expect(saleData.utm_campaign).toBe('AD+TEST+QUIZ+17+DEZ|120241859179080404');
    expect(saleData.utm_content).toContain('AD+1+TEST+17+DEZ|120241859179100404');

    // Date with timezone
    expect(saleData.sold_at).toBe('2026-01-08T23:00:51-03:00');

    // raw_data has subscription_id for refund matching
    expect(saleData.metadata.subscription_id).toBe('8d6b7c6b-0fc7-4a59-b512-de5f75c78242');
    expect(saleData.metadata.utm_id).toBe('120241859179080404');
    expect(saleData.metadata.commissions).toHaveLength(2);
    expect(saleData.metadata.ip).toBe('168.181.112.236');

    // Ad matching
    expect(mockWS.matchAndUpdateSale).toHaveBeenCalledWith(
      'sale-ll-001',
      TEST_USER_ID,
      expect.objectContaining({
        adId: '120241859179100404',
      }),
    );
  });

  it('should process a refund webhook (Action=Remove) by Subscription.Id', async () => {
    // LastLink uses maybeSingle for both integration lookup and sale lookup
    mockClient.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: TEST_INTEGRATION_ID,
          user_id: TEST_USER_ID,
          workspace_id: TEST_WORKSPACE_ID,
          is_active: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'sale-ll-original', status: 'approved' },
        error: null,
      });

    const payload = {
      Buyer: {
        Id: '45c8cf19-7e35-4e29-9f4e-9e0e777763f5',
        Name: '',
        Email: 'moniquecaroliniis@gmail.com',
        Document: '',
      },
      Action: 'Remove',
      Seller: {
        Id: '1dd6bd1e-31a6-4804-bd88-e47ee154d0a9',
        Email: 'davinielneves@gmail.com',
      },
      Product: {
        Id: '91fda6d9-caf7-4804-ba8e-9ff23e8756ca',
        Name: 'ShapeMax Dance App',
      },
      Subscription: {
        Id: '235cf603-8726-4009-b716-6f106f3026d9',
        ProductId: '91fda6d9-caf7-4804-ba8e-9ff23e8756ca',
      },
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.sale_id).toBe('sale-ll-original');
    expect(result.body.status).toBe('refunded');

    // Verify it searched by subscription_id in raw_data
    expect(mockClient.filter).toHaveBeenCalledWith(
      'metadata->>subscription_id',
      'eq',
      '235cf603-8726-4009-b716-6f106f3026d9',
    );

    // Verify sale was updated to refunded
    expect(mockClient.update).toHaveBeenCalledWith({ status: 'refunded' });
  });

  it('should ignore refund when no sale found for subscription_id', async () => {
    mockClient.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: TEST_INTEGRATION_ID,
          user_id: TEST_USER_ID,
          workspace_id: TEST_WORKSPACE_ID,
          is_active: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const payload = {
      Action: 'Remove',
      Buyer: { Email: 'test@test.com' },
      Subscription: { Id: 'non-existent-sub' },
    };

    const result = await processor.process(payload, TEST_TOKEN);

    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
    expect(result.body.reason).toContain('No sale found');
  });

  it('should skip already refunded sales', async () => {
    mockClient.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: TEST_INTEGRATION_ID,
          user_id: TEST_USER_ID,
          workspace_id: TEST_WORKSPACE_ID,
          is_active: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'sale-already-refunded', status: 'refunded' },
        error: null,
      });

    const result = await processor.process(
      {
        Action: 'Remove',
        Buyer: { Email: 'test@test.com' },
        Subscription: { Id: 'sub-123' },
      },
      TEST_TOKEN,
    );

    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
    expect(result.body.reason).toContain('already refunded');
  });

  it('should ignore refund without Subscription.Id', async () => {
    mockClient.maybeSingle.mockResolvedValueOnce({
      data: {
        id: TEST_INTEGRATION_ID,
        user_id: TEST_USER_ID,
        workspace_id: TEST_WORKSPACE_ID,
        is_active: true,
      },
      error: null,
    });

    const result = await processor.process(
      { Action: 'Remove', Buyer: { Email: 'test@test.com' } },
      TEST_TOKEN,
    );

    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
    expect(result.body.reason).toContain('Subscription.Id');
  });

  it('should ignore test events (IsTest=true)', async () => {
    const result = await processor.process(
      { Purchase: {}, IsTest: true },
      TEST_TOKEN,
    );
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
    expect(result.body.reason).toContain('Test event');
  });

  it('should ignore payloads with no Purchase and no Action=Remove', async () => {
    const result = await processor.process(
      { SomeOtherField: 'value' },
      TEST_TOKEN,
    );
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
  });
});
