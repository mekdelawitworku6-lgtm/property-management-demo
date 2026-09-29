import { generateKeyPairSync } from 'crypto';
import { TelebirrCrypto } from './telebirr-crypto';

describe('TelebirrCrypto', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const crypto = new TelebirrCrypto(privateKey, publicKey);

  it('isConfigured reflects both keys', () => {
    expect(crypto.isConfigured).toBe(true);
    expect(new TelebirrCrypto().isConfigured).toBe(false);
  });

  it('buildBizContent drops empty fields and keeps order', () => {
    expect(crypto.buildBizContent({ a: 1, b: undefined, c: '', d: 'x' })).toBe('{"a":"1","d":"x"}');
  });

  it('signPayload + verifySignature round-trip', () => {
    const sig = crypto.signPayload('payload');
    expect(crypto.verifySignature('payload', sig)).toBe(true);
    expect(crypto.verifySignature('tampered', sig)).toBe(false);
    expect(crypto.verifySignature('payload', 'bad')).toBe(false);
  });

  it('throws without keys', () => {
    const empty = new TelebirrCrypto();
    expect(() => empty.signPayload('x')).toThrow('TELEBIRR_PRIVATE_KEY');
    expect(() => empty.verifySignature('x', 'y')).toThrow('TELEBIRR_PUBLIC_KEY');
  });
});
