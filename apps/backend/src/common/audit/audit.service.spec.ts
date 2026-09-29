import { Prisma } from '@prisma/client';
import { createPrismaMock, USERS } from '../../test-utils/mocks';
import { AuditService, sanitizeMetadata } from './audit.service';

describe('AuditService', () => {
  const prisma = createPrismaMock();
  const service = new AuditService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('sanitizeMetadata redacts secrets, converts decimals/dates and truncates depth', () => {
    const date = new Date('2026-09-29T00:00:00Z');
    expect(sanitizeMetadata({ password: 'x', nested: { otp: '1', ok: 1 }, amount: new Prisma.Decimal(5), at: date, list: [{ token: 't' }] })).toEqual({
      password: '[redacted]', nested: { otp: '[redacted]', ok: 1 }, amount: 5, at: date.toISOString(), list: [{ token: '[redacted]' }],
    });
    expect(sanitizeMetadata({ a: 1 }, 6)).toBe('[truncated]');
    expect(sanitizeMetadata(undefined)).toBeNull();
  });

  it('log persists the actor, role, ip and sanitized metadata', async () => {
    await service.log('PAYMENT_CONFIRMED', 'Payment', 'p1', USERS.telecom, { password: 'x', amount: 10 });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PAYMENT_CONFIRMED', entityType: 'Payment', entityId: 'p1', actorId: USERS.telecom.id,
        actorRole: 'TELECOM', ipAddress: '127.0.0.1', metadata: { password: '[redacted]', amount: 10 },
      }),
    });
  });

  it('log records SYSTEM actions and never throws', async () => {
    prisma.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.log('AGREEMENT_EXPIRED', 'Agreement', 'a1', null)).resolves.toBeUndefined();
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorId: null, actorRole: 'SYSTEM' });
  });

  it('findAll builds filters and paginates', async () => {
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'l1' }] as any);
    prisma.auditLog.count.mockResolvedValue(1);
    const result = await service.findAll({ action: 'X', entityType: 'Payment', entityId: 'e', actorId: 'u', from: '2026-09-01', to: '2026-09-30', page: 1, limit: 10 });
    expect(result).toMatchObject({ docs: [{ id: 'l1' }], total: 1, page: 1, limit: 10 });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toMatchObject({
      action: 'X', entityType: 'Payment', entityId: 'e', actorId: 'u', createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
    });
  });

  it('findForEntity returns the trail oldest first', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    await service.findForEntity('Agreement', 'a1');
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: 'Agreement', entityId: 'a1' }, orderBy: { createdAt: 'asc' },
    }));
  });
});
