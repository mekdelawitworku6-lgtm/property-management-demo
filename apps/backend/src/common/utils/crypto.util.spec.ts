import { decryptText, encryptText, generateNumericCode, hmacSha256, safeEqual, sha256 } from './crypto.util';

describe('crypto.util', () => {
  const secret = 'test-secret-key';

  it('encryptText / decryptText round-trip with random IV', () => {
    const a = encryptText('ID-12345', secret);
    const b = encryptText('ID-12345', secret);
    expect(a).not.toBe(b);
    expect(decryptText(a, secret)).toBe('ID-12345');
  });

  it('encryptText returns null for null input', () => {
    expect(encryptText(null, secret)).toBeNull();
  });

  it('decryptText returns null for wrong key, bad payload or empty', () => {
    expect(decryptText(encryptText('x', secret), 'other-key')).toBeNull();
    expect(decryptText('garbage', secret)).toBeNull();
    expect(decryptText(null, secret)).toBeNull();
  });

  it('sha256 and hmacSha256 are deterministic hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmacSha256('abc', 'k')).toHaveLength(64);
    expect(hmacSha256('abc', 'k')).toBe(hmacSha256('abc', 'k'));
  });

  it('safeEqual compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(undefined as any, 'a')).toBe(false);
  });

  it('generateNumericCode produces digits of the requested length', () => {
    expect(generateNumericCode(6)).toMatch(/^\d{6}$/);
    expect(generateNumericCode(4)).toMatch(/^\d{4}$/);
  });
});
