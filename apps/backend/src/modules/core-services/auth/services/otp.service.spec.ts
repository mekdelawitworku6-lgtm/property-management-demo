import { BadRequestException, HttpException } from '@nestjs/common';
import { createPrismaMock, mockConfig } from '../../../../test-utils/mocks';
import { sha256 } from '../../../../common/utils/crypto.util';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  const prisma = createPrismaMock();
  const sms = { send: jest.fn().mockResolvedValue(true) };
  const service = new OtpService(prisma, sms as any, mockConfig({ OTP_TTL_MINUTES: 5, OTP_MAX_ATTEMPTS: 3 }));
  const phone = '+251911223344';

  beforeEach(() => jest.clearAllMocks());

  it('issue stores a hashed code and sends it by SMS (Amharic)', async () => {
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const { expiresAt } = await service.issue(phone, 'VERIFY_PHONE', 'AM');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const stored = prisma.otpCode.create.mock.calls[0][0].data;
    const code = sms.send.mock.calls[0][1].match(/\d{6}/)[0];
    expect(stored.codeHash).toBe(sha256(`${phone}:${code}`));
    expect(sms.send.mock.calls[0][1]).toContain('የማረጋገጫ ኮድዎ');
  });

  it('issue enforces a resend cooldown', async () => {
    prisma.otpCode.findFirst.mockResolvedValue({ createdAt: new Date() });
    await expect(service.issue(phone, 'VERIFY_PHONE')).rejects.toThrow(HttpException);
  });

  it('verify consumes a correct code', async () => {
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'o1', attempts: 0, expiresAt: new Date(Date.now() + 60_000), codeHash: sha256(`${phone}:123456`) });
    await service.verify(phone, 'VERIFY_PHONE', '123456');
    expect(prisma.otpCode.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { consumedAt: expect.any(Date) } });
  });

  it('verify rejects wrong, expired and exhausted codes', async () => {
    prisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'o1', attempts: 0, expiresAt: new Date(Date.now() + 60_000), codeHash: 'x' });
    await expect(service.verify(phone, 'VERIFY_PHONE', '000000')).rejects.toThrow('Invalid verification code');
    expect(prisma.otpCode.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { attempts: { increment: 1 } } });
    prisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'o1', attempts: 0, expiresAt: new Date(Date.now() - 1) });
    await expect(service.verify(phone, 'VERIFY_PHONE', '1')).rejects.toThrow('expired');
    prisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'o1', attempts: 3, expiresAt: new Date(Date.now() + 60_000) });
    await expect(service.verify(phone, 'VERIFY_PHONE', '1')).rejects.toThrow(BadRequestException);
  });
});
