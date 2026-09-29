import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockNotifications, USERS, IDS } from '../../test-utils/mocks';
import { AdminUsersService } from './admin-users.service';
import { AdminController } from './admin.controller';

describe('AdminUsersService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const service = new AdminUsersService(prisma, audit as any, notifications as any);

  beforeEach(() => jest.clearAllMocks());

  it('findAll filters by role, approval, suspension and search', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u', passwordHash: 'h' }]);
    prisma.user.count.mockResolvedValue(1);
    const result: any = await service.findAll({ role: 'OWNER', approvalStatus: 'PENDING', isSuspended: false, search: 'abe' });
    expect(result.docs).toEqual([{ id: 'u' }]);
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ role: 'OWNER', approvalStatus: 'PENDING', isSuspended: false });
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toHaveLength(3);
  });

  it('findOne returns details or 404', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u', passwordHash: 'h' });
    await expect(service.findOne('u')).resolves.toEqual({ id: 'u' });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne('u')).rejects.toThrow(NotFoundException);
  });

  it('getTarget refuses staff accounts', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
    await expect(service.getTarget('u')).rejects.toThrow(BadRequestException);
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.getTarget('u')).rejects.toThrow(NotFoundException);
  });

  it('approve approves, audits and SMSes', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: IDS.owner, role: 'OWNER' });
    prisma.user.update.mockResolvedValue({ id: IDS.owner, approvalStatus: 'APPROVED' });
    await expect(service.approve(USERS.admin, IDS.owner)).resolves.toMatchObject({ approvalStatus: 'APPROVED' });
    expect(audit.log).toHaveBeenCalledWith('USER_APPROVED', 'User', IDS.owner, USERS.admin);
    expect(notifications.notify).toHaveBeenCalledWith([IDS.owner], 'ACCOUNT_APPROVED', {}, { sms: true });
  });

  it('reject rejects and revokes sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: IDS.owner, role: 'OWNER' });
    prisma.user.update.mockResolvedValue({ id: IDS.owner });
    await service.reject(USERS.admin, IDS.owner, 'Fake documents');
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ approvalStatus: 'REJECTED', sessionVersion: { increment: 1 } });
  });

  it('suspend revokes the owner and their managers', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: IDS.owner, role: 'OWNER' });
    prisma.user.update.mockResolvedValue({ id: IDS.owner, isSuspended: true });
    await service.suspend(USERS.admin, IDS.owner, { reason: 'Fraud' });
    expect(prisma.user.updateMany.mock.calls[0][0].where).toEqual({ employerId: IDS.owner });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ isSuspended: true, suspendedReason: 'Fraud', refreshTokenHash: null });
    expect(notifications.notify).toHaveBeenCalledWith([IDS.owner], 'ACCOUNT_SUSPENDED', { reason: 'Fraud' }, { sms: true });
  });

  it('suspend of a tenant does not touch managers', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: IDS.tenant, role: 'TENANT' });
    prisma.user.update.mockResolvedValue({ id: IDS.tenant });
    await service.suspend(USERS.admin, IDS.tenant, { reason: 'Abuse' });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('unsuspend restores the owner and managers suspended with them', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: IDS.owner, role: 'OWNER', suspendedReason: 'Fraud' });
    prisma.user.update.mockResolvedValue({ id: IDS.owner, isSuspended: false });
    await service.unsuspend(USERS.admin, IDS.owner);
    expect(prisma.user.updateMany.mock.calls[0][0].where).toEqual({ employerId: IDS.owner, suspendedReason: 'Fraud' });
    expect(audit.log).toHaveBeenCalledWith('USER_UNSUSPENDED', 'User', IDS.owner, USERS.admin);
  });

  it('decideKyc updates the tenant KYC status', async () => {
    prisma.tenantProfile.findUnique.mockResolvedValueOnce({ userId: IDS.tenant });
    prisma.tenantProfile.update.mockResolvedValue({ userId: IDS.tenant, kycStatus: 'VERIFIED', idNumberEncrypted: 'x' });
    await expect(service.decideKyc(USERS.admin, IDS.tenant, { status: 'VERIFIED' })).resolves.toEqual({ userId: IDS.tenant, kycStatus: 'VERIFIED', hasIdNumber: true });
    prisma.tenantProfile.findUnique.mockResolvedValueOnce(null);
    await expect(service.decideKyc(USERS.admin, IDS.tenant, { status: 'VERIFIED' })).rejects.toThrow(NotFoundException);
  });
});

describe('AdminController', () => {
  const s = Object.fromEntries(['findAll', 'findOne', 'approve', 'reject', 'suspend', 'unsuspend', 'decideKyc'].map((m) => [m, jest.fn().mockResolvedValue(m)]));
  const c = new AdminController(s as any);

  it('delegates every action', async () => {
    await expect(c.findAll({})).resolves.toBe('findAll');
    await expect(c.findOne('u')).resolves.toBe('findOne');
    await expect(c.approve(USERS.admin, 'u')).resolves.toBe('approve');
    await expect(c.reject(USERS.admin, 'u', { reason: 'r' })).resolves.toBe('reject');
    expect(s.reject).toHaveBeenCalledWith(USERS.admin, 'u', 'r');
    await expect(c.suspend(USERS.admin, 'u', { reason: 'r' })).resolves.toBe('suspend');
    await expect(c.unsuspend(USERS.admin, 'u')).resolves.toBe('unsuspend');
    await expect(c.decideKyc(USERS.admin, 'u', { status: 'VERIFIED' })).resolves.toBe('decideKyc');
  });
});
