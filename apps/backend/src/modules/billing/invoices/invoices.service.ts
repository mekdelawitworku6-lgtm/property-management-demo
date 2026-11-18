import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgreementStatus, InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { assertCanAccess, requireOwnerId, scopeWhere } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { addDays, formatDate, startOfDayUtc } from '../../../common/utils/date.util';
import { roundMoney, sumMoney, toNumber } from '../../../common/utils/money.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import {
  AgreementBillingInput,
  InvoiceDraft,
  buildDepositInvoiceDraft,
  buildRentInvoiceDrafts,
  computeBillingPeriods,
  invoiceKey,
  outstandingAmount,
  prorateRent,
  resolveInvoiceStatus,
} from './utils/billing-period.util';
import { CreateManualInvoiceDto, InvoiceFilterDto } from './dto/invoice.dto';

type Tx = Prisma.TransactionClient;
export const OPEN_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.UNPAID,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];

/** Rent invoicing, payment schedules, overdue tracking and reminders (Section 4.1.3). */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly configService: ConfigService,
  ) {}

  advanceDays(): number {
    return Number(this.configService.get('INVOICE_ADVANCE_DAYS', 7));
  }

  /** Inserts drafts that don't exist yet. Returns the drafts actually created. */
  async createMissing(client: Tx | PrismaService, agreementId: string, drafts: InvoiceDraft[]): Promise<InvoiceDraft[]> {
    if (!drafts.length) return [];
    const existing = await client.invoice.findMany({
      where: { agreementId },
      select: { type: true, periodStart: true },
    });
    const seen = new Set(existing.map(invoiceKey));
    const missing = drafts.filter((d) => !seen.has(invoiceKey(d)));
    if (!missing.length) return [];
    await client.invoice.createMany({
      data: missing.map((d) => ({ ...d, invoiceNo: generateReference('INV') })),
      skipDuplicates: true,
    });
    return missing;
  }

  /** Called inside the signing transaction: deposit + rent due within the advance window. */
  async generateInitialInvoices(tx: Tx, agreement: AgreementBillingInput, now: Date = new Date()) {
    const drafts = [
      buildDepositInvoiceDraft(agreement),
      ...buildRentInvoiceDrafts(agreement, addDays(now, this.advanceDays())),
    ].filter(Boolean) as InvoiceDraft[];
    // The first rent period is always billed at signing, even when the lease starts later.
    if (!drafts.some((d) => d.type === 'RENT')) {
      drafts.push(...buildRentInvoiceDrafts(agreement, agreement.startDate));
    }
    return this.createMissing(tx, agreement.id, drafts);
  }

  /** Daily job: creates rent invoices for active agreements whose next period is near. */
  async generateDueInvoices(now: Date = new Date()): Promise<number> {
    const agreements = await this.prisma.agreement.findMany({
      where: { status: AgreementStatus.ACTIVE },
      include: { unit: { select: { unitNumber: true } } },
    });
    let created = 0;
    for (const agreement of agreements) {
      const drafts = buildRentInvoiceDrafts(agreement, addDays(now, this.advanceDays()));
      const newDrafts = await this.createMissing(this.prisma, agreement.id, drafts);
      created += newDrafts.length;
      for (const draft of newDrafts) {
        await this.notifications.notify(
          [agreement.tenantId],
          'RENT_DUE',
          { amount: draft.amount, unit: agreement.unit?.unitNumber, dueDate: formatDate(draft.dueDate) },
          { sms: true, data: { agreementId: agreement.id } },
        );
      }
    }
    if (created) this.logger.log(`Generated ${created} rent invoice(s)`);
    return created;
  }

  /** Daily job: flags unpaid invoices past their due date as OVERDUE. */
  async markOverdue(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.invoice.updateMany({
      where: {
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lt: startOfDayUtc(now) },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });
    return result.count;
  }

  /** Daily job: automated SMS / in-app reminders for overdue rent, repeated every N days. */
  async sendOverdueReminders(now: Date = new Date()): Promise<number> {
    const intervalDays = Number(this.configService.get('RENT_REMINDER_INTERVAL_DAYS', 3));
    const threshold = addDays(now, -intervalDays);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.OVERDUE,
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: threshold } }],
      },
      include: { unit: { select: { unitNumber: true } } },
    });
    for (const invoice of invoices) {
      await this.notifications.notify(
        [invoice.tenantId],
        'RENT_OVERDUE',
        { amount: outstandingAmount(invoice), unit: invoice.unit?.unitNumber, dueDate: formatDate(invoice.dueDate) },
        { sms: true, data: { invoiceId: invoice.id } },
      );
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { lastReminderAt: now, reminderCount: { increment: 1 } },
      });
    }
    return invoices.length;
  }

  /**
   * Daily job: one "rent due soon" reminder per unpaid invoice due within 3 days.
   *
   * Keyed off `lastReminderAt` rather than `reminderCount`, because `generateDueInvoices`
   * also bumps that counter when it creates an invoice — so a counter-based filter meant
   * the reminder never fired for invoices the scheduler had just generated, which is
   * exactly the case that matters most.
   */
  async sendUpcomingReminders(now: Date = new Date()): Promise<number> {
    const windowStart = startOfDayUtc(now);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { gte: windowStart, lte: addDays(windowStart, 3) },
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: windowStart } }],
      },
      include: { unit: { select: { unitNumber: true } } },
    });
    for (const invoice of invoices) {
      await this.notifications.notify(
        [invoice.tenantId],
        'RENT_DUE',
        { amount: outstandingAmount(invoice), unit: invoice.unit?.unitNumber, dueDate: formatDate(invoice.dueDate) },
        { sms: true, data: { invoiceId: invoice.id } },
      );
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { lastReminderAt: now, reminderCount: { increment: 1 } },
      });
    }
    return invoices.length;
  }

  /**
   * Daily job: warns the owner as prepaid rent runs out.
   *
   * Reads each active agreement's most recent prepayment and, when the covered period
   * ends within the next 10 days, notifies the owner on the 10/5/3/2/1-day marks. Each
   * mark fires once, because the window is matched against the coverage end date rather
   * than a "has this fired" flag, and the previous mark no longer matches the next day.
   */
  async sendPrepaidExpiryNotices(now: Date = new Date()): Promise<number> {
    const today = startOfDayUtc(now);
    // One month out, then the usual 10/5/3/2/1 day countdown the owner asked for.
    const marks = [30, 10, 5, 3, 2, 1];
    const horizon = addDays(today, Math.max(...marks));

    const coverages = await this.prisma.agreement.findMany({
      where: {
        status: AgreementStatus.ACTIVE,
        payments: { some: { prepaidThrough: { not: null, lte: horizon } } },
      },
      select: {
        id: true,
        ownerId: true,
        unit: { select: { unitNumber: true } },
        payments: {
          where: { prepaidThrough: { not: null, lte: horizon }, status: PaymentStatus.CONFIRMED },
          orderBy: { prepaidThrough: 'desc' },
          take: 1,
          select: { prepaidThrough: true },
        },
      },
    });

    let sent = 0;
    for (const agreement of coverages) {
      const prepaidThrough = agreement.payments[0]?.prepaidThrough;
      if (!prepaidThrough) continue;
      const daysLeft = Math.round((startOfDayUtc(prepaidThrough).getTime() - today.getTime()) / 86_400_000);
      if (!marks.includes(daysLeft)) continue;

      // The daily job can overlap with a manual run, so only send each mark once.
      const alreadySent = await this.prisma.notification.findFirst({
        where: {
          userId: agreement.ownerId,
          type: 'RENT_PREPAID_EXPIRING',
          createdAt: { gte: today },
          data: { path: ['agreementId'], equals: agreement.id },
        },
        select: { id: true },
      });
      if (alreadySent) continue;

      await this.notifications.notifyOwner(
        agreement.ownerId,
        'RENT_PREPAID_EXPIRING',
        {
          unit: agreement.unit?.unitNumber,
          days: String(daysLeft),
          through: formatDate(prepaidThrough),
        },
        { data: { agreementId: agreement.id, prepaidThrough: prepaidThrough.toISOString() } },
      );
      sent += 1;
    }
    return sent;
  }

  buildWhere(user: AuthUser, filter: InvoiceFilterDto): Prisma.InvoiceWhereInput {
    return {
      ...scopeWhere(user),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.agreementId ? { agreementId: filter.agreementId } : {}),
      ...(filter.from || filter.to
        ? {
            dueDate: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
    };
  }

  async findAll(user: AuthUser, filter: InvoiceFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where = this.buildWhere(user, filter);
    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take,
        orderBy: { dueDate: 'desc' },
        include: {
          unit: { select: { id: true, unitNumber: true } },
          property: { select: { id: true, name: true } },
          tenant: { select: { id: true, fullName: true, phoneNumber: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    const docs = invoices.map((i) => ({ ...i, outstanding: outstandingAmount(i) }));
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(user: AuthUser, id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { createdAt: 'desc' } },
        unit: { select: { id: true, unitNumber: true } },
        property: { select: { id: true, name: true } },
        tenant: { select: { id: true, fullName: true, phoneNumber: true } },
        agreement: { select: { id: true, referenceNo: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertCanAccess(user, invoice);
    return { ...invoice, outstanding: outstandingAmount(invoice) };
  }

  /** Owner adds a penalty / other charge to an agreement. */
  async createManual(user: AuthUser, dto: CreateManualInvoiceDto) {
    const ownerId = requireOwnerId(user);
    const agreement = await this.prisma.agreement.findFirst({ where: { id: dto.agreementId, ownerId } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (agreement.status !== AgreementStatus.ACTIVE) throw new BadRequestException('Agreement is not active');
    const dueDate = startOfDayUtc(new Date(dto.dueDate));
    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNo: generateReference('INV'),
        agreementId: agreement.id,
        tenantId: agreement.tenantId,
        ownerId,
        propertyId: agreement.propertyId,
        unitId: agreement.unitId,
        type: dto.type,
        // Unique per (agreement, type, periodStart): use creation timestamp for ad-hoc charges.
        periodStart: new Date(),
        periodEnd: dueDate,
        dueDate,
        amount: roundMoney(dto.amount),
        description: dto.description,
      },
    });
    await this.audit.log(AUDIT_ACTIONS.INVOICE_CREATED, 'Invoice', invoice.id, user, { type: dto.type, amount: dto.amount });
    this.realtime.emitToUsers([agreement.tenantId, ownerId], REALTIME_EVENTS.INVOICE_UPDATED, invoice);
    return invoice;
  }

  async cancel(user: AuthUser, id: string, reason?: string) {
    const ownerId = requireOwnerId(user);
    const invoice = await this.prisma.invoice.findFirst({ where: { id, ownerId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (toNumber(invoice.amountPaid) > 0) throw new BadRequestException('Cannot cancel an invoice with payments');
    if (invoice.status === InvoiceStatus.CANCELLED) return invoice;
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED, description: reason ? `${invoice.description ?? ''} [Cancelled: ${reason}]` : invoice.description },
    });
    await this.audit.log(AUDIT_ACTIONS.INVOICE_CANCELLED, 'Invoice', id, user, { reason });
    this.realtime.emitToUsers([invoice.tenantId, ownerId], REALTIME_EVENTS.INVOICE_UPDATED, updated);
    return updated;
  }

  /** Adds a confirmed payment amount to an invoice and recomputes its status. */
  async applyPayment(tx: Tx, invoiceId: string, amount: number, now: Date = new Date()) {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const amountPaid = roundMoney(toNumber(invoice.amountPaid) + toNumber(amount));
    return tx.invoice.update({
      where: { id: invoiceId },
      data: { amountPaid, status: resolveInvoiceStatus(invoice.amount, amountPaid, invoice.dueDate, now, invoice.status) },
    });
  }

  /** Cancels unpaid future invoices after an agreement ends early. */
  async cancelFutureInvoices(tx: Tx, agreementId: string, after: Date): Promise<number> {
    const result = await tx.invoice.updateMany({
      where: {
        agreementId,
        periodStart: { gt: startOfDayUtc(after) },
        amountPaid: 0,
        status: { in: OPEN_INVOICE_STATUSES },
      },
      data: { status: InvoiceStatus.CANCELLED },
    });
    return result.count;
  }

  /** Full projected payment schedule for an agreement, merged with issued invoices. */
  async getSchedule(user: AuthUser, agreementId: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      include: { invoices: { where: { type: 'RENT' } } },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    assertCanAccess(user, agreement);
    const issued = new Map(agreement.invoices.map((i) => [invoiceKey(i), i]));
    return computeBillingPeriods(agreement.startDate, agreement.endDate, agreement.paymentDueDay).map((period) => {
      const invoice = issued.get(invoiceKey({ type: 'RENT', periodStart: period.periodStart }));
      return {
        ...period,
        amount: invoice ? toNumber(invoice.amount) : prorateRent(agreement.rentAmount, period.periodStart, period.periodEnd),
        invoiceId: invoice?.id ?? null,
        invoiceNo: invoice?.invoiceNo ?? null,
        status: invoice?.status ?? 'SCHEDULED',
        amountPaid: invoice ? toNumber(invoice.amountPaid) : 0,
      };
    });
  }

  /** Outstanding balance per tenant for the owner's portfolio (or the tenant's own balance). */
  async getBalances(user: AuthUser) {
    const invoices = await this.prisma.invoice.findMany({
      where: { ...scopeWhere(user), status: { in: OPEN_INVOICE_STATUSES } },
      include: { tenant: { select: { id: true, fullName: true, phoneNumber: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const byTenant = new Map<string, { tenant: unknown; outstanding: number[]; overdueCount: number; oldestDueDate: Date }>();
    for (const invoice of invoices) {
      const entry = byTenant.get(invoice.tenantId) ?? {
        tenant: invoice.tenant,
        outstanding: [],
        overdueCount: 0,
        oldestDueDate: invoice.dueDate,
      };
      entry.outstanding.push(outstandingAmount(invoice));
      if (invoice.status === InvoiceStatus.OVERDUE) entry.overdueCount++;
      byTenant.set(invoice.tenantId, entry);
    }
    const tenants = [...byTenant.values()].map((e) => ({
      tenant: e.tenant,
      outstanding: sumMoney(e.outstanding),
      overdueCount: e.overdueCount,
      oldestDueDate: e.oldestDueDate,
    }));
    return { totalOutstanding: sumMoney(tenants.map((t) => t.outstanding)), tenants };
  }
}
