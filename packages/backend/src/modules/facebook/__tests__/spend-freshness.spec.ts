import { clampSpendRange, spendRangeIsFresh } from '../spend-freshness';

describe('clampSpendRange', () => {
  it('mantém um período curto', () => {
    expect(clampSpendRange('2026-11-01', '2026-11-28')).toEqual({
      since: '2026-11-01',
      until: '2026-11-28',
    });
  });

  it('corta o histórico longo e fica nos dias recentes', () => {
    expect(clampSpendRange('2015-01-01', '2026-11-28', 92)).toEqual({
      since: '2026-08-29',
      until: '2026-11-28',
    });
  });
});

describe('spendRangeIsFresh', () => {
  it('considera coberto quando as pontas do período foram atualizadas', () => {
    expect(
      spendRangeIsFresh({
        since: '2026-11-22',
        until: '2026-11-28',
        oldestFreshDate: '2026-11-22',
        newestFreshDate: '2026-11-28',
      }),
    ).toBe(true);
  });

  it('não cobre um período maior do que o que acabou de ser gravado', () => {
    expect(
      spendRangeIsFresh({
        since: '2026-11-22',
        until: '2026-11-28',
        oldestFreshDate: '2026-11-28',
        newestFreshDate: '2026-11-28',
      }),
    ).toBe(false);
  });
});
