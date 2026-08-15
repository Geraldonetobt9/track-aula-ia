import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM para os tokens guardados no banco (Meta e checkouts).
 *
 * GCM e não CBC porque ele autentica: se alguém alterar o ciphertext no banco,
 * o decrypt falha em vez de devolver lixo silenciosamente.
 *
 * Formato guardado: iv:authTag:ciphertext, tudo em base64. O IV é aleatório a
 * cada chamada — reusar IV em GCM quebra a cifra por completo.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, o tamanho recomendado para GCM
const KEY_BYTES = 32;

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY não configurada');

  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY deve ter ${KEY_BYTES} bytes em hex (${KEY_BYTES * 2} caracteres)`);
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Formato de token cifrado inválido');

  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Mostra só o fim do token, para a tela confirmar qual está salvo. */
export function maskToken(token: string): string {
  if (token.length <= 8) return '••••';
  return `••••${token.slice(-6)}`;
}
