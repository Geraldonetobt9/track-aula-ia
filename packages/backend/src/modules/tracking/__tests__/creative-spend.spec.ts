import { creativeKey, finalizeCreatives, type CreativeAccum } from '../creative-spend';

const AD = '120252294773260033';

function sale(key: string, revenue: number, assisted = 0): CreativeAccum {
  return {
    key,
    name: key,
    campaignName: null,
    lastClickSales: 1,
    lastClickRevenue: revenue,
    assistedSales: assisted ? 1 : 0,
    assistedRevenue: assisted,
    metaPurchases: 0,
    impressions: 0,
    spend: 0,
  };
}

describe('creativeKey', () => {
  it('usa o id no fim de utm_content nome|id', () => {
    expect(creativeKey({ ad_id: null, utm_content: `ad5-para-de-arrumar|${AD}` })).toBe(AD);
  });

  it('mantém o nome quando o rastreio antigo não traz o id', () => {
    expect(
      creativeKey({ ad_id: null, utm_content: 'EXP-BR-009 | BR-SACOLA-01-V12-CAIXINHA2' }),
    ).toBe('EXP-BR-009 | BR-SACOLA-01-V12-CAIXINHA2');
  });
});

describe('finalizeCreatives', () => {
  const catalog = [
    { facebookAdId: AD, name: 'ad5-para-de-arrumar', campaignName: 'Campanha fria' },
    { facebookAdId: '120252031850860033', name: 'EXP-BR-009 | BR-SACOLA-01-V12-CAIXINHA2', campaignName: 'Escala' },
  ];

  it('soma o gasto do dia no mesmo anúncio que a venda, pelo id', () => {
    const rows = finalizeCreatives(
      [sale(AD, 10.93)],
      [{ facebookAdId: AD, spend: 40, conversions: 1, impressions: 1000 }, { facebookAdId: AD, spend: 49.6, conversions: 0, impressions: 500 }],
      catalog,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(AD);
    expect(rows[0].name).toBe('ad5-para-de-arrumar');
    expect(rows[0].campaignName).toBe('Campanha fria');
    expect(rows[0].spend).toBeCloseTo(89.6);
    expect(rows[0].impressions).toBe(1500);
    expect(rows[0].lastClickRevenue).toBeCloseTo(10.93);
    expect(rows[0].metaPurchases).toBe(1);
  });

  it('não duplica quando a venda está no nome e o gasto no id', () => {
    const rows = finalizeCreatives(
      [sale('ad5-para-de-arrumar', 10.93)],
      [{ facebookAdId: AD, spend: 89.6, conversions: 2, impressions: 800 }],
      catalog,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(AD);
    expect(rows[0].name).toBe('ad5-para-de-arrumar');
    expect(rows[0].spend).toBeCloseTo(89.6);
    expect(rows[0].lastClickSales).toBe(1);
  });

  it('junta duas chaves cruas do mesmo anúncio', () => {
    const rows = finalizeCreatives(
      [sale(AD, 10), sale('ad5-para-de-arrumar', 5, 3)],
      [{ facebookAdId: AD, spend: 20, conversions: 0, impressions: 10 }],
      catalog,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastClickSales).toBe(2);
    expect(rows[0].lastClickRevenue).toBe(15);
    expect(rows[0].assistedRevenue).toBe(3);
    expect(rows[0].spend).toBe(20);
  });

  it('não funde nomes repetidos em anúncios diferentes', () => {
    const ads = [
      { facebookAdId: '1111111111', name: 'Criativo A', campaignName: null },
      { facebookAdId: '2222222222', name: 'Criativo A', campaignName: null },
    ];
    const rows = finalizeCreatives(
      [sale('Criativo A', 10)],
      [
        { facebookAdId: '1111111111', spend: 4, conversions: 0, impressions: 1 },
        { facebookAdId: '2222222222', spend: 6, conversions: 0, impressions: 1 },
      ],
      ads,
    );
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual(['2222222222', 'Criativo A', '1111111111'].sort());
    expect(rows.find((r) => r.key === '1111111111')?.spend).toBe(4);
    expect(rows.find((r) => r.key === 'Criativo A')?.lastClickRevenue).toBe(10);
  });

  it('mantém o criativo antigo pelo nome quando não há id correspondente', () => {
    const rows = finalizeCreatives(
      [sale('EXP-BR-009 | BR-SACOLA-01-V12-CAIXINHA2', 90)],
      [],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('EXP-BR-009 | BR-SACOLA-01-V12-CAIXINHA2');
    expect(rows[0].spend).toBe(0);
  });
});
