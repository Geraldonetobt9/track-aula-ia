import {
  normalizeDigits,
  detectTaxIdType,
  isValidCpf,
  isValidCnpj,
  isValidTaxId,
  toStripeTaxIdType,
} from '../tax-id';

describe('tax-id helpers', () => {
  describe('normalizeDigits', () => {
    it('strips non-digits', () => {
      expect(normalizeDigits('123.456.789-00')).toBe('12345678900');
      expect(normalizeDigits('12.345.678/0001-95')).toBe('12345678000195');
      expect(normalizeDigits(null)).toBe('');
      expect(normalizeDigits(undefined)).toBe('');
      expect(normalizeDigits('')).toBe('');
    });
  });

  describe('detectTaxIdType', () => {
    it('returns cpf for 11 digits', () => {
      expect(detectTaxIdType('52998224725')).toBe('cpf');
    });
    it('returns cnpj for 14 digits', () => {
      expect(detectTaxIdType('11222333000181')).toBe('cnpj');
    });
    it('returns null for other lengths', () => {
      expect(detectTaxIdType('')).toBeNull();
      expect(detectTaxIdType('123')).toBeNull();
      expect(detectTaxIdType('12345678901234567')).toBeNull();
    });
  });

  describe('isValidCpf', () => {
    it('accepts valid CPFs (formatted and raw)', () => {
      expect(isValidCpf('529.982.247-25')).toBe(true);
      expect(isValidCpf('52998224725')).toBe(true);
      expect(isValidCpf('123.456.789-09')).toBe(true);
    });

    it('rejects wrong check digits', () => {
      expect(isValidCpf('52998224700')).toBe(false);
      expect(isValidCpf('123.456.789-00')).toBe(false);
    });

    it('rejects all-same-digit patterns', () => {
      expect(isValidCpf('11111111111')).toBe(false);
      expect(isValidCpf('00000000000')).toBe(false);
    });

    it('rejects wrong length', () => {
      expect(isValidCpf('123')).toBe(false);
      expect(isValidCpf('12345678901234')).toBe(false);
    });

    it('rejects null/undefined/empty', () => {
      expect(isValidCpf(null)).toBe(false);
      expect(isValidCpf(undefined)).toBe(false);
      expect(isValidCpf('')).toBe(false);
    });
  });

  describe('isValidCnpj', () => {
    it('accepts valid CNPJs (formatted and raw)', () => {
      expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
      expect(isValidCnpj('11222333000181')).toBe(true);
    });

    it('rejects wrong check digits', () => {
      expect(isValidCnpj('11.222.333/0001-99')).toBe(false);
    });

    it('rejects all-same-digit patterns', () => {
      expect(isValidCnpj('11111111111111')).toBe(false);
    });

    it('rejects wrong length', () => {
      expect(isValidCnpj('123')).toBe(false);
      expect(isValidCnpj('52998224725')).toBe(false);
    });
  });

  describe('isValidTaxId dispatch', () => {
    it('dispatches to CPF validator', () => {
      expect(isValidTaxId('cpf', '529.982.247-25')).toBe(true);
      expect(isValidTaxId('cpf', '11222333000181')).toBe(false);
    });
    it('dispatches to CNPJ validator', () => {
      expect(isValidTaxId('cnpj', '11.222.333/0001-81')).toBe(true);
      expect(isValidTaxId('cnpj', '52998224725')).toBe(false);
    });
  });

  describe('toStripeTaxIdType', () => {
    it('maps cpf -> br_cpf', () => {
      expect(toStripeTaxIdType('cpf')).toBe('br_cpf');
    });
    it('maps cnpj -> br_cnpj', () => {
      expect(toStripeTaxIdType('cnpj')).toBe('br_cnpj');
    });
  });
});
