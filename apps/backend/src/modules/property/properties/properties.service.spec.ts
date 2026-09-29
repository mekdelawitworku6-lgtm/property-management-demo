import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, USERS, IDS } from '../../../test-utils/mocks';
import { PropertiesService, summarizeUnits } from './properties.service';

describe('PropertiesService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const service = new PropertiesService(prisma, audit as any);
  const property = { id: IDS.property, ownerId: IDS.owner, name: 'Bole', isActive: true };

  beforeEach(() => jest.clearAllMocks());

  it('summarizeUnits counts statuses', () => {
    expect(summarizeUnits([{ status: 'VACANT' }, { status: 'OCCUPIED' }, { status: 'OCCUPIED' }, { status: 'RESERVED' }, { status: 'UNDER_MAINTENANCE' }] as any))
      .toEqual({ total: 5, vacant: 1, reserved: 1, occupied: 2, underMaintenance: 1 });
  });

  it('create assigns the owner (manager → employer) and audits', async () => {
    prisma.property.create.mockResolvedValue(property);
    await service.create(USERS.manager, { name: 'Bole', type: 'RESIDENTIAL', city: 'Addis Ababa', address: 'x' });
    expect(prisma.property.create.mock.calls[0][0].data.ownerId).toBe(IDS.owner);
    expect(audit.log).toHaveBeenCalledWith('PROPERTY_CREATED', 'Property', IDS.property, USERS.manager, { name: 'Bole' });
    await expect(service.create(USERS.tenant, {} as any)).rejects.toThrow(ForbiddenException);
  });

  it('findAll scopes by owner, applies filters and adds unit summaries', async () => {
    prisma.property.findMany.mockResolvedValue([{ ...property, units: [{ status: 'VACANT' }] }]);
    prisma.property.count.mockResolvedValue(1);
    const result: any = await service.findAll(USERS.owner, { type: 'RESIDENTIAL', city: 'addis ababa', search: 'bo' });
    expect(result.docs[0].unitSummary.vacant).toBe(1);
    const where = prisma.property.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ ownerId: IDS.owner, type: 'RESIDENTIAL', isActive: true });
    expect(where.OR).toHaveLength(2);
  });

  it('findAll lets staff see all owners or filter by owner', async () => {
    prisma.property.findMany.mockResolvedValue([]);
    prisma.property.count.mockResolvedValue(0);
    await service.findAll(USERS.admin, {});
    expect(prisma.property.findMany.mock.calls[0][0].where).not.toHaveProperty('ownerId');
    await service.findAll(USERS.admin, { ownerId: 'o2' });
    expect(prisma.property.findMany.mock.calls[1][0].where.ownerId).toBe('o2');
  });

  it('findOne enforces access', async () => {
    prisma.property.findUnique.mockResolvedValue({ ...property, units: [], agreements: [] });
    await expect(service.findOne(USERS.owner, IDS.property)).resolves.toHaveProperty('unitSummary');
    await expect(service.findOne(USERS.otherOwner, IDS.property)).rejects.toThrow(ForbiddenException);
    prisma.property.findUnique.mockResolvedValue(null);
    await expect(service.findOne(USERS.owner, 'x')).rejects.toThrow(NotFoundException);
  });

  it('update edits an owned property', async () => {
    prisma.property.findUnique.mockResolvedValue(property);
    prisma.property.update.mockResolvedValue({ ...property, name: 'New' });
    await expect(service.update(USERS.owner, IDS.property, { name: 'New' })).resolves.toMatchObject({ name: 'New' });
    expect(audit.log).toHaveBeenCalledWith('PROPERTY_UPDATED', 'Property', IDS.property, USERS.owner, { fields: ['name'] });
  });

  it('deactivate unlists units, blocked by active agreements', async () => {
    prisma.property.findUnique.mockResolvedValue(property);
    prisma.agreement.count.mockResolvedValueOnce(1);
    await expect(service.deactivate(USERS.owner, IDS.property)).rejects.toThrow(BadRequestException);
    prisma.agreement.count.mockResolvedValueOnce(0);
    prisma.property.update.mockResolvedValue({ ...property, isActive: false });
    await expect(service.deactivate(USERS.owner, IDS.property)).resolves.toMatchObject({ isActive: false });
    expect(prisma.unit.updateMany).toHaveBeenCalledWith({ where: { propertyId: IDS.property }, data: { isListed: false } });
  });

  it('findOwned rejects tenants and other owners', async () => {
    prisma.property.findUnique.mockResolvedValue(property);
    await expect(service.findOwned(USERS.admin, IDS.property)).resolves.toEqual(property);
    await expect(service.findOwned(USERS.otherOwner, IDS.property)).rejects.toThrow(ForbiddenException);
    prisma.property.findUnique.mockResolvedValue(null);
    await expect(service.findOwned(USERS.owner, IDS.property)).rejects.toThrow(NotFoundException);
  });
});
