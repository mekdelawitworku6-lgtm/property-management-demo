import { toPublicUser } from './auth-user.util';

describe('toPublicUser', () => {
  it('strips secrets and hides the encrypted ID number', () => {
    const result = toPublicUser({
      id: 'u', passwordHash: 'h', refreshTokenHash: 'r', sessionVersion: 2,
      tenantProfile: { idNumberEncrypted: 'enc', occupation: 'Dev' },
    } as any) as any;
    expect(result).toEqual({ id: 'u', tenantProfile: { occupation: 'Dev', hasIdNumber: true } });
  });

  it('returns null for missing users', () => {
    expect(toPublicUser(null)).toBeNull();
  });
});
