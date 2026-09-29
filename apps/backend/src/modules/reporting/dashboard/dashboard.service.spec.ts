import { ForbiddenException } from '@nestjs/common';
import { createPrismaMock, mockConfig, USERS, IDS } from '../../../test-utils/mocks';
import { DashboardService, countBy, resolveMonth } from './dashboard.service';

describe('DashboardService', () => {
  const prisma = createPrismaMock();
  const service = new DashboardService(prisma, mockConfig({ LEASE_EXPIRY_REMINDER_DAYS: 30, COMPLAINT_ESCALATION_DAYS: 7, PLATFORM_FEE_PERCENT: 2 }));

  beforeEach(() => jest.clearAllMocks());

  it('resolveMonth parses YYYY-MM or falls back to the current month', () => {
    expect(resolveMonth('2026-09').start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(resolveMonth(undefined, new Date('2026-02-10T00:00:00Z')).end.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('countBy tallies statuses', () => {
    expect(countBy([{ status: 'A' }, { status: 'B' }, { status: 'A' }])).toEqual({ A: 2, B: 1 });
  });

  it('ownerDashboard computes occupancy, expected vs collected, outstanding and maintenance', async () => {
    prisma.property.findMany.mockResolvedValue([
      { id: 'p1', name: 'Bole', city: 'Addis Ababa', units: [{ status: 'OCCUPIED' }, { status: 'VACANT' }] },
      { id: 'p2', name: 'Yeka', city: 'Addis Ababa', units: [{ status: 'OCCUPIED' }] },
    ]);
    prisma.invoice.findMany
      .mockResolvedValueOnce([{ propertyId: 'p1', amount: 10000 }, { propertyId: 'p2', amount: 10000 }])
      .mockResolvedValueOnce([{ propertyId: 'p1', amount: 10000, amountPaid: 2000, status: 'OVERDUE' }]);
    prisma.payment.findMany.mockResolvedValue([{ propertyId: 'p1', amount: 10000, method: 'TELEBIRR' }, { propertyId: 'p2', amount: 5000, method: 'CASH' }]);
    prisma.agreement.findMany.mockResolvedValue([
      { propertyId: 'p1', tenantId: 't1', endDate: new Date(Date.now() + 5 * 86_400_000) },
      { propertyId: 'p2', tenantId: 't2', endDate: new Date(Date.now() + 300 * 86_400_000) },
    ]);
    prisma.complaint.findMany.mockResolvedValue([{ status: 'OPEN', escalationStatus: 'ESCALATED' }, { status: 'RESOLVED', escalationStatus: 'NONE' }]);
    prisma.workOrder.findMany.mockResolvedValue([{ status: 'ASSIGNED' }]);
    prisma.rentalRequest.count.mockResolvedValue(3);

    const result = await service.ownerDashboard(USERS.manager, '2026-09');
    expect(result.totals).toMatchObject({
      properties: 2, occupancyRate: 66.7, activeTenants: 2, leasesExpiringSoon: 1, rentExpected: 20000, rentCollected: 15000,
      collectionRate: 75, collectedByMethod: { TELEBIRR: 10000, BANK_TRANSFER: 0, CASH: 5000 }, outstanding: 8000, overdueInvoices: 1, pendingRentalRequests: 3,
    });
    expect(result.maintenance).toEqual({ complaints: { OPEN: 1, RESOLVED: 1 }, escalated: 1, workOrders: { ASSIGNED: 1 } });
    expect(result.properties[0]).toMatchObject({ propertyId: 'p1', occupancyRate: 50, rentExpected: 10000, rentCollected: 10000, outstanding: 8000, activeTenants: 1 });
    expect(prisma.property.findMany.mock.calls[0][0].where.ownerId).toBe(IDS.owner);
    await expect(service.ownerDashboard(USERS.tenant)).rejects.toThrow(ForbiddenException);
  });

  it('tenantDashboard summarizes leases, balance and next due', async () => {
    prisma.agreement.findMany.mockResolvedValue([{ status: 'ACTIVE' }, { status: 'PENDING_SIGNATURE' }]);
    prisma.invoice.findMany.mockResolvedValue([{ id: 'i1', amount: 1000, amountPaid: 200, status: 'OVERDUE' }, { id: 'i2', amount: 500, amountPaid: 0, status: 'UNPAID' }]);
    prisma.complaint.findMany.mockResolvedValue([{ id: 'c' }]);
    prisma.payment.findMany.mockResolvedValue([]);
    const result = await service.tenantDashboard(USERS.tenant);
    expect(result).toMatchObject({ pendingSignatures: 1, outstandingBalance: 1300, overdueInvoices: 1, nextDue: { id: 'i1', outstanding: 800 } });
  });

  it('tenantDashboard handles no open invoices', async () => {
    prisma.agreement.findMany.mockResolvedValue([]);
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.complaint.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);
    await expect(service.tenantDashboard(USERS.tenant)).resolves.toMatchObject({ nextDue: null, outstandingBalance: 0 });
  });

  it('adminDashboard aggregates platform-wide metrics', async () => {
    prisma.user.groupBy.mockResolvedValue([
      { role: 'OWNER', approvalStatus: 'APPROVED', isSuspended: false, _count: { _all: 3 } },
      { role: 'OWNER', approvalStatus: 'PENDING', isSuspended: false, _count: { _all: 2 } },
      { role: 'TENANT', approvalStatus: 'APPROVED', isSuspended: true, _count: { _all: 1 } },
      { role: 'MANAGER', approvalStatus: 'APPROVED', isSuspended: false, _count: { _all: 1 } },
    ]);
    prisma.property.count.mockResolvedValue(4);
    prisma.unit.findMany.mockResolvedValue([{ status: 'OCCUPIED' }, { status: 'VACANT' }]);
    prisma.agreement.groupBy.mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 5 } }]);
    prisma.payment.findMany.mockResolvedValue([{ amount: 10000, method: 'TELEBIRR' }, { amount: 2000, method: 'CASH' }]);
    prisma.payment.groupBy.mockResolvedValue([{ method: 'BANK_TRANSFER', _count: { _all: 2 }, _sum: { amount: 3000 } }]);
    prisma.complaint.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    prisma.payout.aggregate.mockResolvedValue({ _count: { _all: 1 }, _sum: { netAmount: 9800 } });
    prisma.workOrder.count.mockResolvedValue(4);
    const result = await service.adminDashboard('2026-09');
    expect(result.users).toEqual({ owners: 5, ownersPendingApproval: 2, tenants: 1, managers: 1, suspended: 1 });
    expect(result.units).toMatchObject({ total: 2, occupancyRate: 50 });
    expect(result.agreements).toEqual({ ACTIVE: 5 });
    expect(result.payments).toMatchObject({ confirmedVolume: 12000, telebirrVolume: 10000, estimatedPlatformFee: 200, pendingConfirmation: [{ method: 'BANK_TRANSFER', count: 2, amount: 3000 }] });
    expect(result.disputes).toEqual({ escalated: 1, unresolvedPastSla: 2 });
    expect(result.payouts).toEqual({ pendingCount: 1, pendingAmount: 9800 });
    expect(result.workOrdersOpen).toBe(4);
  });
});
