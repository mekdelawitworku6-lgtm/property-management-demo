import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockConfig, USERS, IDS } from '../../../test-utils/mocks';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = createPrismaMock();
  const service = new ReportsService(prisma, mockConfig());

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: IDS.owner, fullName: 'Abebe', phoneNumber: '+251', ownerProfile: null });
    prisma.payment.findMany.mockResolvedValue([
      { propertyId: 'p1', amount: 18000, confirmedAt: new Date('2026-09-05T00:00:00Z'), createdAt: new Date('2026-09-05T00:00:00Z'), referenceNo: 'PAY-1', method: 'TELEBIRR', status: 'CONFIRMED', property: { id: 'p1', name: 'Bole' }, tenant: { fullName: 'Meron' }, invoice: { invoiceNo: 'INV', type: 'RENT' } },
      { propertyId: 'p2', amount: 5000, confirmedAt: null, createdAt: new Date('2026-09-06T00:00:00Z'), referenceNo: 'PAY-2', method: 'BANK_TRANSFER', status: 'PENDING', property: { id: 'p2', name: 'Yeka' }, tenant: { fullName: 'Sara' }, invoice: null },
    ]);
    prisma.expense.findMany.mockResolvedValue([
      { propertyId: 'p1', amount: 3000, incurredOn: new Date('2026-09-10T00:00:00Z'), category: 'MAINTENANCE', description: 'Pipe', property: { id: 'p1', name: 'Bole' } },
      { propertyId: 'p3', amount: 1000, incurredOn: new Date('2026-09-11T00:00:00Z'), category: 'TAX', description: null, property: { id: 'p3', name: 'Piassa' } },
    ]);
  });

  it('resolveOwner requires ownerId for staff and scopes owners', () => {
    expect(service.resolveOwner(USERS.manager)).toBe(IDS.owner);
    expect(service.resolveOwner(USERS.admin, 'o')).toBe('o');
    expect(() => service.resolveOwner(USERS.admin)).toThrow(BadRequestException);
  });

  it('ownerStatement totals income, expenses and net per property', async () => {
    const statement = await service.ownerStatement(USERS.owner, '2026-09');
    expect(statement.totals).toEqual({ income: 23000, expenses: 4000, net: 19000 });
    expect(statement.byProperty).toEqual(expect.arrayContaining([
      { propertyId: 'p1', name: 'Bole', income: 18000, expenses: 3000, net: 15000 },
      { propertyId: 'p3', name: 'Piassa', income: 0, expenses: 1000, net: -1000 },
    ]));
    expect(statement.income[1].type).toBe('RENT');
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.ownerStatement(USERS.owner)).rejects.toThrow(NotFoundException);
  });

  it('paymentsReport lists payments and confirmed total', async () => {
    const report = await service.paymentsReport(USERS.admin, '2026-09-01', '2026-09-30');
    expect(report.rows).toHaveLength(2);
    expect(report.totalConfirmed).toBe(18000);
    expect(prisma.payment.findMany.mock.calls[0][0].where).not.toHaveProperty('ownerId');
    await service.paymentsReport(USERS.owner);
    expect(prisma.payment.findMany.mock.calls[1][0].where.ownerId).toBe(IDS.owner);
  });

  it('rentRoll lists active leases with outstanding', async () => {
    prisma.agreement.findMany.mockResolvedValue([
      { rentAmount: 18000, endDate: new Date('2027-09-30'), property: { name: 'Bole' }, unit: { unitNumber: 'A-101' }, tenant: { fullName: 'Meron', phoneNumber: '+251' }, invoices: [{ amount: 18000, amountPaid: 8000 }] },
    ]);
    const roll = await service.rentRoll(USERS.owner);
    expect(roll).toMatchObject({ totalRent: 18000, totalOutstanding: 10000, rows: [{ unit: 'A-101', outstanding: 10000 }] });
  });

  it('render builds xlsx and pdf files', async () => {
    const tables = [{ title: 'T', columns: [{ key: 'a', header: 'A' }], rows: [{ a: 1 }] }];
    await expect(service.render(tables, 'xlsx', 'r', 'EN')).resolves.toMatchObject({ fileName: 'r.xlsx', contentType: expect.stringContaining('spreadsheet') });
    const pdf = await service.render(tables, 'pdf', 'r', 'EN');
    expect(pdf).toMatchObject({ fileName: 'r.pdf', contentType: 'application/pdf' });
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.render(tables, 'pdf', 'r', 'AM')).resolves.toHaveProperty('buffer');
  });

  it('exportOwnerStatement names the file by month and uses Amharic labels', async () => {
    const spy = jest.spyOn(service, 'render');
    const file = await service.exportOwnerStatement(USERS.owner, '2026-09', 'xlsx', 'AM');
    expect(file.fileName).toBe('owner-statement-2026-09.xlsx');
    expect(spy.mock.calls[0][0][0].title).toContain('የባለቤት ወርሃዊ መግለጫ');
  });

  it('exportPayments and exportRentRoll render their tables', async () => {
    prisma.agreement.findMany.mockResolvedValue([]);
    await expect(service.exportPayments(USERS.owner, undefined, undefined, 'xlsx', 'EN')).resolves.toMatchObject({ fileName: 'payments-report.xlsx' });
    await expect(service.exportRentRoll(USERS.owner, 'pdf', 'EN')).resolves.toMatchObject({ fileName: 'rent-roll.pdf' });
  });
});
