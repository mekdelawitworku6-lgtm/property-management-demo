import { UnauthorizedException } from '@nestjs/common';
import { createPrismaMock, mockConfig, IDS } from '../../test-utils/mocks';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const prisma = createPrismaMock();
  const strategy = new JwtStrategy(mockConfig({ JWT_SECRET: 'x'.repeat(32) }), prisma as any);
  const payload = { sub: IDS.owner, role: 'OWNER', sv: 0, type: 'access' as const };
  const user = {
    id: IDS.owner, role: 'OWNER', fullName: 'Owner', phoneNumber: '+251911000003', language: 'EN',
    employerId: null, approvalStatus: 'APPROVED', isSuspended: false, sessionVersion: 0,
  };

  it('returns the AuthUser for a valid access token', async () => {
    prisma.user.findUnique.mockResolvedValue(user as any);
    await expect(strategy.validate({ ip: '1.1.1.1' }, payload)).resolves.toMatchObject({ id: IDS.owner, role: 'OWNER', ip: '1.1.1.1' });
  });

  it('rejects refresh tokens, missing, suspended users and stale sessions', async () => {
    await expect(strategy.validate({}, { ...payload, type: 'refresh' })).rejects.toThrow(UnauthorizedException);
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(strategy.validate({}, payload)).rejects.toThrow('User not found');
    prisma.user.findUnique.mockResolvedValueOnce({ ...user, isSuspended: true, suspendedReason: 'Fraud' } as any);
    await expect(strategy.validate({}, payload)).rejects.toThrow('Fraud');
    prisma.user.findUnique.mockResolvedValueOnce({ ...user, sessionVersion: 3 } as any);
    await expect(strategy.validate({}, payload)).rejects.toThrow('Session invalidated');
  });
});
