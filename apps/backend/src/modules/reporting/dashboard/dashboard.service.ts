import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgreementStatus, ApprovalStatus, ComplaintStatus, EscalationStatus, InvoiceStatus, InvoiceType, PaymentMethod,
  PaymentStatus, RentalRequestStatus, UnitStatus, UserRole, WorkOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { requireOwnerId } from '../../../common/utils/owner-scope.util';
import { addDays, endOfMonthUtc, parseMonth, startOfMonthUtc } from '../../../common/utils/date.util';
import { percentOf, ratioPercent, sumMoney, toNumber } from '../../../common/utils/money.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { summarizeUnits } from '../../property/properties/properties.service';
import { outstandingAmount } from '../../billing/invoices/utils/billing-period.util';

const OPEN_INVOICES: InvoiceStatus[] = [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];

export function resolveMonth(month?: string, now: Date = new Date()) {
  return parseMonth(month) ?? { start: startOfMonthUtc(now), end: endOfMonthUtc(now) };
}

/** Counts rows of `{ status }` by status value. */
export function countBy<T extends string>(rows: Array<{ status: T }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
}

/** At-a-glance dashboards (FR-OWN-03, 4.1.5, FR-ADM-01). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** Occupancy, rent collected vs expected, outstanding, active tenants, maintenance status — per property and in total. */
  async ownerDashboard(user: AuthUser, month?: string) {
    const ownerId = requireOwnerId(user);
    const { start, end } = resolveMonth(month);
    const [properties, invoicesInMonth, paymentsInMonth, openInvoices, activeAgreements, complaints, workOrders, pendingRequests] =
      await Promise.all([
        this.prisma.property.findMany({
          where: { ownerId, isActive: true },
          select: { id: true, name: true, city: true, units: { select: { status: true } } },
        }),
        this.prisma.invoice.findMany({
          where: { ownerId, type: InvoiceType.RENT, status: { not: InvoiceStatus.CANCELLED }, dueDate: { gte: start, lte: end } },
          select: { propertyId: true, amount: true },
        }),
        this.prisma.payment.findMany({
          where: { ownerId, status: PaymentStatus.CONFIRMED, confirmedAt: { gte: start, lte: end } },
          select: { propertyId: true, amount: true, method: true },
        }),
        this.prisma.invoice.findMany({
          where: { ownerId, status: { in: OPEN_INVOICES } },
          select: { propertyId: true, amount: true, amountPaid: true, status: true },
        }),
        this.prisma.agreement.findMany({
          where: { ownerId, status: AgreementStatus.ACTIVE },
          select: { propertyId: true, tenantId: true, endDate: true },
        }),
        this.prisma.complaint.findMany({ where: { ownerId }, select: { status: true, escalationStatus: true } }),
        this.prisma.workOrder.findMany({ where: { ownerId }, select: { status: true } }),
        this.prisma.rentalRequest.count({ where: { status: RentalRequestStatus.PENDING, unit: { property: { ownerId } } } }),
      ]);

    const byProperty = properties.map((property) => {
      const units = summarizeUnits(property.units);
      const expected = sumMoney(invoicesInMonth.filter((i) => i.propertyId === property.id).map((i) => i.amount));
      const collected = sumMoney(paymentsInMonth.filter((p) => p.propertyId === property.id).map((p) => p.amount));
      return {
        propertyId: property.id,
        name: property.name,
        city: property.city,
        units,
        occupancyRate: ratioPercent(units.occupied, units.total),
        rentExpected: expected,
        rentCollected: collected,
        outstanding: sumMoney(openInvoices.filter((i) => i.propertyId === property.id).map(outstandingAmount)),
        activeTenants: new Set(activeAgreements.filter((a) => a.propertyId === property.id).map((a) => a.tenantId)).size,
      };
    });

    const units = summarizeUnits(properties.flatMap((p) => p.units));
    const rentExpected = sumMoney(invoicesInMonth.map((i) => i.amount));
    const rentCollected = sumMoney(paymentsInMonth.map((p) => p.amount));
    const soon = addDays(new Date(), Number(this.configService.get('LEASE_EXPIRY_REMINDER_DAYS', 30)));
    return {
      period: { start, end },
      totals: {
        properties: properties.length,
        units,
        occupancyRate: ratioPercent(units.occupied, units.total),
        activeTenants: new Set(activeAgreements.map((a) => a.tenantId)).size,
        activeAgreements: activeAgreements.length,
        leasesExpiringSoon: activeAgreements.filter((a) => a.endDate <= soon).length,
        rentExpected,
        rentCollected,
        collectionRate: ratioPercent(rentCollected, rentExpected),
        collectedByMethod: {
          TELEBIRR: sumMoney(paymentsInMonth.filter((p) => p.method === PaymentMethod.TELEBIRR).map((p) => p.amount)),
          BANK_TRANSFER: sumMoney(paymentsInMonth.filter((p) => p.method === PaymentMethod.BANK_TRANSFER).map((p) => p.amount)),
          CASH: sumMoney(paymentsInMonth.filter((p) => p.method === PaymentMethod.CASH).map((p) => p.amount)),
        },
        outstanding: sumMoney(openInvoices.map(outstandingAmount)),
        overdueInvoices: openInvoices.filter((i) => i.status === InvoiceStatus.OVERDUE).length,
        pendingRentalRequests: pendingRequests,
      },
      maintenance: {
        complaints: countBy(complaints),
        escalated: complaints.filter((c) => c.escalationStatus === EscalationStatus.ESCALATED).length,
        workOrders: countBy(workOrders),
      },
      properties: byProperty,
    };
  }

  /** Tenant home: leases, balance, next due invoice, open complaints, recent payments. */
  async tenantDashboard(user: AuthUser) {
    const [agreements, openInvoices, complaints, recentPayments] = await Promise.all([
      this.prisma.agreement.findMany({
        where: { tenantId: user.id, status: { in: [AgreementStatus.ACTIVE, AgreementStatus.PENDING_SIGNATURE] } },
        include: { unit: { select: { unitNumber: true } }, property: { select: { name: true, address: true } } },
        omit: { content: true },
      }),
      this.prisma.invoice.findMany({ where: { tenantId: user.id, status: { in: OPEN_INVOICES } }, orderBy: { dueDate: 'asc' } }),
      this.prisma.complaint.findMany({
        where: { tenantId: user.id, status: { in: [ComplaintStatus.OPEN, ComplaintStatus.IN_PROGRESS] } },
        select: { id: true, referenceNo: true, title: true, status: true, createdAt: true },
      }),
      this.prisma.payment.findMany({ where: { tenantId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    return {
      agreements,
      pendingSignatures: agreements.filter((a) => a.status === AgreementStatus.PENDING_SIGNATURE).length,
      outstandingBalance: sumMoney(openInvoices.map(outstandingAmount)),
      overdueInvoices: openInvoices.filter((i) => i.status === InvoiceStatus.OVERDUE).length,
      nextDue: openInvoices[0] ? { ...openInvoices[0], outstanding: outstandingAmount(openInvoices[0]) } : null,
      openComplaints: complaints,
      recentPayments,
    };
  }

  /** Platform-wide observation for Possible Technology + Ethio Telecom (FR-ADM-01, FR-ADM-05). */
  async adminDashboard(month?: string) {
    const { start, end } = resolveMonth(month);
    const staleDays = Number(this.configService.get('COMPLAINT_ESCALATION_DAYS', 7));
    const [users, properties, units, agreements, paymentsInMonth, pendingPayments, escalated, stale, payoutsPending] =
      await Promise.all([
        this.prisma.user.groupBy({ by: ['role', 'approvalStatus', 'isSuspended'], _count: { _all: true } }),
        this.prisma.property.count({ where: { isActive: true } }),
        this.prisma.unit.findMany({ select: { status: true } }),
        this.prisma.agreement.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.payment.findMany({
          where: { status: PaymentStatus.CONFIRMED, confirmedAt: { gte: start, lte: end } },
          select: { amount: true, method: true },
        }),
        this.prisma.payment.groupBy({ by: ['method'], where: { status: PaymentStatus.PENDING }, _count: { _all: true }, _sum: { amount: true } }),
        this.prisma.complaint.count({ where: { escalationStatus: EscalationStatus.ESCALATED } }),
        this.prisma.complaint.count({
          where: {
            escalationStatus: EscalationStatus.NONE,
            status: { in: [ComplaintStatus.OPEN, ComplaintStatus.IN_PROGRESS] },
            createdAt: { lt: addDays(new Date(), -staleDays) },
          },
        }),
        this.prisma.payout.aggregate({ where: { status: 'PENDING' }, _sum: { netAmount: true }, _count: { _all: true } }),
      ]);

    const countUsers = (role: UserRole, filter: (u: (typeof users)[number]) => boolean = () => true) =>
      users.filter((u) => u.role === role && filter(u)).reduce((acc, u) => acc + u._count._all, 0);
    const telebirrVolume = sumMoney(paymentsInMonth.filter((p) => p.method === PaymentMethod.TELEBIRR).map((p) => p.amount));
    const unitSummary = countBy(units);
    return {
      period: { start, end },
      users: {
        owners: countUsers(UserRole.OWNER),
        ownersPendingApproval: countUsers(UserRole.OWNER, (u) => u.approvalStatus === ApprovalStatus.PENDING),
        tenants: countUsers(UserRole.TENANT),
        managers: countUsers(UserRole.MANAGER),
        suspended: users.filter((u) => u.isSuspended).reduce((acc, u) => acc + u._count._all, 0),
      },
      properties,
      units: { total: units.length, ...unitSummary, occupancyRate: ratioPercent(unitSummary[UnitStatus.OCCUPIED] ?? 0, units.length) },
      agreements: Object.fromEntries(agreements.map((a) => [a.status, a._count._all])),
      payments: {
        confirmedVolume: sumMoney(paymentsInMonth.map((p) => p.amount)),
        confirmedCount: paymentsInMonth.length,
        telebirrVolume,
        estimatedPlatformFee: percentOf(telebirrVolume, Number(this.configService.get('PLATFORM_FEE_PERCENT', 2))),
        pendingConfirmation: pendingPayments.map((p) => ({ method: p.method, count: p._count._all, amount: toNumber(p._sum.amount) })),
      },
      disputes: { escalated, unresolvedPastSla: stale },
      payouts: { pendingCount: payoutsPending._count._all, pendingAmount: toNumber(payoutsPending._sum.netAmount) },
      workOrdersOpen: await this.prisma.workOrder.count({
        where: { status: { in: [WorkOrderStatus.OPEN, WorkOrderStatus.ASSIGNED, WorkOrderStatus.IN_PROGRESS] } },
      }),
    };
  }
}
