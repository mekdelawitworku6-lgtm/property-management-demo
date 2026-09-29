import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockConfig, mockNotifications, mockRealtime, USERS, IDS } from '../../../test-utils/mocks';
import { ComplaintsService, canTransition } from './complaints.service';

const complaint = {
  id: IDS.complaint, referenceNo: 'CMP-1', ownerId: IDS.owner, tenantId: IDS.tenant, status: 'OPEN', escalationStatus: 'NONE',
  category: 'MAINTENANCE', priority: 'MEDIUM', title: 'Leak', unit: { unitNumber: 'A-101' }, property: { name: 'Bole' },
};

describe('ComplaintsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const service = new ComplaintsService(prisma, audit as any, notifications as any, realtime as any, mockConfig({ COMPLAINT_ESCALATION_DAYS: 7 }));

  beforeEach(() => jest.clearAllMocks());

  it('canTransition follows owner and tenant rules', () => {
    expect(canTransition('OWNER', 'OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('OWNER', 'CLOSED', 'OPEN')).toBe(false);
    expect(canTransition('TENANT', 'RESOLVED', 'OPEN')).toBe(true);
    expect(canTransition('TENANT', 'OPEN', 'RESOLVED')).toBe(false);
  });

  it('staleThreshold is N days ago', () => {
    expect(service.staleThreshold(new Date('2026-09-29T00:00:00Z')).toISOString()).toBe('2026-09-22T00:00:00.000Z');
  });

  it('adminVisibilityWhere covers escalated or stale unresolved complaints (3.4.2)', () => {
    const where: any = service.adminVisibilityWhere(new Date('2026-09-29T00:00:00Z'));
    expect(where.OR[0]).toEqual({ escalationStatus: { not: 'NONE' } });
    expect(where.OR[1]).toMatchObject({ status: { in: ['OPEN', 'IN_PROGRESS'] }, createdAt: { lt: new Date('2026-09-22T00:00:00Z') } });
  });

  it('scopeWhere varies by role', () => {
    expect(service.scopeWhere(USERS.tenant)).toEqual({ tenantId: IDS.tenant });
    expect(service.scopeWhere(USERS.manager)).toEqual({ ownerId: IDS.owner });
    expect(service.scopeWhere(USERS.admin)).toHaveProperty('OR');
  });

  describe('resolveTarget', () => {
    it('uses the tenant active agreement', async () => {
      prisma.agreement.findFirst.mockResolvedValueOnce({ id: 'a', ownerId: IDS.owner, propertyId: 'p', unitId: 'u' });
      await expect(service.resolveTarget(USERS.tenant, { category: 'MAINTENANCE', title: 't', description: 'd' }))
        .resolves.toEqual({ tenantId: IDS.tenant, ownerId: IDS.owner, propertyId: 'p', unitId: 'u', agreementId: 'a' });
      prisma.agreement.findFirst.mockResolvedValueOnce(null);
      await expect(service.resolveTarget(USERS.tenant, {} as any)).rejects.toThrow('active agreement');
    });

    it('lets owners/managers raise requests for their property and unit', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'p' });
      prisma.unit.findFirst.mockResolvedValue({ id: 'u' });
      prisma.agreement.findFirst.mockResolvedValue({ id: 'a', tenantId: 't' });
      await expect(service.resolveTarget(USERS.manager, { propertyId: 'p', unitId: 'u' } as any))
        .resolves.toEqual({ tenantId: 't', ownerId: IDS.owner, propertyId: 'p', unitId: 'u', agreementId: 'a' });
      await expect(service.resolveTarget(USERS.owner, {} as any)).rejects.toThrow('propertyId is required');
      prisma.unit.findFirst.mockResolvedValueOnce(null);
      await expect(service.resolveTarget(USERS.owner, { propertyId: 'p', unitId: 'x' } as any)).rejects.toThrow(BadRequestException);
      prisma.property.findFirst.mockResolvedValueOnce(null);
      await expect(service.resolveTarget(USERS.owner, { propertyId: 'x' } as any)).rejects.toThrow(NotFoundException);
    });
  });

  it('create stores the complaint, notifies owner (SMS if urgent) and syncs', async () => {
    jest.spyOn(service, 'resolveTarget').mockResolvedValueOnce({ tenantId: IDS.tenant, ownerId: IDS.owner, propertyId: 'p', unitId: 'u', agreementId: 'a' });
    prisma.complaint.create.mockResolvedValue({ ...complaint, priority: 'URGENT' });
    await service.create(USERS.tenant, { category: 'MAINTENANCE', priority: 'URGENT', title: 'Leak', description: 'Water' });
    expect(prisma.complaint.create.mock.calls[0][0].data).toMatchObject({ raisedById: IDS.tenant, title: 'Leak', photos: [] });
    expect(notifications.notifyOwner).toHaveBeenCalledWith(IDS.owner, 'COMPLAINT_NEW', expect.anything(), expect.objectContaining({ sms: true }));
    expect(audit.log).toHaveBeenCalledWith('COMPLAINT_CREATED', 'Complaint', IDS.complaint, USERS.tenant, expect.anything());
  });

  it('create is idempotent on clientRef', async () => {
    prisma.complaint.findUnique.mockResolvedValueOnce(complaint);
    await expect(service.create(USERS.tenant, { clientRef: 'k' } as any)).resolves.toBe(complaint);
    expect(prisma.complaint.create).not.toHaveBeenCalled();
  });

  it('findAll combines scope and filters', async () => {
    prisma.complaint.findMany.mockResolvedValue([]);
    prisma.complaint.count.mockResolvedValue(0);
    await service.findAll(USERS.owner, { status: 'OPEN', staleOnly: true, category: 'NOISE', priority: 'HIGH', escalationStatus: 'NONE', propertyId: 'p' });
    const where = prisma.complaint.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ ownerId: IDS.owner });
    expect(where.AND[1]).toMatchObject({ category: 'NOISE', priority: 'HIGH', propertyId: 'p', status: { in: ['OPEN', 'IN_PROGRESS'] } });
  });

  it('findVisible / findOne return visible complaints or 404', async () => {
    prisma.complaint.findFirst.mockResolvedValueOnce(complaint);
    await expect(service.findOne(USERS.tenant, IDS.complaint)).resolves.toBe(complaint);
    prisma.complaint.findFirst.mockResolvedValueOnce(null);
    await expect(service.findVisible(USERS.otherOwner, IDS.complaint)).rejects.toThrow(NotFoundException);
  });

  describe('updateStatus', () => {
    it('owner moves to IN_PROGRESS with a note and the tenant is SMSed', async () => {
      prisma.complaint.findFirst.mockResolvedValue(complaint);
      prisma.complaint.update.mockResolvedValue({ ...complaint, status: 'IN_PROGRESS' });
      await service.updateStatus(USERS.owner, IDS.complaint, { status: 'IN_PROGRESS', note: 'Plumber booked' });
      expect(prisma.complaintResponse.create).toHaveBeenCalledWith({ data: { complaintId: IDS.complaint, authorId: IDS.owner, message: 'Plumber booked' } });
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'COMPLAINT_UPDATED', expect.anything(), expect.objectContaining({ sms: true }));
    });

    it('tenant reopening sets resolvedAt null and notifies the owner', async () => {
      prisma.complaint.findFirst.mockResolvedValue({ ...complaint, status: 'RESOLVED' });
      prisma.complaint.update.mockResolvedValue({ ...complaint, status: 'OPEN' });
      await service.updateStatus(USERS.tenant, IDS.complaint, { status: 'OPEN' });
      expect(prisma.complaint.update.mock.calls[0][0].data).toMatchObject({ status: 'OPEN', resolvedAt: null });
      expect(notifications.notifyOwner).toHaveBeenCalled();
    });

    it('rejects staff, invalid transitions and no-ops unchanged status', async () => {
      await expect(service.updateStatus(USERS.admin, 'c', { status: 'CLOSED' })).rejects.toThrow(ForbiddenException);
      prisma.complaint.findFirst.mockResolvedValue(complaint);
      await expect(service.updateStatus(USERS.tenant, 'c', { status: 'RESOLVED' })).rejects.toThrow(BadRequestException);
      await expect(service.updateStatus(USERS.owner, 'c', { status: 'OPEN' })).resolves.toBe(complaint);
    });
  });

  describe('respond', () => {
    it('owner reply moves OPEN → IN_PROGRESS and notifies tenant', async () => {
      prisma.complaint.findFirst.mockResolvedValue(complaint);
      prisma.complaintResponse.create.mockResolvedValue({ id: 'r' });
      await service.respond(USERS.owner, IDS.complaint, { message: 'On it' });
      expect(prisma.complaint.update).toHaveBeenCalledWith({ where: { id: IDS.complaint }, data: { status: 'IN_PROGRESS' } });
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'COMPLAINT_RESPONSE', expect.anything(), expect.anything());
    });

    it('tenant reply notifies owner; admin reply notifies both; closed rejected', async () => {
      prisma.complaint.findFirst.mockResolvedValue({ ...complaint, status: 'IN_PROGRESS' });
      await service.respond(USERS.tenant, IDS.complaint, { message: 'Thanks' });
      expect(notifications.notifyOwner).toHaveBeenCalledTimes(1);
      await service.respond(USERS.admin, IDS.complaint, { message: 'Reviewing' });
      expect(notifications.notifyOwner).toHaveBeenCalledTimes(2);
      prisma.complaint.findFirst.mockResolvedValue({ ...complaint, status: 'CLOSED' });
      await expect(service.respond(USERS.owner, IDS.complaint, { message: 'x' })).rejects.toThrow('closed');
    });
  });

  describe('escalate', () => {
    it('escalates to admin and notifies everyone', async () => {
      prisma.complaint.findFirst.mockResolvedValue(complaint);
      prisma.complaint.update.mockResolvedValue({ ...complaint, escalationStatus: 'ESCALATED' });
      await service.escalate(USERS.tenant, IDS.complaint, { reason: 'No response' });
      expect(prisma.complaint.update.mock.calls[0][0].data).toMatchObject({ escalationStatus: 'ESCALATED', escalatedById: IDS.tenant, escalationReason: 'No response' });
      expect(notifications.notifyStaff).toHaveBeenCalledWith('COMPLAINT_ESCALATED', { reference: 'CMP-1' }, ['ADMIN'], expect.anything());
      expect(realtime.emitToStaff).toHaveBeenCalled();
    });

    it('rejects staff, double escalation and closed complaints', async () => {
      await expect(service.escalate(USERS.admin, 'c', { reason: 'x' })).rejects.toThrow(ForbiddenException);
      prisma.complaint.findFirst.mockResolvedValueOnce({ ...complaint, escalationStatus: 'ESCALATED' });
      await expect(service.escalate(USERS.owner, 'c', { reason: 'x' })).rejects.toThrow('already escalated');
      prisma.complaint.findFirst.mockResolvedValueOnce({ ...complaint, status: 'CLOSED' });
      await expect(service.escalate(USERS.owner, 'c', { reason: 'x' })).rejects.toThrow('closed');
    });
  });

  describe('adminResolve', () => {
    it('records the admin decision and notifies both parties', async () => {
      prisma.complaint.findFirst.mockResolvedValue({ ...complaint, escalationStatus: 'ESCALATED' });
      prisma.complaint.update.mockResolvedValue({ ...complaint, status: 'RESOLVED', escalationStatus: 'ADMIN_RESOLVED' });
      await service.adminResolve(USERS.admin, IDS.complaint, { resolution: 'Owner to repair' });
      expect(prisma.complaint.update.mock.calls[0][0].data).toMatchObject({ escalationStatus: 'ADMIN_RESOLVED', adminResolution: 'Owner to repair', status: 'RESOLVED' });
      expect(prisma.complaintResponse.create.mock.calls[0][0].data.message).toContain('[Admin resolution]');
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'COMPLAINT_UPDATED', expect.anything(), expect.anything());
    });

    it('marks stale un-escalated complaints as escalated by the admin; rejects repeats', async () => {
      prisma.complaint.findFirst.mockResolvedValueOnce(complaint);
      prisma.complaint.update.mockResolvedValue(complaint);
      await service.adminResolve(USERS.admin, IDS.complaint, { resolution: 'x', status: 'CLOSED' });
      expect(prisma.complaint.update.mock.calls[0][0].data).toMatchObject({ status: 'CLOSED', escalatedById: IDS.admin });
      prisma.complaint.findFirst.mockResolvedValueOnce({ ...complaint, escalationStatus: 'ADMIN_RESOLVED' });
      await expect(service.adminResolve(USERS.admin, IDS.complaint, { resolution: 'x' })).rejects.toThrow('already resolved');
    });
  });
});
