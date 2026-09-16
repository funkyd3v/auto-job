import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getConfig } from '../../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    // ENCRYPTION_KEY is validated as min 32 chars in env schema — 32 bytes == AES-256.
    cachedKey = Buffer.from(getConfig().ENCRYPTION_KEY, 'utf8');
  }
  return cachedKey;
}

/**
 * Encrypt a secret at rest (AES-256-GCM).
 * Output format: base64(iv).base64(authTag).base64(ciphertext)
 */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

/** Decrypt a value produced by encryptSecret. Throws if tampered (auth tag mismatch). */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function isEncryptedPayload(payload: string): boolean {
  return payload.split('.').length === 3;
}