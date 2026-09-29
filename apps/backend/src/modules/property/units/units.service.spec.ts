import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockRealtime, USERS, IDS } from '../../../test-utils/mocks';
import { UnitsService, assertManualStatusChange } from './units.service';

describe('UnitsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const realtime = mockRealtime();
  const properties = { findOwned: jest.fn() };
  const service = new UnitsService(prisma, audit as any, properties as any, realtime as any);
  const unit = { id: IDS.unit, status: 'VACANT', unitNumber: 'A-1', property: { ownerId: IDS.owner } };

  beforeEach(() => jest.clearAllMocks());

  it('assertManualStatusChange only allows VACANT ↔ UNDER_MAINTENANCE', () => {
    expect(() => assertManualStatusChange('VACANT', 'UNDER_MAINTENANCE')).not.toThrow();
    expect(() => assertManualStatusChange('UNDER_MAINTENANCE', 'VACANT')).not.toThrow();
    expect(() => assertManualStatusChange('VACANT', 'OCCUPIED')).toThrow(BadRequestException);
    expect(() => assertManualStatusChange('OCCUPIED', 'VACANT')).toThrow(BadRequestException);
  });

  it('create adds a unit to an active owned property', async () => {
    properties.findOwned.mockResolvedValueOnce({ isActive: true });
    prisma.unit.create.mockResolvedValue({ id: IDS.unit, unitNumber: 'A-1' });
    await service.create(USERS.owner, IDS.property, { unitNumber: 'A-1', type: 'APARTMENT', rentAmount: 1000 });
    expect(prisma.unit.create.mock.calls[0][0].data).toMatchObject({ propertyId: IDS.property, rentAmount: 1000 });
    properties.findOwned.mockResolvedValueOnce({ isActive: false });
    await expect(service.create(USERS.owner, IDS.property, {} as any)).rejects.toThrow('deactivated');
  });

  it('findByProperty lists units of an owned property', async () => {
    properties.findOwned.mockResolvedValue({});
    prisma.unit.findMany.mockResolvedValue([unit]);
    await expect(service.findByProperty(USERS.owner, IDS.property)).resolves.toEqual([unit]);
  });

  it('findOne enforces access', async () => {
    prisma.unit.findUnique.mockResolvedValue(unit);
    await expect(service.findOne(USERS.manager, IDS.unit)).resolves.toBe(unit);
    await expect(service.findOne(USERS.otherOwner, IDS.unit)).rejects.toThrow(ForbiddenException);
    prisma.unit.findUnique.mockResolvedValue(null);
    await expect(service.findOne(USERS.owner, IDS.unit)).rejects.toThrow(NotFoundException);
  });

  it('update validates manual status changes and emits realtime', async () => {
    prisma.unit.findUnique.mockResolvedValue(unit);
    prisma.unit.update.mockResolvedValue({ ...unit, rentAmount: 2000 });
    await service.update(USERS.owner, IDS.unit, { rentAmount: 2000 });
    expect(realtime.emitToUsers).toHaveBeenCalledWith([IDS.owner], 'unit.updated', expect.anything());
    await expect(service.update(USERS.owner, IDS.unit, { status: 'OCCUPIED' })).rejects.toThrow(BadRequestException);
  });

  it('remove deletes units without agreement history', async () => {
    prisma.unit.findUnique.mockResolvedValue(unit);
    prisma.agreement.count.mockResolvedValueOnce(2);
    await expect(service.remove(USERS.owner, IDS.unit)).rejects.toThrow(BadRequestException);
    prisma.agreement.count.mockResolvedValueOnce(0);
    await expect(service.remove(USERS.owner, IDS.unit)).resolves.toEqual({ deleted: true });
    expect(prisma.unit.delete).toHaveBeenCalledWith({ where: { id: IDS.unit } });
  });
});
