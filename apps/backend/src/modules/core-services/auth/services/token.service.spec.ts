import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPrismaMock, mockConfig, IDS } from '../../../../test-utils/mocks';
import { sha256 } from '../../../../common/utils/crypto.util';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const prisma = createPrismaMock();
  const config = mockConfig({ JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });
  const jwt = new JwtService({});
  const service = new TokenService(jwt, config, prisma);
  const user = { id: IDS.owner, role: 'OWNER' as const, sessionVersion: 0 };

  beforeEach(() => jest.clearAllMocks());

  it('issueTokens signs access + refresh and stores the refresh hash', async () => {
    const tokens = await service.issueTokens(user);
    expect(tokens.tokenType).toBe('Bearer');
    const access = jwt.decode(tokens.accessToken) as any;
    expect(access).toMatchObject({ sub: IDS.owner, role: 'OWNER', sv: 0, type: 'access' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: IDS.owner }, data: { refreshTokenHash: sha256(tokens.refreshToken) } });
  });

  it('verifyRefreshToken accepts the stored token and rejects others', async () => {
    const { refreshToken, accessToken } = await service.issueTokens(user);
    prisma.user.findUnique.mockResolvedValue({ ...user, isSuspended: false, refreshTokenHash: sha256(refreshToken) });
    await expect(service.verifyRefreshToken(refreshToken)).resolves.toMatchObject({ id: IDS.owner });
    await expect(service.verifyRefreshToken('garbage')).rejects.toThrow('Invalid or expired refresh token');
    await expect(service.verifyRefreshToken(accessToken)).rejects.toThrow(UnauthorizedException);
    prisma.user.findUnique.mockResolvedValue({ ...user, isSuspended: false, refreshTokenHash: 'other' });
    await expect(service.verifyRefreshToken(refreshToken)).rejects.toThrow('Refresh token revoked');
  });

  it('revokeAll bumps the session version and clears the refresh hash', async () => {
    await service.revokeAll(IDS.owner);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: IDS.owner },
      data: { sessionVersion: { increment: 1 }, refreshTokenHash: null },
    });
  });
});
