import { normalizePageUrl, pageKey } from '../ab-url';

describe('normalizePageUrl', () => {
  it('a chave ignora www, barra final, query e fragmento', () => {
    const keys = [
      'https://www.loja.com.br/oferta',
      'https://loja.com.br/oferta/',
      'https://LOJA.com.br/oferta?utm_source=fb#topo',
      'loja.com.br/oferta',
    ].map((u) => normalizePageUrl(u)!.key);
    expect(new Set(keys)).toEqual(new Set(['loja.com.br/oferta']));
  });

  it('o caminho diferencia maiúsculas, como o navegador', () => {
    expect(normalizePageUrl('https://loja.com/Oferta')!.key).toBe('loja.com/Oferta');
  });

  it('página raiz vira só o host', () => {
    expect(normalizePageUrl('https://www.loja.com/')!.key).toBe('loja.com');
  });

  it('guarda a URL sem o fragmento, com a query', () => {
    expect(normalizePageUrl('https://loja.com/b?v=2#x')!.url).toBe('https://loja.com/b?v=2');
  });

  it('recusa o que não é página http', () => {
    expect(normalizePageUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePageUrl('ftp://loja.com/a')).toBeNull();
    expect(normalizePageUrl('localhost')).toBeNull();
    expect(normalizePageUrl('')).toBeNull();
    expect(normalizePageUrl(null)).toBeNull();
  });

  it('pageKey é a mesma conta do tracker.js com location.hostname/pathname', () => {
    expect(pageKey('www.loja.com.br', '/oferta/')).toBe('loja.com.br/oferta');
    expect(pageKey('loja.com.br', '/')).toBe('loja.com.br');
  });
});
