import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockConfig, USERS, IDS } from '../../../../test-utils/mocks';
import { hashPassword } from '../../../../common/utils/password.util';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const prisma = createPrismaMock();
  const tokens = { issueTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }), verifyRefreshToken: jest.fn(), revokeAll: jest.fn() };
  const otp = { issue: jest.fn().mockResolvedValue({}), verify: jest.fn().mockResolvedValue(undefined) };
  const audit = mockAudit();
  const service = new AuthService(prisma, tokens as any, otp as any, audit as any, mockConfig({ OWNER_AUTO_APPROVE: 'false', TENANT_AUTO_APPROVE: 'true' }));
  let passwordHash: string;

  beforeAll(async () => (passwordHash = await hashPassword('Secret123')));
  beforeEach(() => jest.clearAllMocks());

  it('requirePhone normalizes or throws', () => {
    expect(service.requirePhone('0911223344')).toBe('+251911223344');
    expect(() => service.requirePhone('123')).toThrow(BadRequestException);
  });

  it('initialApprovalStatus: owners pending, tenants approved by default', () => {
    expect(service.initialApprovalStatus('OWNER')).toBe('PENDING');
    expect(service.initialApprovalStatus('TENANT')).toBe('APPROVED');
  });

  describe('register', () => {
    const dto = { role: 'OWNER' as const, fullName: ' Abebe ', phoneNumber: '0911223344', email: 'A@B.et', password: 'Secret123', companyName: 'Co' };

    it('creates the user with profile, audits, sends OTP and returns tokens without secrets', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u1', role: 'OWNER', language: 'EN', passwordHash: 'h', refreshTokenHash: 'r', sessionVersion: 0 });
      const result = await service.register(dto);
      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ role: 'OWNER', fullName: 'Abebe', phoneNumber: '+251911223344', email: 'a@b.et', approvalStatus: 'PENDING', ownerProfile: { create: { companyName: 'Co' } } });
      expect(data.passwordHash).not.toBe('Secret123');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
      expect(otp.issue).toHaveBeenCalledWith('+251911223344', 'VERIFY_PHONE', 'EN');
      expect(audit.log).toHaveBeenCalledWith('USER_REGISTERED', 'User', 'u1', expect.anything(), { role: 'OWNER' });
    });

    it('creates a tenant profile for tenants', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u2', role: 'TENANT', language: 'EN' });
      await service.register({ ...dto, role: 'TENANT' });
      expect(prisma.user.create.mock.calls[0][0].data.tenantProfile).toEqual({ create: {} });
    });

    it('rejects weak passwords and duplicates', async () => {
      await expect(service.register({ ...dto, password: 'weakweak' })).rejects.toThrow(BadRequestException);
      prisma.user.findFirst.mockResolvedValue({ id: 'x' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('logs in by phone and email', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'OWNER', passwordHash, isSuspended: false, approvalStatus: 'APPROVED' });
      await expect(service.login({ identifier: '0911223344', password: 'Secret123' }, '1.1.1.1')).resolves.toHaveProperty('tokens');
      expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ phoneNumber: '+251911223344' });
      await service.login({ identifier: 'Owner@Demo.et', password: 'Secret123' });
      expect(prisma.user.findFirst.mock.calls[1][0].where).toEqual({ email: 'owner@demo.et' });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { lastLoginAt: expect.any(Date) } });
    });

    it('rejects bad credentials, suspended and rejected accounts', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.login({ identifier: 'x@y.z', password: 'a' })).rejects.toThrow('Invalid credentials');
      prisma.user.findFirst.mockResolvedValueOnce({ passwordHash, isSuspended: false });
      await expect(service.login({ identifier: 'x@y.z', password: 'Wrong123' })).rejects.toThrow('Invalid credentials');
      prisma.user.findFirst.mockResolvedValueOnce({ passwordHash, isSuspended: true, suspendedReason: 'Fraud' });
      await expect(service.login({ identifier: 'x@y.z', password: 'Secret123' })).rejects.toThrow('Fraud');
      prisma.user.findFirst.mockResolvedValueOnce({ passwordHash, isSuspended: false, approvalStatus: 'REJECTED' });
      await expect(service.login({ identifier: 'x@y.z', password: 'Secret123' })).rejects.toThrow(UnauthorizedException);
    });
  });

  it('refresh verifies then issues new tokens', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({ id: 'u1' });
    await service.refresh('r');
    expect(tokens.issueTokens).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('logout revokes all sessions', async () => {
    await expect(service.logout('u1')).resolves.toEqual({ loggedOut: true });
    expect(tokens.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('me returns the public user or throws', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', passwordHash: 'h' });
    await expect(service.me('u1')).resolves.toEqual({ id: 'u1' });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.me('u1')).rejects.toThrow(UnauthorizedException);
  });

  describe('sendOtp', () => {
    it('sends for existing users', async () => {
      prisma.user.findUnique.mockResolvedValue({ phoneVerified: false, language: 'AM' });
      await expect(service.sendOtp('0911223344', 'VERIFY_PHONE')).resolves.toEqual({ sent: true });
      expect(otp.issue).toHaveBeenCalledWith('+251911223344', 'VERIFY_PHONE', 'AM');
    });

    it('does not reveal unknown phones on reset, but errors for verification', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendOtp('0911223344', 'RESET_PASSWORD')).resolves.toEqual({ sent: true });
      expect(otp.issue).not.toHaveBeenCalled();
      await expect(service.sendOtp('0911223344', 'VERIFY_PHONE')).rejects.toThrow(BadRequestException);
    });

    it('rejects already verified phones', async () => {
      prisma.user.findUnique.mockResolvedValue({ phoneVerified: true });
      await expect(service.sendOtp('0911223344', 'VERIFY_PHONE')).rejects.toThrow('already verified');
    });
  });

  it('verifyPhone verifies the OTP and flags the user', async () => {
    await expect(service.verifyPhone('0911223344', '123456')).resolves.toEqual({ phoneVerified: true });
    expect(otp.verify).toHaveBeenCalledWith('+251911223344', 'VERIFY_PHONE', '123456');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { phoneNumber: '+251911223344' }, data: { phoneVerified: true } });
  });

  it('changePassword checks the current password and revokes sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: IDS.owner, passwordHash });
    await expect(service.changePassword(USERS.owner, { currentPassword: 'Secret123', newPassword: 'NewSecret1' })).resolves.toEqual({ passwordChanged: true });
    expect(tokens.revokeAll).toHaveBeenCalledWith(IDS.owner);
    await expect(service.changePassword(USERS.owner, { currentPassword: 'Wrong', newPassword: 'NewSecret1' })).rejects.toThrow('Current password is incorrect');
    await expect(service.changePassword(USERS.owner, { currentPassword: 'Secret123', newPassword: 'weak' })).rejects.toThrow(BadRequestException);
  });

  it('resetPassword verifies the OTP, updates the hash and revokes sessions', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1', role: 'TENANT' });
    await expect(service.resetPassword({ phoneNumber: '0911223344', code: '123456', newPassword: 'NewSecret1' })).resolves.toEqual({ passwordReset: true });
    expect(otp.verify).toHaveBeenCalledWith('+251911223344', 'RESET_PASSWORD', '123456');
    expect(tokens.revokeAll).toHaveBeenCalledWith('u1');
    await expect(service.resetPassword({ phoneNumber: '0911223344', code: '1', newPassword: 'short' })).rejects.toThrow(BadRequestException);
  });
});
