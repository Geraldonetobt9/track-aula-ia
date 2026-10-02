import { redactSecrets } from '../webhook-context';

describe('redactSecrets', () => {
  it('apaga o que autentica, em qualquer nivel, sem mexer no original', () => {
    const body = { hottok: 'abc', data: { buyer: { email: 'a@b.com' }, auth: { api_key: 'k', Token: 't' } }, list: [{ secret: 's' }] };
    expect(redactSecrets(body)).toEqual({
      hottok: '[removido]',
      data: { buyer: { email: 'a@b.com' }, auth: { api_key: '[removido]', Token: '[removido]' } },
      list: [{ secret: '[removido]' }],
    });
    expect(body.hottok).toBe('abc');
  });
});
