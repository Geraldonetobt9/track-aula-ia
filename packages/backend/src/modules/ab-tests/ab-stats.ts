/**
 * A estatística do teste A/B, em funções puras.
 *
 * Duas perguntas por variante, sempre contra o controle (A):
 *   - p-valor: a diferença pode ser acaso? Teste z de duas proporções
 *     (conversão) ou de duas médias com variâncias separadas — Welch com
 *     aproximação normal (receita por visitante). Bilateral.
 *   - chance de superar o controle: posterior Beta(1+c, 1+n-c) de cada
 *     lado, aproximado pela normal. É o número que se lê sem estatística.
 *
 * Com mais de uma variante desafiante, o nível de significância é dividido
 * pelo número de comparações (Bonferroni): três desafiantes a 5% cada dariam
 * ~14% de chance de um falso vencedor.
 */

export const ALPHA = 0.05;
/** Abaixo disso por variante, qualquer p-valor é ruído: o teste ainda coleta. */
export const MIN_VISITORS_PER_VARIANT = 100;
/** Idem para eventos do objetivo (compras, cliques) somando as duas variantes. */
export const MIN_CONVERSIONS = 10;

const Z_ALPHA_2 = 1.959964; // bilateral, 5%
const Z_POWER = 0.841621; // poder de 80%

/** Função de distribuição da normal padrão (Abramowitz–Stegun 7.1.26, erro < 1,5e-7). */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface Comparison {
  /** Variação relativa contra o controle, em %. null quando o controle é zero. */
  lift: number | null;
  /** Bilateral. null quando não há dado para calcular. */
  pValue: number | null;
  /** 0 a 1. */
  chanceToBeat: number | null;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function relativeLift(control: number, variant: number): number | null {
  return control > 0 ? round(((variant - control) / control) * 100, 1) : null;
}

/** Conversão: c de n visitantes, controle (a) contra variante (b). */
export function compareProportions(ca: number, na: number, cb: number, nb: number): Comparison {
  if (na <= 0 || nb <= 0) return { lift: null, pValue: null, chanceToBeat: null };
  const pa = ca / na;
  const pb = cb / nb;

  const pooled = (ca + cb) / (na + nb);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb));
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(pb - pa) / se)) : null;

  const ma = (ca + 1) / (na + 2);
  const mb = (cb + 1) / (nb + 2);
  const va = (ma * (1 - ma)) / (na + 3);
  const vb = (mb * (1 - mb)) / (nb + 3);
  const chanceToBeat = normalCdf((mb - ma) / Math.sqrt(va + vb));

  return {
    lift: relativeLift(pa, pb),
    pValue: pValue === null ? null : round(pValue, 4),
    chanceToBeat: round(chanceToBeat, 4),
  };
}

export interface MeanSample {
  n: number;
  sum: number;
  /** Soma dos quadrados dos valores por visitante. */
  sumSq: number;
}

function variance(s: MeanSample): number {
  if (s.n < 2) return 0;
  return Math.max(0, (s.sumSq - (s.sum * s.sum) / s.n) / (s.n - 1));
}

/** Receita por visitante: médias com variâncias separadas. */
export function compareMeans(a: MeanSample, b: MeanSample): Comparison {
  if (a.n <= 0 || b.n <= 0) return { lift: null, pValue: null, chanceToBeat: null };
  const meanA = a.sum / a.n;
  const meanB = b.sum / b.n;
  const se = Math.sqrt(variance(a) / a.n + variance(b) / b.n);
  if (!(se > 0)) {
    return { lift: relativeLift(meanA, meanB), pValue: null, chanceToBeat: null };
  }
  const z = (meanB - meanA) / se;
  return {
    lift: relativeLift(meanA, meanB),
    pValue: round(2 * (1 - normalCdf(Math.abs(z))), 4),
    chanceToBeat: round(normalCdf(z), 4),
  };
}

/**
 * Visitantes por variante para detectar uma melhora relativa `mde` (0,2 =
 * +20%) sobre a conversão `baseline`, com 5% de significância e 80% de poder.
 * null quando não há base para calcular.
 */
export function sampleSizePerVariant(baseline: number, mde = 0.2, alpha = ALPHA): number | null {
  if (!(baseline > 0) || baseline >= 1 || !(mde > 0)) return null;
  const p1 = baseline;
  const p2 = Math.min(0.9999, baseline * (1 + mde));
  const zAlpha = alpha === ALPHA ? Z_ALPHA_2 : inverseNormal(1 - alpha / 2);
  const n = ((zAlpha + Z_POWER) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (p2 - p1) ** 2;
  return Math.ceil(n);
}

/** Inversa da normal (Acklam), para o z do nível corrigido por Bonferroni. */
export function inverseNormal(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
