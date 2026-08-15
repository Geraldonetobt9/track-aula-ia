/**
 * Brazilian tax ID (CPF / CNPJ) normalization and checksum validation.
 *
 * These helpers are authoritative on the backend. The frontend has an
 * identical copy used for live feedback; the backend copy is what actually
 * enforces validity at the API boundary.
 */

export type TaxIdType = 'cpf' | 'cnpj';

export function normalizeDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Detect whether a digits-only value looks like a CPF or CNPJ.
 * Returns null for lengths that match neither.
 */
export function detectTaxIdType(digits: string): TaxIdType | null {
  if (digits.length === 11) return 'cpf';
  if (digits.length === 14) return 'cnpj';
  return null;
}

export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = normalizeDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let dv1 = 11 - (sum % 11);
  if (dv1 >= 10) dv1 = 0;
  if (dv1 !== parseInt(cpf[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let dv2 = 11 - (sum % 11);
  if (dv2 >= 10) dv2 = 0;
  return dv2 === parseInt(cpf[10], 10);
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = normalizeDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(cnpj[i], 10) * weights1[i];
  let dv1 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (dv1 !== parseInt(cnpj[12], 10)) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(cnpj[i], 10) * weights2[i];
  let dv2 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return dv2 === parseInt(cnpj[13], 10);
}

export function isValidTaxId(type: TaxIdType, value: string | null | undefined): boolean {
  return type === 'cpf' ? isValidCpf(value) : isValidCnpj(value);
}

/**
 * Map our internal tax_id type to Stripe's tax_id type string.
 */
export function toStripeTaxIdType(type: TaxIdType): 'br_cpf' | 'br_cnpj' {
  return type === 'cpf' ? 'br_cpf' : 'br_cnpj';
}
