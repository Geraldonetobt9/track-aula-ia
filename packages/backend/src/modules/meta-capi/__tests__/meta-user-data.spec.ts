import {
  buildUserData,
  explainUserData,
  normalizeCountry,
  normalizeEmail,
  normalizePhone,
  normalizeState,
  sha256,
  splitName,
} from '../meta-user-data';

describe('normalizacao para a CAPI', () => {
  it('e-mail minusculo e sem espaco', () => {
    expect(normalizeEmail('  Maria.Silva@Gmail.COM ')).toBe('maria.silva@gmail.com');
    expect(normalizeEmail('sem-arroba')).toBeNull();
  });

  it('telefone brasileiro ganha o 55', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('011987654321')).toBe('5511987654321');
    expect(normalizePhone('+55 11 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('')).toBeNull();
  });

  it('nome vira primeiro nome e sobrenome', () => {
    expect(splitName('José da Silva Júnior')).toEqual({ fn: 'josé', ln: 'júnior' });
    expect(splitName('Ana')).toEqual({ fn: 'ana', ln: null });
    expect(splitName(null)).toEqual({ fn: null, ln: null });
  });

  it('cidade sem acento e sem espaco, estado em sigla, pais em duas letras', () => {
    expect(normalizeState('SP')).toBe('sp');
    expect(normalizeState('São Paulo')).toBeNull(); // nome por extenso nao casa
    expect(normalizeCountry('BRA')).toBe('br');
    expect(normalizeCountry('BR')).toBe('br');
  });

  it('monta o user_data: pessoais em hash, IP/UA/fbp/fbc em claro', () => {
    const ud = buildUserData({
      email: 'Maria@Gmail.com',
      phone: '11987654321',
      fullName: 'Maria Silva',
      state: 'SP',
      country: 'BR',
      zip: '01310-100',
      externalId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ip: '2804:14c::1',
      userAgent: 'Mozilla/5.0',
      fbp: 'fb.1.1711800000000.1234567890',
      fbc: 'fb.1.1711800000000.IwAR0abc',
    });

    expect(ud.em).toEqual([sha256('maria@gmail.com')]);
    expect(ud.ph).toEqual([sha256('5511987654321')]);
    expect(ud.fn).toEqual([sha256('maria')]);
    expect(ud.ln).toEqual([sha256('silva')]);
    expect(ud.ct).toBeUndefined(); // cidade não vai
    expect(ud.st).toEqual([sha256('sp')]);
    expect(ud.zp).toEqual([sha256('01310100')]);
    expect(ud.country).toEqual([sha256('br')]);
    expect(ud.external_id).toEqual([sha256('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')]);
    expect(ud.client_ip_address).toBe('2804:14c::1');
    expect(ud.client_user_agent).toBe('Mozilla/5.0');
    expect(ud.fbp).toBe('fb.1.1711800000000.1234567890');
    expect(ud.fbc).toBe('fb.1.1711800000000.IwAR0abc');
  });

  it('campo vazio nao vai', () => {
    expect(buildUserData({ email: null, ip: null })).toEqual({});
  });

  it('explica cada campo: original, normalizado, o que saiu e se o hash confere', () => {
    const input = { email: 'Maria@Gmail.com', fullName: 'Maria Silva', ip: '200.1.2.3' };
    const sent = buildUserData(input);
    const rows = explainUserData(input, sent);
    const em = rows.find((r) => r.key === 'em')!;
    expect(em).toMatchObject({ original: 'Maria@Gmail.com', normalized: 'maria@gmail.com', sent: sha256('maria@gmail.com'), hashed: true, matches: true });
    expect(rows.find((r) => r.key === 'ln')).toMatchObject({ original: 'Maria Silva', normalized: 'silva', matches: true });
    expect(rows.find((r) => r.key === 'client_ip_address')).toMatchObject({ original: '200.1.2.3', sent: '200.1.2.3', hashed: false, matches: true });
  });

  it('explica sem conferir quando o dado mudou desde o envio', () => {
    const sent = buildUserData({ email: 'antigo@gmail.com' });
    const [em] = explainUserData({ email: 'novo@gmail.com' }, sent);
    expect(em.matches).toBe(false);
    expect(em.original).toBe('novo@gmail.com');
  });
});
