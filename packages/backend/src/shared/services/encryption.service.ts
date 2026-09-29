import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  /**
   * ENCRYPTION_KEY é opcional: sem ela, a chave sai da service role do
   * Supabase — uma variável a menos para quem implanta gerar. Continua fora
   * do banco, então um vazamento do banco sozinho não abre os tokens.
   *
   * O custo: trocar a service role (ou definir ENCRYPTION_KEY depois) deixa
   * ilegíveis os tokens já salvos, e eles precisam ser colados de novo em
   * Integrações. Quem quer girar a service role sem esse efeito define
   * ENCRYPTION_KEY desde o início.
   */
  constructor(private config: ConfigService) {
    const encKey =
      this.config.get<string>('ENCRYPTION_KEY') ||
      this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.key = createHash('sha256').update(encKey).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${Buffer.concat([encrypted, tag]).toString('base64')}`;
  }

  decrypt(stored: string): string {
    const [ivB64, ctB64] = stored.split(':');
    if (!ivB64 || !ctB64) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(ivB64, 'base64');
    const combined = Buffer.from(ctB64, 'base64');
    const tag = combined.subarray(combined.length - 16);
    const encrypted = combined.subarray(0, combined.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  isEncrypted(value: string): boolean {
    if (!value || !value.includes(':')) return false;
    const parts = value.split(':');
    if (parts.length !== 2) return false;
    try {
      Buffer.from(parts[0], 'base64');
      Buffer.from(parts[1], 'base64');
      return parts[0].length >= 16;
    } catch {
      return false;
    }
  }

  decryptIfNeeded(value: string): string {
    if (this.isEncrypted(value)) return this.decrypt(value);
    return value;
  }
}
