import {
  compareMeans,
  compareProportions,
  inverseNormal,
  normalCdf,
  sampleSizePerVariant,
} from '../ab-stats';

describe('normalCdf / inverseNormal', () => {
  it('bate com a tabela da normal', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 4);
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(-Infinity)).toBe(0);
  });

  it('inversa devolve o z de volta', () => {
    for (const p of [0.01, 0.025, 0.5, 0.9, 0.9875]) {
      expect(normalCdf(inverseNormal(p))).toBeCloseTo(p, 5);
    }
  });
});

describe('compareProportions', () => {
  it('10% contra 13% com 1000 visitantes cada: p ≈ 0,035', () => {
    const r = compareProportions(100, 1000, 130, 1000);
    expect(r.lift).toBe(30);
    expect(r.pValue).toBeCloseTo(0.0355, 3);
    expect(r.chanceToBeat).toBeGreaterThan(0.97);
  });

  it('mesma taxa: p = 1 e chance de 50%', () => {
    const r = compareProportions(50, 1000, 50, 1000);
    expect(r.lift).toBe(0);
    expect(r.pValue).toBeCloseTo(1, 4);
    expect(r.chanceToBeat).toBeCloseTo(0.5, 2);
  });

  it('variante pior: chance de superar o controle abaixo de 50%', () => {
    expect(compareProportions(130, 1000, 100, 1000).chanceToBeat).toBeLessThan(0.05);
  });

  it('sem visitantes ou sem nenhuma conversão, nada a dizer sobre o p-valor', () => {
    expect(compareProportions(0, 0, 5, 100)).toEqual({ lift: null, pValue: null, chanceToBeat: null });
    const zero = compareProportions(0, 500, 0, 500);
    expect(zero.pValue).toBeNull();
    expect(zero.lift).toBeNull(); // controle em 0%: variação relativa não existe
  });
});

describe('compareMeans', () => {
  /** Amostra a partir da lista de receita por visitante. */
  const sample = (values: number[]) => ({
    n: values.length,
    sum: values.reduce((s, v) => s + v, 0),
    sumSq: values.reduce((s, v) => s + v * v, 0),
  });

  it('receita por visitante maior com muita amostra é significativa', () => {
    // 1000 visitantes cada; 10% compram R$ 100 no A, 15% no B.
    const a = sample([...Array(100).fill(100), ...Array(900).fill(0)]);
    const b = sample([...Array(150).fill(100), ...Array(850).fill(0)]);
    const r = compareMeans(a, b);
    expect(r.lift).toBe(50);
    expect(r.pValue!).toBeLessThan(0.01);
    expect(r.chanceToBeat!).toBeGreaterThan(0.99);
  });

  it('sem variância, não inventa p-valor', () => {
    const r = compareMeans(sample([0, 0, 0]), sample([0, 0, 0]));
    expect(r.pValue).toBeNull();
  });
});

describe('sampleSizePerVariant', () => {
  it('10% de conversão, detectar +20%: perto de 3.840 por variante', () => {
    const n = sampleSizePerVariant(0.1, 0.2)!;
    expect(n).toBeGreaterThan(3800);
    expect(n).toBeLessThan(3900);
  });

  it('nível mais rígido (Bonferroni) pede mais amostra', () => {
    expect(sampleSizePerVariant(0.1, 0.2, 0.025)!).toBeGreaterThan(sampleSizePerVariant(0.1, 0.2)!);
  });

  it('sem base, sem estimativa', () => {
    expect(sampleSizePerVariant(0)).toBeNull();
    expect(sampleSizePerVariant(1)).toBeNull();
  });
});
