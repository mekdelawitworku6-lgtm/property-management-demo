import { hashPassword, isStrongPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashPassword + verifyPassword round-trip', async () => {
    const hash = await hashPassword('Secret123');
    expect(hash).not.toBe('Secret123');
    await expect(verifyPassword('Secret123', hash)).resolves.toBe(true);
    await expect(verifyPassword('Wrong123', hash)).resolves.toBe(false);
  });

  it('verifyPassword returns false for empty input', async () => {
    await expect(verifyPassword('', 'x')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });

  it('isStrongPassword requires 8+ chars with letter and digit', () => {
    expect(isStrongPassword('Secret123')).toBe(true);
    expect(isStrongPassword('short1')).toBe(false);
    expect(isStrongPassword('allletters')).toBe(false);
    expect(isStrongPassword('12345678')).toBe(false);
  });
});
