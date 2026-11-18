import { InvoiceStatus, InvoiceType } from '@prisma/client';
import { addDays, daysBetween, startOfDayUtc } from '../../../../common/utils/date.util';
import { roundMoney, toNumber } from '../../../../common/utils/money.util';

export interface BillingPeriod {
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
}

/** Last calendar day of the date's month (UTC midnight). */
export function lastDayOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function daysInMonth(date: Date): number {
  return lastDayOfMonth(date).getUTCDate();
}

/**
 * Due date for a period: the agreement's paymentDueDay in the period's month,
 * clamped inside [periodStart, periodEnd]. Due days are limited to 1–28.
 */
export function computeDueDate(periodStart: Date, periodEnd: Date, paymentDueDay: number): Date {
  const day = Math.min(28, Math.max(1, Math.floor(paymentDueDay || 1)));
  const candidate = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), day));
  if (candidate < periodStart) return periodStart;
  if (candidate > periodEnd) return periodEnd;
  return candidate;
}

/**
 * Calendar-month billing periods covering the lease. The first and last periods are partial
 * when the lease does not start on the 1st / end on the last day of a month.
 * Only periods starting on or before `upTo` are returned.
 */
export function computeBillingPeriods(
  startDate: Date,
  endDate: Date,
  paymentDueDay: number,
  upTo: Date = endDate,
): BillingPeriod[] {
  const periods: BillingPeriod[] = [];
  const end = startOfDayUtc(endDate);
  const limit = startOfDayUtc(upTo);
  let cursor = startOfDayUtc(startDate);
  while (cursor <= end && cursor <= limit) {
    const monthEnd = lastDayOfMonth(cursor);
    const periodEnd = monthEnd < end ? monthEnd : end;
    periods.push({ periodStart: cursor, periodEnd, dueDate: computeDueDate(cursor, periodEnd, paymentDueDay) });
    cursor = addDays(periodEnd, 1);
  }
  return periods;
}

/** Monthly rent prorated by days for partial months. */
export function prorateRent(monthlyRent: unknown, periodStart: Date, periodEnd: Date): number {
  const rent = toNumber(monthlyRent);
  const days = daysBetween(periodStart, periodEnd) + 1;
  const monthDays = daysInMonth(periodStart);
  if (days >= monthDays) return roundMoney(rent);
  return roundMoney((rent * days) / monthDays);
}

export function outstandingAmount(invoice: { amount: unknown; amountPaid: unknown }): number {
  return Math.max(0, roundMoney(toNumber(invoice.amount) - toNumber(invoice.amountPaid)));
}

/** Derives the invoice status from amounts and due date. */
export function resolveInvoiceStatus(
  amount: unknown,
  amountPaid: unknown,
  dueDate: Date,
  now: Date = new Date(),
  current?: InvoiceStatus,
): InvoiceStatus {
  if (current === InvoiceStatus.CANCELLED) return InvoiceStatus.CANCELLED;
  const total = toNumber(amount);
  const paid = toNumber(amountPaid);
  if (paid >= total && total > 0) return InvoiceStatus.PAID;
  if (startOfDayUtc(dueDate) < startOfDayUtc(now)) return InvoiceStatus.OVERDUE;
  if (paid > 0) return InvoiceStatus.PARTIALLY_PAID;
  return InvoiceStatus.UNPAID;
}

export interface AgreementBillingInput {
  id: string;
  tenantId: string;
  ownerId: string;
  propertyId: string;
  unitId: string;
  startDate: Date;
  endDate: Date;
  rentAmount: unknown;
  depositAmount: unknown;
  paymentDueDay: number;
  currency?: string;
}

export interface InvoiceDraft {
  agreementId: string;
  tenantId: string;
  ownerId: string;
  propertyId: string;
  unitId: string;
  type: InvoiceType;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  amount: number;
  currency: string;
  description: string;
}

/** Rent invoice drafts for all periods starting on or before `upTo`. */
export function buildRentInvoiceDrafts(agreement: AgreementBillingInput, upTo: Date): InvoiceDraft[] {
  return computeBillingPeriods(agreement.startDate, agreement.endDate, agreement.paymentDueDay, upTo).map((p) => ({
    agreementId: agreement.id,
    tenantId: agreement.tenantId,
    ownerId: agreement.ownerId,
    propertyId: agreement.propertyId,
    unitId: agreement.unitId,
    type: InvoiceType.RENT,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    dueDate: p.dueDate,
    amount: prorateRent(agreement.rentAmount, p.periodStart, p.periodEnd),
    currency: agreement.currency ?? 'ETB',
    description: `Rent ${p.periodStart.toISOString().slice(0, 10)} – ${p.periodEnd.toISOString().slice(0, 10)}`,
  }));
}

/** Security-deposit draft (null when the agreement has no deposit). Due on the lease start date. */
export function buildDepositInvoiceDraft(agreement: AgreementBillingInput): InvoiceDraft | null {
  const deposit = roundMoney(toNumber(agreement.depositAmount));
  if (deposit <= 0) return null;
  const start = startOfDayUtc(agreement.startDate);
  return {
    agreementId: agreement.id,
    tenantId: agreement.tenantId,
    ownerId: agreement.ownerId,
    propertyId: agreement.propertyId,
    unitId: agreement.unitId,
    type: InvoiceType.DEPOSIT,
    periodStart: start,
    periodEnd: start,
    dueDate: start,
    amount: deposit,
    currency: agreement.currency ?? 'ETB',
    description: 'Security deposit',
  };
}

/** Unique key matching the DB constraint (agreementId, type, periodStart). */
export function invoiceKey(draft: { type: InvoiceType; periodStart: Date }): string {
  return `${draft.type}:${startOfDayUtc(draft.periodStart).toISOString()}`;
}

/** A rent invoice a prepayment is allowed to settle, ordered oldest period first. */
export interface SettleableInvoice {
  id: string;
  invoiceNo: string;
  periodStart: Date;
  periodEnd: Date;
  /** Prisma Decimal or number — both are handled by `toNumber`. */
  amount: unknown;
  amountPaid: unknown;
}

/** What one payment ended up doing: invoices it closed, months covered, leftover credit. */
export interface AllocationResult {
  allocations: { invoiceId: string; invoiceNo: string; amount: number; periodEnd: Date }[];
  /** Rent periods fully or partly settled by this payment. */
  monthsCovered: number;
  /** Cash left after every due invoice was settled — carried as credit. */
  credit: number;
  /** Last day rent stays covered, or null when the payment did not reach a future period. */
  prepaidThrough: Date | null;
}

/**
 * Spreads one payment across an agreement's invoices oldest-first, which is what makes
 * prepayment work: paying 3 months at once settles the current invoice and then carries
 * the surplus forward until the money runs out, leaving any remainder as credit.
 *
 * Only invoices that are genuinely still owed are considered, so a payment can never
 * overpay an invoice and status stays derived from the amounts.
 */
export function allocatePayment(invoices: SettleableInvoice[], amount: number): AllocationResult {
  const allocations: AllocationResult['allocations'] = [];
  const settled = new Set<string>();
  let remaining = roundMoney(amount);
  let monthsCovered = 0;
  let prepaidThrough: Date | null = null;

  const ordered = [...invoices].sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime() || a.periodEnd.getTime() - b.periodEnd.getTime(),
  );

  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const due = roundMoney(toNumber(invoice.amount) - toNumber(invoice.amountPaid));
    if (due <= 0) continue;

    const applied = roundMoney(Math.min(due, remaining));
    remaining = roundMoney(remaining - applied);
    if (settled.has(invoice.id)) continue;
    settled.add(invoice.id);
    allocations.push({
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      amount: applied,
      periodEnd: invoice.periodEnd,
    });
    if (applied > 0) {
      monthsCovered += 1;
      if (!prepaidThrough || invoice.periodEnd > prepaidThrough) prepaidThrough = invoice.periodEnd;
    }
  }

  return { allocations, monthsCovered, credit: Math.max(0, remaining), prepaidThrough };
}

/**
 * How much of an invoice a payment covered, ignoring how many invoices it touched.
 * Used to tell "settled the bill" apart from "prepaid future rent".
 */
export function isPrepayment(result: AllocationResult, singleInvoiceOutstanding: number, requested?: number): boolean {
  if (!Number.isFinite(singleInvoiceOutstanding) || singleInvoiceOutstanding <= 0) return result.monthsCovered > 1;
  if (result.credit > 0) return true;
  return requested !== undefined && requested > singleInvoiceOutstanding + 0.009;
}
