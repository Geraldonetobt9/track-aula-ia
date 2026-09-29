import { CHECKOUT_SPECS } from '../checkout-specs';
import { parseCheckout, parseMoney } from '../checkout-parser';

const REF = 'stl_ffffffff-0000-4111-8222-333333333333';

/**
 * Um payload por plataforma, montado com os caminhos que o container do
 * sGTM dela lê hoje. Confere que o processor tira a venda dos mesmos lugares.
 */
const PAYLOADS: Record<string, { body: any; expect: Record<string, unknown> }> = {
  wiven: {
    body: {
      event: 'TRANSACTION_PAID',
      transaction: { id: 'WV-1', commissionAmount: 87.3, currency: 'brl' },
      client: { email: 'Ana@Mail.com', phone: '11987654321', name: 'Ana Souza' },
      orderItems: [{ product: { id: 'P1', name: 'Curso Wiven' } }],
      trackProps: { sck: REF, utm_source: 'FB', utm_content: 'ad|120245519580910309' },
    },
    expect: {
      externalId: 'WV-1', commissionAmount: 87.3, currency: 'BRL', productName: 'Curso Wiven', productId: 'P1',
      customerEmail: 'ana@mail.com', indexer: REF, utmSource: 'FB', utmContent: 'ad|120245519580910309',
    },
  },
  frendz: {
    body: {
      event: 'transaction',
      transaction: { id: 'FZ-1' },
      offer: { price: 19700, title: 'Oferta Frendz', hash: 'h1' },
      customer: { email: 'b@mail.com', phone: '21999998888', name: 'Bruno Lima' },
      tracking: { src: REF, utm_campaign: 'camp|9' },
    },
    expect: { externalId: 'FZ-1', grossAmount: 197, productName: 'Oferta Frendz', productId: 'h1', indexer: REF, utmCampaign: 'camp|9' },
  },
  herospark: {
    body: {
      transaction_id: 'HS-1',
      buyer: { email: 'c@mail.com', phone: '31988887777', name: 'Carla Dias' },
      purchase: { price: { value: 497 } },
      product: { id: 55, name: 'Mentoria' },
      data: { purchase: { checkout_country: { iso: 'BR' } } },
      utm: { src: REF },
    },
    expect: { externalId: 'HS-1', grossAmount: 497, productName: 'Mentoria', productId: '55', country: 'BR', indexer: REF },
  },
  kavoo: {
    body: {
      transaction: { code: 'KV-1', fee_producer: 8970 },
      customer: { email: 'd@mail.com', phone: '41977776666', name: 'Davi Reis' },
      items: [{ name: 'Produto Kavoo', product_id: 'K9' }],
      tracking: { src: REF },
    },
    expect: { externalId: 'KV-1', commissionAmount: 89.7, grossAmount: null, productName: 'Produto Kavoo', indexer: REF },
  },
  pagtrust: {
    body: {
      event: 'PURCHASE_APPROVED',
      data: {
        buyer: { email: 'e@mail.com', checkout_phone: '51966665555', name: 'Eva Melo', adress: { city: 'Porto Alegre', zipcode: '90000-000' } },
        purchase: {
          transaction: 'HP-PT-1',
          price: { value: 297, currency_value: 'BRL' },
          checkout_country: { iso: 'BR' },
          origin: { xcod: REF },
        },
        commissions: [{ value: 10 }, { value: 250.5, currency_value: 'BRL' }],
        product: { id: 7, name: 'Curso PagTrust' },
      },
    },
    expect: {
      externalId: 'HP-PT-1', grossAmount: 297, commissionAmount: 250.5, city: 'Porto Alegre', zip: '90000-000',
      productName: 'Curso PagTrust', indexer: REF,
    },
  },
  assiny: {
    body: {
      event: 'approved_purchase',
      data: {
        transaction: { id: 'AS-1' },
        client: { email: 'f@mail.com', phone: '61955554444', full_name: 'Fabio Rocha' },
        offer: { amount_client: 14990, product: { id: 'A1', name: 'Oferta Assiny' } },
        metadata: { url_parameters: { xcod: REF, utm_source: 'FB' } },
      },
    },
    expect: { externalId: 'AS-1', grossAmount: 149.9, customerName: 'Fabio Rocha', indexer: REF, utmSource: 'FB' },
  },
  yampi: {
    body: {
      event: 'order.paid',
      resource: {
        id: 7788,
        value_total: 159.9,
        utm_term: REF,
        utm_source: 'facebook',
        customer: { data: { email: 'g@mail.com', first_name: 'Gil', last_name: 'Nunes', phone: { formated_number: '(71) 94444-3333' } } },
        items: { data: [{ sku: { data: { title: 'Tênis', product_id: 321 } } }] },
      },
    },
    expect: {
      externalId: '7788', grossAmount: 159.9, customerName: 'Gil Nunes', productName: 'Tênis', productId: '321',
      indexer: REF, utmSource: 'facebook', utmTerm: null, // o indexador não vira utm_term
    },
  },
  wiapy: {
    body: {
      payment: { id: 'WP-1', amount: 9700 },
      customer: { email: 'h@mail.com', mobile_phone: '81933332222', name: 'Heitor Paz' },
      products: [{ id: 'W1', title: 'Curso Wiapy' }],
      tracking: { utm_term: REF, utm_source: 'FB' },
    },
    expect: { externalId: 'WP-1', grossAmount: 97, productName: 'Curso Wiapy', indexer: REF, utmTerm: null },
  },
  doppus: {
    body: {
      transaction: { code: 'DP-1', fee_producer: 45000 },
      customer: { email: 'i@mail.com', phone: '91922221111', name: 'Iara Luz' },
      items: [{ code: 'D1', name: 'Produto Doppus' }],
      tracking: { utm_term: REF },
    },
    expect: { externalId: 'DP-1', commissionAmount: 450, productId: 'D1', indexer: REF },
  },
};

describe('parseCheckout — um payload por plataforma, pelos caminhos dos containers', () => {
  it('cobre as 9 plataformas', () => {
    expect(Object.keys(PAYLOADS).sort()).toEqual(Object.keys(CHECKOUT_SPECS).sort());
  });

  for (const [platform, { body, expect: expected }] of Object.entries(PAYLOADS)) {
    it(`${platform}: aprova e le os campos`, () => {
      const parsed = parseCheckout(CHECKOUT_SPECS[platform], body);
      expect(parsed.decision).toBe('approved');
      expect(parsed).toMatchObject(expected);
      expect(parsed.customerEmail).toMatch(/@mail\.com$/);
      expect(parsed.customerPhone).toBeTruthy();
      expect(parsed.customerName).toBeTruthy();
    });
  }
});

describe('parseCheckout — decisao', () => {
  it('evento fora da lista e ignorado onde o container filtrava por evento', () => {
    const p = parseCheckout(CHECKOUT_SPECS.yampi, { event: 'order.created', resource: { id: 1 } });
    expect(p.decision).toBe('ignored');
  });

  it('evento de reembolso reembolsa', () => {
    expect(parseCheckout(CHECKOUT_SPECS.pagtrust, { event: 'PURCHASE_REFUNDED' }).decision).toBe('refunded');
    expect(parseCheckout(CHECKOUT_SPECS.wiven, { event: 'TRANSACTION_CHARGEBACK' }).decision).toBe('refunded');
    // Nome de evento desconhecido, mas claramente de reembolso.
    expect(parseCheckout(CHECKOUT_SPECS.assiny, { event: 'purchase_chargedback' }).decision).toBe('refunded');
  });

  it('onde o container aprovava tudo, um status pendente segura a venda', () => {
    const body = { ...PAYLOADS.kavoo.body, transaction: { ...PAYLOADS.kavoo.body.transaction, status: 'waiting_payment' } };
    const p = parseCheckout(CHECKOUT_SPECS.kavoo, body);
    expect(p.decision).toBe('ignored');
    expect(p.reason).toContain('waiting_payment');
  });

  it('status pago/aprovado aprova; reembolsado reembolsa', () => {
    expect(parseCheckout(CHECKOUT_SPECS.wiapy, { payment: { id: 1, status: 'PAID' } }).decision).toBe('approved');
    expect(parseCheckout(CHECKOUT_SPECS.frendz, { transaction: { id: 1, status: 'aprovada' } }).decision).toBe('approved');
    expect(parseCheckout(CHECKOUT_SPECS.doppus, { status: { code: 'refunded' } }).decision).toBe('refunded');
  });

  it('PagTrust com xcod em formato de UTM (nao indexador) vira UTMs', () => {
    const p = parseCheckout(CHECKOUT_SPECS.pagtrust, {
      event: 'PURCHASE_APPROVED',
      data: { purchase: { transaction: 'X', origin: { xcod: 'FB|cpc|x|camp|1|ad|120245519580910309|feed' } } },
    });
    expect(p.utmSource).toBe('FB');
    expect(p.utmContent).toBe('ad|120245519580910309');
  });
});

describe('parseMoney', () => {
  it('le os formatos comuns', () => {
    expect(parseMoney(97, false)).toBe(97);
    expect(parseMoney('97.00', false)).toBe(97);
    expect(parseMoney('97,50', false)).toBe(97.5);
    expect(parseMoney('R$ 1.234,56', false)).toBe(1234.56);
    expect(parseMoney('1,234.56', false)).toBe(1234.56);
  });

  it('centavos como no regex dos containers', () => {
    expect(parseMoney(19700, true)).toBe(197);
    expect(parseMoney('14990', true)).toBe(149.9);
  });

  it('lixo vira null', () => {
    expect(parseMoney('abc', false)).toBeNull();
    expect(parseMoney({}, false)).toBeNull();
  });
});
