import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockNotifications, mockRealtime, USERS, IDS } from '../../../test-utils/mocks';
import { RentalRequestsService } from './rental-requests.service';

const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const unit = { id: IDS.unit, unitNumber: 'A-101', status: 'VACANT', property: { ownerId: IDS.owner, name: 'Bole' } };

describe('RentalRequestsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const agreements = {
    assertOwnerApproved: jest.fn().mockResolvedValue({ id: IDS.owner }),
    createFromRequest: jest.fn().mockResolvedValue({ id: IDS.agreement, referenceNo: 'AGR', tenantId: IDS.tenant, ownerId: IDS.owner }),
    afterCreated: jest.fn(),
  };
  const service = new RentalRequestsService(prisma, audit as any, notifications as any, realtime as any, agreements as any);

  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    const dto = { unitId: IDS.unit, desiredStartDate: future, durationMonths: 12 };

    it('creates a pending request and notifies the owner', async () => {
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.rentalRequest.findFirst.mockResolvedValue(null);
      prisma.rentalRequest.create.mockResolvedValue({ id: IDS.request });
      await service.create(USERS.tenant, dto);
      expect(prisma.rentalRequest.create.mock.calls[0][0].data).toMatchObject({ unitId: IDS.unit, tenantId: IDS.tenant, durationMonths: 12 });
      expect(notifications.notifyOwner).toHaveBeenCalledWith(IDS.owner, 'RENTAL_REQUEST_NEW', expect.anything(), expect.objectContaining({ sms: true }));
    });

    it('rejects unavailable units, past dates and duplicates', async () => {
      prisma.unit.findFirst.mockResolvedValueOnce(null);
      await expect(service.create(USERS.tenant, dto)).rejects.toThrow(NotFoundException);
      prisma.unit.findFirst.mockResolvedValue(unit);
      await expect(service.create(USERS.tenant, { ...dto, desiredStartDate: '2020-01-01' })).rejects.toThrow(BadRequestException);
      prisma.rentalRequest.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(service.create(USERS.tenant, dto)).rejects.toThrow(ConflictException);
    });
  });

  it('findAll scopes tenant / owner / staff', async () => {
    prisma.rentalRequest.findMany.mockResolvedValue([]);
    prisma.rentalRequest.count.mockResolvedValue(0);
    await service.findAll(USERS.tenant, {});
    expect(prisma.rentalRequest.findMany.mock.calls[0][0].where).toEqual({ tenantId: IDS.tenant });
    await service.findAll(USERS.manager, { status: 'PENDING' });
    expect(prisma.rentalRequest.findMany.mock.calls[1][0].where).toEqual({ unit: { property: { ownerId: IDS.owner } }, status: 'PENDING' });
    await service.findAll(USERS.admin, { propertyId: IDS.property });
    expect(prisma.rentalRequest.findMany.mock.calls[2][0].where).toEqual({ unit: { propertyId: IDS.property } });
  });

  it('findOne allows the tenant, owner and staff only', async () => {
    const request = { id: IDS.request, tenantId: IDS.tenant, unit };
    prisma.rentalRequest.findUnique.mockResolvedValue(request);
    await expect(service.findOne(USERS.tenant, IDS.request)).resolves.toBe(request);
    await expect(service.findOne(USERS.owner, IDS.request)).resolves.toBe(request);
    await expect(service.findOne(USERS.admin, IDS.request)).resolves.toBe(request);
    await expect(service.findOne(USERS.otherOwner, IDS.request)).rejects.toThrow(NotFoundException);
    prisma.rentalRequest.findUnique.mockResolvedValue(null);
    await expect(service.findOne(USERS.tenant, IDS.request)).rejects.toThrow(NotFoundException);
  });

  it('cancel only cancels own pending requests', async () => {
    prisma.rentalRequest.findFirst.mockResolvedValueOnce({ status: 'PENDING' });
    prisma.rentalRequest.update.mockResolvedValue({ status: 'CANCELLED' });
    await expect(service.cancel(USERS.tenant, IDS.request)).resolves.toEqual({ status: 'CANCELLED' });
    prisma.rentalRequest.findFirst.mockResolvedValueOnce({ status: 'ACCEPTED' });
    await expect(service.cancel(USERS.tenant, IDS.request)).rejects.toThrow(BadRequestException);
    prisma.rentalRequest.findFirst.mockResolvedValueOnce(null);
    await expect(service.cancel(USERS.tenant, IDS.request)).rejects.toThrow(NotFoundException);
  });

  describe('accept', () => {
    const request = { id: IDS.request, tenantId: IDS.tenant, unitId: IDS.unit, status: 'PENDING', unit, tenant: { isSuspended: false } };

    it('reserves the unit, declines competitors and creates the agreement', async () => {
      prisma.rentalRequest.findUnique.mockResolvedValue(request);
      prisma.unit.updateMany.mockResolvedValue({ count: 1 });
      prisma.rentalRequest.findMany.mockResolvedValue([{ id: 'r2', tenantId: 't2' }]);
      const result = await service.accept(USERS.owner, IDS.request, { rentAmount: 17000 });
      expect(result).toMatchObject({ rentalRequestId: IDS.request, agreement: { id: IDS.agreement } });
      expect(prisma.unit.updateMany).toHaveBeenCalledWith({ where: { id: IDS.unit, status: 'VACANT' }, data: { status: 'RESERVED' } });
      expect(prisma.rentalRequest.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['r2'] } });
      expect(agreements.createFromRequest).toHaveBeenCalledWith(prisma, request, { id: IDS.owner }, { rentAmount: 17000 });
      expect(notifications.notify).toHaveBeenCalledWith(['t2'], 'RENTAL_REQUEST_REJECTED', expect.anything());
      expect(agreements.afterCreated).toHaveBeenCalled();
    });

    it('rejects foreign, non-pending, non-vacant, suspended and raced requests', async () => {
      prisma.rentalRequest.findUnique.mockResolvedValueOnce({ ...request, unit: { ...unit, property: { ownerId: 'x' } } });
      await expect(service.accept(USERS.owner, IDS.request)).rejects.toThrow(NotFoundException);
      prisma.rentalRequest.findUnique.mockResolvedValueOnce({ ...request, status: 'REJECTED' });
      await expect(service.accept(USERS.owner, IDS.request)).rejects.toThrow('Request is REJECTED');
      prisma.rentalRequest.findUnique.mockResolvedValueOnce({ ...request, unit: { ...unit, status: 'OCCUPIED' } });
      await expect(service.accept(USERS.owner, IDS.request)).rejects.toThrow('Unit is OCCUPIED');
      prisma.rentalRequest.findUnique.mockResolvedValueOnce({ ...request, tenant: { isSuspended: true } });
      await expect(service.accept(USERS.owner, IDS.request)).rejects.toThrow('suspended');
      prisma.rentalRequest.findUnique.mockResolvedValueOnce(request);
      prisma.unit.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.accept(USERS.owner, IDS.request)).rejects.toThrow(ConflictException);
    });
  });

  it('reject declines a pending request with a reason', async () => {
    prisma.rentalRequest.findUnique.mockResolvedValue({ id: IDS.request, tenantId: IDS.tenant, status: 'PENDING', unit });
    prisma.rentalRequest.update.mockResolvedValue({ status: 'REJECTED' });
    await service.reject(USERS.owner, IDS.request, { reason: 'Taken' });
    expect(prisma.rentalRequest.update.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Taken' });
    expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'RENTAL_REQUEST_REJECTED', expect.anything());
    prisma.rentalRequest.findUnique.mockResolvedValue({ status: 'ACCEPTED', unit });
    await expect(service.reject(USERS.owner, IDS.request, {})).rejects.toThrow(BadRequestException);
    prisma.rentalRequest.findUnique.mockResolvedValue(null);
    await expect(service.reject(USERS.owner, IDS.request, {})).rejects.toThrow(NotFoundException);
  });
});
