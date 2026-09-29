import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgreementStatus, InvoiceStatus, Language, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { isPlatformStaff, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { formatDate } from '../../../common/utils/date.util';
import { roundMoney, sumMoney, toNumber } from '../../../common/utils/money.util';
import { reportLabels } from '../../../common/i18n/messages';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { outstandingAmount } from '../../billing/invoices/utils/billing-period.util';
import { periodBounds } from '../../billing/payouts/payouts.service';
import { resolveMonth } from '../dashboard/dashboard.service';
import { ReportTable, buildExcel, buildPdf, findEthiopicFont } from './utils/report-export.util';
import type { ReportFormat } from './dto/report.dto';

export interface ExportedFile {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

/** Owner statements + exportable reports in Excel and PDF, Amharic or English (4.1.5). */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  resolveOwner(user: AuthUser, ownerId?: string): string {
    if (isPlatformStaff(user)) {
      if (!ownerId) throw new BadRequestException('ownerId is required for platform staff');
      return ownerId;
    }
    return requireOwnerId(user);
  }

  /** Monthly owner statement: income (confirmed payments), expenses, net — total and per property. */
  async ownerStatement(user: AuthUser, month?: string, ownerIdParam?: string) {
    const ownerId = this.resolveOwner(user, ownerIdParam);
    const { start, end } = resolveMonth(month);
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, fullName: true, phoneNumber: true, ownerProfile: { select: { companyName: true } } },
    });
    if (!owner) throw new NotFoundException('Owner not found');
    const [payments, expenses] = await Promise.all([
      this.prisma.payment.findMany({
        where: { ownerId, status: PaymentStatus.CONFIRMED, confirmedAt: { gte: start, lte: end } },
        include: {
          property: { select: { id: true, name: true } },
          tenant: { select: { fullName: true } },
          invoice: { select: { invoiceNo: true, type: true } },
        },
        orderBy: { confirmedAt: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: { ownerId, incurredOn: { gte: start, lte: end } },
        include: { property: { select: { id: true, name: true } } },
        orderBy: { incurredOn: 'asc' },
      }),
    ]);
    const propertyIds = new Set([...payments.map((p) => p.propertyId), ...expenses.map((e) => e.propertyId)]);
    const byProperty = [...propertyIds].map((propertyId) => {
      const income = sumMoney(payments.filter((p) => p.propertyId === propertyId).map((p) => p.amount));
      const expense = sumMoney(expenses.filter((e) => e.propertyId === propertyId).map((e) => e.amount));
      const name = payments.find((p) => p.propertyId === propertyId)?.property.name
        ?? expenses.find((e) => e.propertyId === propertyId)?.property.name;
      return { propertyId, name, income, expenses: expense, net: roundMoney(income - expense) };
    });
    const totalIncome = sumMoney(payments.map((p) => p.amount));
    const totalExpenses = sumMoney(expenses.map((e) => e.amount));
    return {
      owner,
      period: { start, end },
      income: payments.map((p) => ({
        date: p.confirmedAt,
        reference: p.referenceNo,
        property: p.property.name,
        tenant: p.tenant.fullName,
        method: p.method,
        type: p.invoice?.type ?? 'RENT',
        amount: toNumber(p.amount),
      })),
      expenses: expenses.map((e) => ({
        date: e.incurredOn,
        property: e.property.name,
        category: e.category,
        description: e.description,
        amount: toNumber(e.amount),
      })),
      byProperty,
      totals: { income: totalIncome, expenses: totalExpenses, net: roundMoney(totalIncome - totalExpenses) },
    };
  }

  async paymentsReport(user: AuthUser, from?: string, to?: string, ownerIdParam?: string) {
    const ownerId = isPlatformStaff(user) ? ownerIdParam : requireOwnerId(user);
    const { start, end } = periodBounds(from ?? resolveMonth().start, to ?? resolveMonth().end);
    const payments = await this.prisma.payment.findMany({
      where: { ...(ownerId ? { ownerId } : {}), createdAt: { gte: start, lte: end } },
      include: { property: { select: { name: true } }, tenant: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      period: { start, end },
      rows: payments.map((p) => ({
        date: p.confirmedAt ?? p.createdAt,
        reference: p.referenceNo,
        property: p.property.name,
        tenant: p.tenant.fullName,
        method: p.method,
        status: p.status,
        amount: toNumber(p.amount),
      })),
      totalConfirmed: sumMoney(payments.filter((p) => p.status === PaymentStatus.CONFIRMED).map((p) => p.amount)),
    };
  }

  /** Rent roll: every occupied unit with tenant, rent, lease end and outstanding balance. */
  async rentRoll(user: AuthUser, ownerIdParam?: string) {
    const ownerId = this.resolveOwner(user, ownerIdParam);
    const agreements = await this.prisma.agreement.findMany({
      where: { ownerId, status: AgreementStatus.ACTIVE },
      include: {
        property: { select: { name: true } },
        unit: { select: { unitNumber: true } },
        tenant: { select: { fullName: true, phoneNumber: true } },
        invoices: {
          where: { status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } },
          select: { amount: true, amountPaid: true },
        },
      },
      omit: { content: true },
      orderBy: [{ propertyId: 'asc' }],
    });
    const rows = agreements.map((a) => ({
      property: a.property.name,
      unit: a.unit.unitNumber,
      tenant: a.tenant.fullName,
      phone: a.tenant.phoneNumber,
      rent: toNumber(a.rentAmount),
      leaseEnd: a.endDate,
      outstanding: sumMoney(a.invoices.map(outstandingAmount)),
    }));
    return { rows, totalRent: sumMoney(rows.map((r) => r.rent)), totalOutstanding: sumMoney(rows.map((r) => r.outstanding)) };
  }

  /** Renders report tables to xlsx or pdf; Amharic PDFs fall back to English labels when no Ethiopic font exists. */
  async render(tables: ReportTable[], format: ReportFormat, baseName: string, lang: Language): Promise<ExportedFile> {
    if (format === 'xlsx') {
      return {
        buffer: await buildExcel(tables),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `${baseName}.xlsx`,
      };
    }
    const font = lang === Language.AM ? findEthiopicFont(this.configService.get<string>('PDF_FONT_ETHIOPIC')) : null;
    if (lang === Language.AM && !font) this.logger.warn('No Ethiopic font found — Amharic PDF text may not render');
    return { buffer: await buildPdf(tables, font), contentType: 'application/pdf', fileName: `${baseName}.pdf` };
  }

  async exportOwnerStatement(user: AuthUser, month: string | undefined, format: ReportFormat, lang: Language, ownerId?: string) {
    const statement = await this.ownerStatement(user, month, ownerId);
    const L = reportLabels(lang);
    const period = `${L.period}: ${formatDate(statement.period.start)} – ${formatDate(statement.period.end)} · ${L.owner}: ${statement.owner.fullName}`;
    const tables: ReportTable[] = [
      {
        title: `${L.ownerStatement} — ${L.income}`,
        subtitle: period,
        columns: [
          { key: 'date', header: L.date, width: 12 },
          { key: 'reference', header: L.reference, width: 22 },
          { key: 'property', header: L.property, width: 22 },
          { key: 'tenant', header: L.tenant, width: 20 },
          { key: 'method', header: L.method, width: 14 },
          { key: 'amount', header: L.amount, width: 14, numeric: true },
        ],
        rows: statement.income,
        summary: [{ label: L.income, value: statement.totals.income }],
      },
      {
        title: `${L.ownerStatement} — ${L.expenses}`,
        subtitle: period,
        columns: [
          { key: 'date', header: L.date, width: 12 },
          { key: 'property', header: L.property, width: 22 },
          { key: 'category', header: L.category, width: 16 },
          { key: 'description', header: L.description, width: 34 },
          { key: 'amount', header: L.amount, width: 14, numeric: true },
        ],
        rows: statement.expenses,
        summary: [
          { label: L.income, value: statement.totals.income },
          { label: L.expenses, value: statement.totals.expenses },
          { label: L.net, value: statement.totals.net },
        ],
      },
    ];
    const month_ = formatDate(statement.period.start).slice(0, 7);
    return this.render(tables, format, `owner-statement-${month_}`, lang);
  }

  async exportPayments(user: AuthUser, from: string | undefined, to: string | undefined, format: ReportFormat, lang: Language, ownerId?: string) {
    const report = await this.paymentsReport(user, from, to, ownerId);
    const L = reportLabels(lang);
    return this.render(
      [
        {
          title: L.paymentsReport,
          subtitle: `${L.period}: ${formatDate(report.period.start)} – ${formatDate(report.period.end)}`,
          columns: [
            { key: 'date', header: L.date, width: 12 },
            { key: 'reference', header: L.reference, width: 22 },
            { key: 'property', header: L.property, width: 20 },
            { key: 'tenant', header: L.tenant, width: 20 },
            { key: 'method', header: L.method, width: 14 },
            { key: 'status', header: L.status, width: 12 },
            { key: 'amount', header: L.amount, width: 14, numeric: true },
          ],
          rows: report.rows,
          summary: [{ label: L.amount, value: report.totalConfirmed }],
        },
      ],
      format,
      'payments-report',
      lang,
    );
  }

  async exportRentRoll(user: AuthUser, format: ReportFormat, lang: Language, ownerId?: string) {
    const report = await this.rentRoll(user, ownerId);
    const L = reportLabels(lang);
    return this.render(
      [
        {
          title: L.rentRoll,
          subtitle: `${L.generatedAt}: ${formatDate(new Date())}`,
          columns: [
            { key: 'property', header: L.property, width: 22 },
            { key: 'unit', header: L.unit, width: 10 },
            { key: 'tenant', header: L.tenant, width: 22 },
            { key: 'rent', header: L.rent, width: 14, numeric: true },
            { key: 'leaseEnd', header: L.leaseEnd, width: 12 },
            { key: 'outstanding', header: L.outstanding, width: 14, numeric: true },
          ],
          rows: report.rows,
          summary: [
            { label: L.rent, value: report.totalRent },
            { label: L.outstanding, value: report.totalOutstanding },
          ],
        },
      ],
      format,
      'rent-roll',
      lang,
    );
  }
}
