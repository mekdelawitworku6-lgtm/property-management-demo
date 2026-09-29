import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, USERS, IDS } from '../../../../test-utils/mocks';
import { TeamService } from './team.service';

describe('TeamService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const profile = { buildTenantProfileData: jest.fn().mockReturnValue({ idType: 'PASSPORT' }) };
  const service = new TeamService(prisma, audit as any, profile as any);

  beforeEach(() => jest.clearAllMocks());

  describe('createManager', () => {
    const dto = { fullName: 'Sara', phoneNumber: '0922334455', password: 'Manager123' };

    it('creates an approved manager linked to the owner', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'm', passwordHash: 'h' });
      await expect(service.createManager(USERS.owner, dto)).resolves.toEqual({ id: 'm' });
      expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ role: 'MANAGER', employerId: IDS.owner, approvalStatus: 'APPROVED', phoneNumber: '+251922334455' });
    });

    it('rejects non-owners, weak passwords, bad phones and duplicates', async () => {
      await expect(service.createManager(USERS.manager, dto)).rejects.toThrow(ForbiddenException);
      await expect(service.createManager(USERS.owner, { ...dto, password: 'weakpass' })).rejects.toThrow(BadRequestException);
      await expect(service.createManager(USERS.owner, { ...dto, phoneNumber: '1' })).rejects.toThrow(BadRequestException);
      prisma.user.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(service.createManager(USERS.owner, dto)).rejects.toThrow(ConflictException);
    });
  });

  it('listManagers returns public managers of the owner', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'm', passwordHash: 'h' }]);
    await expect(service.listManagers(USERS.owner)).resolves.toEqual([{ id: 'm' }]);
  });

  it('setManagerActive suspends / reactivates only own managers', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.setManagerActive(USERS.owner, 'm', false)).rejects.toThrow(NotFoundException);
    prisma.user.findFirst.mockResolvedValue({ id: 'm' });
    prisma.user.update.mockResolvedValue({ id: 'm' });
    await service.setManagerActive(USERS.owner, 'm', false);
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ isSuspended: true, sessionVersion: { increment: 1 } });
    await service.setManagerActive(USERS.owner, 'm', true);
    expect(prisma.user.update.mock.calls[1][0].data).toMatchObject({ isSuspended: false });
  });

  describe('createTenant', () => {
    it('registers a tenant with profile data (random password when omitted)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 't', passwordHash: 'h' });
      await service.createTenant(USERS.manager, { fullName: 'Meron', phoneNumber: '0933445566', idType: 'PASSPORT' });
      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ role: 'TENANT', approvalStatus: 'APPROVED', tenantProfile: { create: { idType: 'PASSPORT' } } });
      expect(data.passwordHash).toMatch(/^\$2/);
      expect(audit.log).toHaveBeenCalledWith('TENANT_CREATED_BY_OWNER', 'User', 't', USERS.manager);
    });

    it('rejects tenants, invalid phones, weak passwords and duplicates', async () => {
      await expect(service.createTenant(USERS.tenant, { fullName: 'x', phoneNumber: '0933445566' })).rejects.toThrow(ForbiddenException);
      await expect(service.createTenant(USERS.owner, { fullName: 'x', phoneNumber: '1' })).rejects.toThrow(BadRequestException);
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.createTenant(USERS.owner, { fullName: 'x', phoneNumber: '0933445566', password: 'weakweak' })).rejects.toThrow(BadRequestException);
      prisma.user.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(service.createTenant(USERS.owner, { fullName: 'x', phoneNumber: '0933445566' })).rejects.toThrow(ConflictException);
    });
  });

  it('findTenantByPhone finds a tenant or throws', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 't' });
    await expect(service.findTenantByPhone('0933445566')).resolves.toEqual({ id: 't' });
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.findTenantByPhone('0933445566')).rejects.toThrow(NotFoundException);
    await expect(service.findTenantByPhone('bad')).rejects.toThrow(BadRequestException);
  });

  it('listPortfolioTenants computes active agreements and outstanding balance', async () => {
    prisma.user.findMany.mockResolvedValue([{
      id: 't', passwordHash: 'h', tenantProfile: null,
      tenantAgreements: [{ status: 'ACTIVE' }, { status: 'EXPIRED' }],
      tenantInvoices: [{ amount: 1000, amountPaid: 250 }, { amount: 500, amountPaid: 0 }],
    }]);
    const [tenant]: any = await service.listPortfolioTenants(USERS.owner, 'mer');
    expect(tenant).toMatchObject({ id: 't', activeAgreements: 1, outstandingBalance: 1250 });
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toBeDefined();
  });

  it('getPortfolioTenant returns detail with balance or 404', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 't', tenantInvoices: [{ status: 'OVERDUE', amount: 100, amountPaid: 40 }, { status: 'PAID', amount: 100, amountPaid: 100 }],
      tenantAgreements: [], tenantPayments: [],
    });
    await expect(service.getPortfolioTenant(USERS.owner, 't')).resolves.toMatchObject({ outstandingBalance: 60 });
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.getPortfolioTenant(USERS.owner, 't')).rejects.toThrow(NotFoundException);
  });
});
