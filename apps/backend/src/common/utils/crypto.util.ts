import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/** Derives a 32-byte key from any secret string. */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** AES-256-GCM encryption for sensitive PII at rest (e.g. tenant ID numbers). Output: iv.tag.cipher (base64). */
export function encryptText(plain: string, secret: string): string {
  if (plain === null || plain === undefined) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptText(payload: string, secret: string): string | null {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Numeric OTP of the given length (cryptographically random). */
export function generateNumericCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += randomInt(0, 10).toString();
  return code;
}
