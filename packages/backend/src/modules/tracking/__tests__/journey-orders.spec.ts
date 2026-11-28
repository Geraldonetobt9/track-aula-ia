import { buildPurchaseJourneys, purchaseGroupKey, type OrderLine, type SessionLite } from '../journey-orders';

const AD = '120252294773260033';
const EARLIER = '120252000000000001';

function line(partial: Partial<OrderLine> & Pick<OrderLine, 'id' | 'soldAt' | 'amount'>): OrderLine {
  return {
    externalId: partial.id,
    orderExternalId: null,
    isOrderBump: false,
    parentTransaction: null,
    productName: 'Curso',
    customerName: 'Ana',
    customerEmail: 'ana@test.com',
    visitorId: 'v1',
    sessionId: null,
    utmContent: null,
    matchMethod: null,
    ...partial,
  };
}

function session(partial: Partial<SessionLite> & Pick<SessionLite, 'sessionId' | 'startedAt'>): SessionLite {
  return {
    visitorId: 'v1',
    utmSource: 'FB',
    utmCampaign: 'Campanha|120252294773260001',
    utmContent: null,
    adId: null,
    landingPage: 'https://loja.com/oferta',
    deviceType: 'mobile',
    hadCheckoutClick: false,
    ...partial,
  };
}

describe('purchaseGroupKey', () => {
  it('põe o order bump na mesma compra da frente', () => {
    const front = line({ id: 's1', externalId: 'HP1', soldAt: '2026-11-28T11:00:00Z', amount: 30.85 });
    const bump = line({
      id: 's2',
      externalId: 'HP1C2',
      soldAt: '2026-11-28T11:00:00Z',
      amount: 10.93,
      isOrderBump: true,
      parentTransaction: 'HP1',
    });
    expect(purchaseGroupKey(front)).toBe(purchaseGroupKey(bump));
  });
});

describe('buildPurchaseJourneys', () => {
  it('credita só a frente, marca último clique e ajuda, e deixa o checkout na visita', () => {
    const front = line({
      id: 's1',
      externalId: 'HP1',
      soldAt: '2026-11-28T14:00:00.000Z',
      amount: 30.85,
      sessionId: 'sid-2',
      matchMethod: 'sck',
      productName: 'Principal',
    });
    const bump = line({
      id: 's2',
      externalId: 'HP1B',
      soldAt: '2026-11-28T14:00:01.000Z',
      amount: 10.93,
      isOrderBump: true,
      parentTransaction: 'HP1',
      productName: 'Bump',
      sessionId: 'sid-2',
    });
    const sessions = new Map<string, SessionLite[]>([
      [
        'v1',
        [
          session({
            sessionId: 'sid-1',
            startedAt: '2026-11-28T10:00:00.000Z',
            utmContent: `ajuda|${EARLIER}`,
            deviceType: 'desktop',
          }),
          session({
            sessionId: 'sid-2',
            startedAt: '2026-11-28T13:00:00.000Z',
            utmContent: `ad5-para-de-arrumar|${AD}`,
            hadCheckoutClick: true,
            deviceType: 'mobile',
          }),
        ],
      ],
    ]);

    const [journey] = buildPurchaseJourneys([front, bump], sessions);
    expect(journey.amount).toBeCloseTo(30.85);
    expect(journey.items).toBe(2);
    expect(journey.bumps).toEqual([{ productName: 'Bump', amount: 10.93 }]);
    expect(journey.lastClickCreative).toBe(AD);
    expect(journey.matchMethod).toBe('sck');
    expect(journey.hoursToPurchase).toBeCloseTo(4);
    expect(journey.assistKeys).toEqual([EARLIER]);
    expect(journey.creatives).toEqual([EARLIER, AD]);

    const assist = journey.touches[0];
    const last = journey.touches[1];
    expect(assist.role).toBe('assist');
    expect(assist.source).toBe('Facebook Ads');
    expect(assist.deviceType).toBe('desktop');
    expect(assist.hadCheckoutClick).toBe(false);
    expect(last.role).toBe('last_click');
    expect(last.creativeName).toBe('ad5-para-de-arrumar');
    expect(last.campaignName).toBe('Campanha');
    expect(last.hadCheckoutClick).toBe(true);
    expect(last.source).toBe('Facebook Ads');
    expect(journey.touches.some((t) => t.creativeName === 'Clicou no checkout')).toBe(false);
  });
});
