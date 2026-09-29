import { EncryptionService } from '../encryption.service';

function service(env: Record<string, string | undefined>) {
  const config = {
    get: (k: string) => env[k],
    getOrThrow: (k: string) => {
      if (!env[k]) throw new Error(`Config ${k} ausente`);
      return env[k];
    },
  };
  return new EncryptionService(config as any);
}

describe('EncryptionService', () => {
  it('sem ENCRYPTION_KEY, usa a service role e cifra/decifra normalmente', () => {
    const svc = service({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-xyz' });
    const cifrado = svc.encrypt('EAAB-token-do-meta');
    expect(cifrado).not.toContain('EAAB');
    expect(svc.decrypt(cifrado)).toBe('EAAB-token-do-meta');
  });

  it('com ENCRYPTION_KEY, ela vence — e o texto cifrado com uma nao abre com a outra', () => {
    const comChave = service({ ENCRYPTION_KEY: 'a'.repeat(64), SUPABASE_SERVICE_ROLE_KEY: 'service-role-xyz' });
    const semChave = service({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-xyz' });
    const cifrado = comChave.encrypt('segredo');
    expect(comChave.decrypt(cifrado)).toBe('segredo');
    expect(() => semChave.decrypt(cifrado)).toThrow();
  });

  it('sem nenhuma das duas, recusa subir', () => {
    expect(() => service({})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
