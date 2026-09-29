import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockNotifications, mockRealtime, USERS, IDS } from '../../../test-utils/mocks';
import { WorkOrdersService } from './work-orders.service';

const workOrder = { id: 'w', referenceNo: 'WO-1', ownerId: IDS.owner, propertyId: IDS.property, unitId: IDS.unit, status: 'OPEN', complaintId: IDS.complaint, title: 'Fix', complaint: { tenantId: IDS.tenant } };

describe('WorkOrdersService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const expenses = { createFromWorkOrder: jest.fn() };
  const service = new WorkOrdersService(prisma, audit as any, notifications as any, realtime as any, expenses as any);

  beforeEach(() => jest.clearAllMocks());

  it('assertVendor requires an active vendor of the owner', async () => {
    await expect(service.assertVendor(IDS.owner)).resolves.toBeUndefined();
    prisma.vendor.findFirst.mockResolvedValueOnce(null);
    await expect(service.assertVendor(IDS.owner, 'v')).rejects.toThrow(BadRequestException);
  });

  describe('create', () => {
    it('creates from a complaint, ASSIGNED when vendor given, complaint → IN_PROGRESS', async () => {
      prisma.complaint.findFirst.mockResolvedValue({ id: IDS.complaint, propertyId: IDS.property, unitId: IDS.unit });
      prisma.property.findFirst.mockResolvedValue({ id: IDS.property });
      prisma.vendor.findFirst.mockResolvedValue({ id: 'v' });
      prisma.workOrder.create.mockResolvedValue(workOrder);
      await service.create(USERS.owner, { complaintId: IDS.complaint, vendorId: 'v', title: 'Fix', estimatedCost: 1000 });
      expect(prisma.workOrder.create.mock.calls[0][0].data).toMatchObject({ propertyId: IDS.property, unitId: IDS.unit, status: 'ASSIGNED', createdById: IDS.owner });
      expect(prisma.complaint.updateMany).toHaveBeenCalledWith({ where: { id: IDS.complaint, status: 'OPEN' }, data: { status: 'IN_PROGRESS' } });
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'WORK_ORDER_UPDATED', expect.anything(), expect.anything());
    });

    it('validates complaint, property and idempotency', async () => {
      prisma.workOrder.findUnique.mockResolvedValueOnce(workOrder);
      await expect(service.create(USERS.owner, { clientRef: 'k', title: 'x' })).resolves.toBe(workOrder);
      prisma.complaint.findFirst.mockResolvedValueOnce(null);
      await expect(service.create(USERS.owner, { complaintId: 'c', title: 'x' })).rejects.toThrow('Complaint not found');
      await expect(service.create(USERS.owner, { title: 'x' })).rejects.toThrow('propertyId or complaintId is required');
      prisma.property.findFirst.mockResolvedValueOnce(null);
      await expect(service.create(USERS.owner, { propertyId: 'p', title: 'x' })).rejects.toThrow('Property not found');
    });
  });

  it('notifyTenant notifies linked tenant and emits realtime', async () => {
    await service.notifyTenant({ ...workOrder, complaint: null } as any);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(realtime.emitToUsers).toHaveBeenCalledWith([IDS.owner, undefined], 'work-order.updated', expect.anything());
  });

  it('findAll scopes by owner with filters (staff unscoped)', async () => {
    prisma.workOrder.findMany.mockResolvedValue([]);
    prisma.workOrder.count.mockResolvedValue(0);
    await service.findAll(USERS.manager, { status: 'OPEN', vendorId: 'v', complaintId: 'c', propertyId: 'p' });
    expect(prisma.workOrder.findMany.mock.calls[0][0].where).toEqual({ ownerId: IDS.owner, status: 'OPEN', vendorId: 'v', complaintId: 'c', propertyId: 'p' });
    await service.findAll(USERS.admin, {});
    expect(prisma.workOrder.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('findOne returns or 404', async () => {
    prisma.workOrder.findFirst.mockResolvedValueOnce(workOrder);
    await expect(service.findOne(USERS.owner, 'w')).resolves.toBe(workOrder);
    prisma.workOrder.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne(USERS.owner, 'w')).rejects.toThrow(NotFoundException);
  });

  it('update assigns a vendor (OPEN → ASSIGNED) and rejects closed orders', async () => {
    prisma.workOrder.findFirst.mockResolvedValueOnce(workOrder);
    prisma.vendor.findFirst.mockResolvedValue({ id: 'v' });
    prisma.workOrder.update.mockResolvedValue({ ...workOrder, status: 'ASSIGNED' });
    await service.update(USERS.owner, 'w', { vendorId: 'v', scheduledDate: '2026-10-02' });
    expect(prisma.workOrder.update.mock.calls[0][0].data).toMatchObject({ vendorId: 'v', status: 'ASSIGNED', scheduledDate: new Date('2026-10-02') });
    expect(notifications.notify).toHaveBeenCalled();
    prisma.workOrder.findFirst.mockResolvedValueOnce({ ...workOrder, status: 'COMPLETED' });
    await expect(service.update(USERS.owner, 'w', {})).rejects.toThrow(BadRequestException);
  });

  it('complete logs cost as expense and resolves the complaint', async () => {
    prisma.workOrder.findFirst.mockResolvedValueOnce(workOrder);
    prisma.workOrder.update.mockResolvedValue({ ...workOrder, status: 'COMPLETED' });
    await service.complete(USERS.owner, 'w', { actualCost: 1350.555, photos: ['/after.jpg'] });
    expect(prisma.workOrder.update.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED', actualCost: 1350.56, photos: { push: ['/after.jpg'] } });
    expect(expenses.createFromWorkOrder).toHaveBeenCalledWith(prisma, expect.objectContaining({ id: 'w' }), 1350.56, IDS.owner);
    expect(prisma.complaint.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'RESOLVED' });
  });

  it('complete with zero cost skips the expense; closed orders rejected', async () => {
    prisma.workOrder.findFirst.mockResolvedValueOnce({ ...workOrder, complaintId: null });
    prisma.workOrder.update.mockResolvedValue({ ...workOrder, complaintId: null });
    await service.complete(USERS.owner, 'w', { actualCost: 0 });
    expect(expenses.createFromWorkOrder).not.toHaveBeenCalled();
    prisma.workOrder.findFirst.mockResolvedValueOnce({ ...workOrder, status: 'CANCELLED' });
    await expect(service.complete(USERS.owner, 'w', { actualCost: 1 })).rejects.toThrow(BadRequestException);
  });

  it('cancel cancels open work orders only', async () => {
    prisma.workOrder.findFirst.mockResolvedValueOnce(workOrder);
    prisma.workOrder.update.mockResolvedValue({ ...workOrder, status: 'CANCELLED' });
    await expect(service.cancel(USERS.owner, 'w')).resolves.toMatchObject({ status: 'CANCELLED' });
    prisma.workOrder.findFirst.mockResolvedValueOnce({ ...workOrder, status: 'COMPLETED' });
    await expect(service.cancel(USERS.owner, 'w')).rejects.toThrow(BadRequestException);
  });
});
