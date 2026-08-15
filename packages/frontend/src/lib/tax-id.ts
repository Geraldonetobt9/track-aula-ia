/**
 * Frontend tax ID helpers (CPF / CNPJ). Mirror of backend validators
 * in packages/backend/src/shared/helpers/tax-id.ts plus visual formatters.
 * The backend is authoritative — these are for live UX feedback.
 */

export type TaxIdType = 'cpf' | 'cnpj';

export function stripDigits(value: string): string {
  return value.replace(/\D/g, '');
}

// ---- Formatters (apply visual mask while user types) -----------------------

export function formatCpf(value: string): string {
  const d = stripDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCnpj(value: string): string {
  const d = stripDigits(value).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatTaxId(type: TaxIdType, value: string): string {
  return type === 'cpf' ? formatCpf(value) : formatCnpj(value);
}

// ---- Checksum validators (match backend exactly) ---------------------------

export function isValidCpf(value: string): boolean {
  const cpf = stripDigits(value);
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

export function isValidCnpj(value: string): boolean {
  const cnpj = stripDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(cnpj[i], 10) * w1[i];
  const dv1 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (dv1 !== parseInt(cnpj[12], 10)) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(cnpj[i], 10) * w2[i];
  const dv2 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return dv2 === parseInt(cnpj[13], 10);
}

export function isValidTaxId(type: TaxIdType, value: string): boolean {
  return type === 'cpf' ? isValidCpf(value) : isValidCnpj(value);
}
