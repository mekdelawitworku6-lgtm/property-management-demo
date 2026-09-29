import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, USERS, IDS } from '../../../test-utils/mocks';
import { VendorsService } from './vendors.service';

describe('VendorsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const service = new VendorsService(prisma, audit as any);

  beforeEach(() => jest.clearAllMocks());

  it('normalizePhone validates Ethiopian numbers', () => {
    expect(service.normalizePhone('0911556677')).toBe('+251911556677');
    expect(() => service.normalizePhone('1')).toThrow(BadRequestException);
  });

  it('create adds a vendor for the owner', async () => {
    prisma.vendor.create.mockResolvedValue({ id: 'v' });
    await service.create(USERS.manager, { name: 'Plumber', serviceType: 'PLUMBING', phoneNumber: '0911556677' });
    expect(prisma.vendor.create.mock.calls[0][0].data).toMatchObject({ ownerId: IDS.owner, phoneNumber: '+251911556677' });
    await expect(service.create(USERS.tenant, {} as any)).rejects.toThrow(ForbiddenException);
  });

  it('findAll filters by type, search and active flag', async () => {
    prisma.vendor.findMany.mockResolvedValue([]);
    prisma.vendor.count.mockResolvedValue(0);
    await service.findAll(USERS.owner, { serviceType: 'ELECTRICAL', search: 'abe' });
    expect(prisma.vendor.findMany.mock.calls[0][0].where).toMatchObject({ ownerId: IDS.owner, isActive: true, serviceType: 'ELECTRICAL', name: { contains: 'abe', mode: 'insensitive' } });
  });

  it('findOne adds total spend from completed jobs', async () => {
    prisma.vendor.findFirst.mockResolvedValueOnce({ id: 'v', workOrders: [{ status: 'COMPLETED', actualCost: 500 }, { status: 'OPEN', actualCost: null }, { status: 'COMPLETED', actualCost: 250 }] });
    await expect(service.findOne(USERS.owner, 'v')).resolves.toMatchObject({ totalSpend: 750, completedJobs: 2 });
    prisma.vendor.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne(USERS.owner, 'v')).rejects.toThrow(NotFoundException);
  });

  it('update edits own vendors (normalizing phone)', async () => {
    prisma.vendor.findFirst.mockResolvedValueOnce({ id: 'v' });
    prisma.vendor.update.mockResolvedValue({ id: 'v' });
    await service.update(USERS.owner, 'v', { phoneNumber: '0911000000', isActive: false });
    expect(prisma.vendor.update.mock.calls[0][0].data).toMatchObject({ phoneNumber: '+251911000000', isActive: false });
    prisma.vendor.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(USERS.owner, 'v', {})).rejects.toThrow(NotFoundException);
  });
});
