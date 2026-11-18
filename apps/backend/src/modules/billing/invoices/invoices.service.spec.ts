import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockConfig, mockNotifications, mockRealtime, USERS, IDS } from '../../../test-utils/mocks';
import { InvoicesService } from './invoices.service';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const agreement = {
  id: IDS.agreement, tenantId: IDS.tenant, ownerId: IDS.owner, propertyId: IDS.property, unitId: IDS.unit,
  startDate: d('2026-10-01'), endDate: d('2027-09-30'), rentAmount: 18000, depositAmount: 36000, paymentDueDay: 5,
  status: 'ACTIVE', unit: { unitNumber: 'A-101' },
};

describe('InvoicesService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const service = new InvoicesService(prisma, audit as any, notifications as any, realtime as any, mockConfig({ INVOICE_ADVANCE_DAYS: 7, RENT_REMINDER_INTERVAL_DAYS: 3 }));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.invoice.findMany.mockResolvedValue([]);
  });

  it('advanceDays reads config', () => expect(service.advanceDays()).toBe(7));

  it('createMissing inserts only drafts not yet invoiced', async () => {
    prisma.invoice.findMany.mockResolvedValueOnce([{ type: 'RENT', periodStart: d('2026-10-01') }]);
    const drafts: any[] = [
      { type: 'RENT', periodStart: d('2026-10-01') },
      { type: 'RENT', periodStart: d('2026-11-01') },
    ];
    const created = await service.createMissing(prisma, IDS.agreement, drafts);
    expect(created).toHaveLength(1);
    const rows = prisma.invoice.createMany.mock.calls[0][0].data;
    expect(rows[0].invoiceNo).toMatch(/^INV-/);
    await expect(service.createMissing(prisma, IDS.agreement, [])).resolves.toEqual([]);
  });

  it('generateInitialInvoices bills the deposit and first rent period', async () => {
    const created = await service.generateInitialInvoices(prisma, agreement, d('2026-09-29'));
    expect(created.map((c) => c.type)).toEqual(['DEPOSIT', 'RENT']);
    expect(created[1]).toMatchObject({ amount: 18000, periodStart: d('2026-10-01') });
  });

  it('generateInitialInvoices bills the first period even for a far-future start', async () => {
    const created = await service.generateInitialInvoices(prisma, { ...agreement, depositAmount: 0, startDate: d('2027-01-01') }, d('2026-09-29'));
    expect(created).toHaveLength(1);
    expect(created[0].periodStart).toEqual(d('2027-01-01'));
  });

  it('generateDueInvoices creates upcoming rent and notifies tenants by SMS', async () => {
    prisma.agreement.findMany.mockResolvedValue([agreement]);
    prisma.invoice.findMany.mockResolvedValue([{ type: 'RENT', periodStart: d('2026-10-01') }]);
    await expect(service.generateDueInvoices(d('2026-10-28'))).resolves.toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'RENT_DUE', expect.objectContaining({ dueDate: '2026-11-05', unit: 'A-101' }), expect.objectContaining({ sms: true }));
  });

  it('ensureRentInvoicesThrough creates remaining rent invoices without notifying', async () => {
    prisma.agreement.findUnique.mockResolvedValueOnce(agreement);
    prisma.invoice.findMany.mockResolvedValueOnce([{ type: 'RENT', periodStart: d('2026-10-01') }]);
    await expect(service.ensureRentInvoicesThrough(IDS.agreement, agreement.endDate)).resolves.toBe(11);
    const data = prisma.invoice.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(11);
    expect(data[0]).toMatchObject({ type: 'RENT', periodStart: d('2026-11-01') });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('ensureRentInvoicesThrough ignores inactive agreements', async () => {
    prisma.agreement.findUnique.mockResolvedValueOnce({ ...agreement, status: 'EXPIRED' });
    await expect(service.ensureRentInvoicesThrough(IDS.agreement, agreement.endDate)).resolves.toBe(0);
    expect(prisma.invoice.createMany).not.toHaveBeenCalled();
  });

  it('markOverdue flags unpaid invoices past due', async () => {
    prisma.invoice.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markOverdue(d('2026-11-10'))).resolves.toBe(3);
    expect(prisma.invoice.updateMany.mock.calls[0][0]).toMatchObject({ data: { status: 'OVERDUE' }, where: { dueDate: { lt: d('2026-11-10') } } });
  });

  it('sendOverdueReminders SMSes and records the reminder', async () => {
    prisma.invoice.findMany.mockResolvedValue([{ id: 'i', tenantId: IDS.tenant, amount: 1000, amountPaid: 200, dueDate: d('2026-11-05'), unit: { unitNumber: 'A' } }]);
    await expect(service.sendOverdueReminders(d('2026-11-10'))).resolves.toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'RENT_OVERDUE', expect.objectContaining({ amount: 800 }), expect.objectContaining({ sms: true }));
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'i' }, data: { lastReminderAt: d('2026-11-10'), reminderCount: { increment: 1 } } });
  });

  it('sendUpcomingReminders sends one due-soon reminder', async () => {
    prisma.invoice.findMany.mockResolvedValue([{ id: 'i', tenantId: IDS.tenant, amount: 1000, amountPaid: 0, dueDate: d('2026-11-05'), unit: { unitNumber: 'A' } }]);
    await expect(service.sendUpcomingReminders(d('2026-11-03'))).resolves.toBe(1);
    // Never remind twice for the same cycle: either no reminder yet, or the last one is
    // older than the cadence window.
    expect(prisma.invoice.findMany.mock.calls[0][0].where).toMatchObject({
      OR: [
        { lastReminderAt: null },
        { lastReminderAt: { lt: expect.any(Date) } },
      ],
    });
  });

  it('buildWhere combines scope and filters', () => {
    expect(service.buildWhere(USERS.tenant, { status: 'OVERDUE', from: '2026-10-01', to: '2026-10-31' })).toMatchObject({
      tenantId: IDS.tenant, status: 'OVERDUE', dueDate: { gte: expect.any(Date), lte: expect.any(Date) },
    });
    expect(service.buildWhere(USERS.owner, { propertyId: 'p', agreementId: 'a', tenantId: 't', type: 'RENT' })).toEqual({
      ownerId: IDS.owner, propertyId: 'p', agreementId: 'a', tenantId: 't', type: 'RENT',
    });
  });

  it('findAll adds outstanding amounts', async () => {
    prisma.invoice.findMany.mockResolvedValue([{ id: 'i', amount: 100, amountPaid: 30 }]);
    prisma.invoice.count.mockResolvedValue(1);
    const result: any = await service.findAll(USERS.owner, {});
    expect(result.docs[0].outstanding).toBe(70);
  });

  it('findOne enforces access', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ id: 'i', ownerId: IDS.owner, tenantId: IDS.tenant, amount: 10, amountPaid: 0 });
    await expect(service.findOne(USERS.tenant, 'i')).resolves.toMatchObject({ outstanding: 10 });
    await expect(service.findOne(USERS.otherOwner, 'i')).rejects.toThrow(ForbiddenException);
    prisma.invoice.findUnique.mockResolvedValue(null);
    await expect(service.findOne(USERS.owner, 'i')).rejects.toThrow(NotFoundException);
  });

  it('createManual adds a penalty to an active agreement', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce(agreement);
    prisma.invoice.create.mockResolvedValue({ id: 'i' });
    await service.createManual(USERS.owner, { agreementId: IDS.agreement, type: 'PENALTY', amount: 500, dueDate: '2026-11-10', description: 'Late fee' });
    expect(prisma.invoice.create.mock.calls[0][0].data).toMatchObject({ type: 'PENALTY', amount: 500, tenantId: IDS.tenant, dueDate: d('2026-11-10') });
    prisma.agreement.findFirst.mockResolvedValueOnce({ ...agreement, status: 'EXPIRED' });
    await expect(service.createManual(USERS.owner, { agreementId: 'a', type: 'OTHER', amount: 1, dueDate: '2026-11-10', description: 'x' })).rejects.toThrow(BadRequestException);
    prisma.agreement.findFirst.mockResolvedValueOnce(null);
    await expect(service.createManual(USERS.owner, { agreementId: 'a', type: 'OTHER', amount: 1, dueDate: '2026-11-10', description: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('cancel only cancels unpaid invoices', async () => {
    prisma.invoice.findFirst.mockResolvedValueOnce({ id: 'i', amountPaid: 0, status: 'UNPAID', tenantId: 't', description: 'Rent' });
    prisma.invoice.update.mockResolvedValue({ status: 'CANCELLED' });
    await service.cancel(USERS.owner, 'i', 'Mistake');
    expect(prisma.invoice.update.mock.calls[0][0].data).toEqual({ status: 'CANCELLED', description: 'Rent [Cancelled: Mistake]' });
    prisma.invoice.findFirst.mockResolvedValueOnce({ amountPaid: 10 });
    await expect(service.cancel(USERS.owner, 'i')).rejects.toThrow(BadRequestException);
    prisma.invoice.findFirst.mockResolvedValueOnce({ amountPaid: 0, status: 'CANCELLED' });
    await expect(service.cancel(USERS.owner, 'i')).resolves.toMatchObject({ status: 'CANCELLED' });
    prisma.invoice.findFirst.mockResolvedValueOnce(null);
    await expect(service.cancel(USERS.owner, 'i')).rejects.toThrow(NotFoundException);
  });

  it('applyPayment accumulates and recomputes status', async () => {
    prisma.invoice.findUnique.mockResolvedValueOnce({ id: 'i', amount: 1000, amountPaid: 400, dueDate: d('2026-12-01'), status: 'PARTIALLY_PAID' });
    await service.applyPayment(prisma, 'i', 600, d('2026-11-01'));
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'i' }, data: { amountPaid: 1000, status: 'PAID' } });
    prisma.invoice.findUnique.mockResolvedValueOnce(null);
    await expect(service.applyPayment(prisma, 'i', 1)).rejects.toThrow(NotFoundException);
  });

  it('cancelFutureInvoices cancels unpaid invoices after a date', async () => {
    prisma.invoice.updateMany.mockResolvedValue({ count: 2 });
    await expect(service.cancelFutureInvoices(prisma, 'a', d('2026-12-31'))).resolves.toBe(2);
    expect(prisma.invoice.updateMany.mock.calls[0][0].where).toMatchObject({ agreementId: 'a', periodStart: { gt: d('2026-12-31') }, amountPaid: 0 });
  });

  it('getSchedule merges projected periods with issued invoices', async () => {
    prisma.agreement.findUnique.mockResolvedValueOnce({
      ...agreement, endDate: d('2026-12-31'),
      invoices: [{ id: 'i1', invoiceNo: 'INV-1', type: 'RENT', periodStart: d('2026-10-01'), amount: 18000, amountPaid: 18000, status: 'PAID' }],
    });
    const schedule = await service.getSchedule(USERS.tenant, IDS.agreement);
    expect(schedule).toHaveLength(3);
    expect(schedule[0]).toMatchObject({ status: 'PAID', invoiceNo: 'INV-1', amountPaid: 18000 });
    expect(schedule[1]).toMatchObject({ status: 'SCHEDULED', amount: 18000, invoiceId: null });
    prisma.agreement.findUnique.mockResolvedValueOnce(null);
    await expect(service.getSchedule(USERS.tenant, 'x')).rejects.toThrow(NotFoundException);
  });

  it('getBalances groups outstanding by tenant', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { tenantId: 't1', tenant: { id: 't1' }, amount: 1000, amountPaid: 0, status: 'OVERDUE', dueDate: d('2026-10-05') },
      { tenantId: 't1', tenant: { id: 't1' }, amount: 1000, amountPaid: 500, status: 'UNPAID', dueDate: d('2026-11-05') },
      { tenantId: 't2', tenant: { id: 't2' }, amount: 300, amountPaid: 0, status: 'UNPAID', dueDate: d('2026-11-05') },
    ]);
    const result = await service.getBalances(USERS.owner);
    expect(result.totalOutstanding).toBe(1800);
    expect(result.tenants[0]).toMatchObject({ outstanding: 1500, overdueCount: 1, oldestDueDate: d('2026-10-05') });
  });
});
