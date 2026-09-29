import {
  buildDepositInvoiceDraft, buildRentInvoiceDrafts, computeBillingPeriods, computeDueDate, daysInMonth, invoiceKey,
  lastDayOfMonth, outstandingAmount, prorateRent, resolveInvoiceStatus,
} from './billing-period.util';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const agreement = {
  id: 'a', tenantId: 't', ownerId: 'o', propertyId: 'p', unitId: 'u',
  startDate: d('2026-10-15'), endDate: d('2027-01-14'), rentAmount: 31000, depositAmount: 62000, paymentDueDay: 5,
};

describe('billing-period.util', () => {
  it('lastDayOfMonth / daysInMonth handle leap years', () => {
    expect(iso(lastDayOfMonth(d('2028-02-10')))).toBe('2028-02-29');
    expect(daysInMonth(d('2026-02-01'))).toBe(28);
  });

  it('computeDueDate clamps to the period and the 1–28 range', () => {
    expect(iso(computeDueDate(d('2026-11-01'), d('2026-11-30'), 5))).toBe('2026-11-05');
    expect(iso(computeDueDate(d('2026-10-15'), d('2026-10-31'), 5))).toBe('2026-10-15');
    expect(iso(computeDueDate(d('2027-01-01'), d('2027-01-03'), 20))).toBe('2027-01-03');
    expect(iso(computeDueDate(d('2026-11-01'), d('2026-11-30'), 31))).toBe('2026-11-28');
    expect(iso(computeDueDate(d('2026-11-01'), d('2026-11-30'), 0))).toBe('2026-11-01');
  });

  it('computeBillingPeriods splits the lease into calendar months, partial at the ends', () => {
    const periods = computeBillingPeriods(agreement.startDate, agreement.endDate, 5);
    expect(periods.map((p) => [iso(p.periodStart), iso(p.periodEnd), iso(p.dueDate)])).toEqual([
      ['2026-10-15', '2026-10-31', '2026-10-15'],
      ['2026-11-01', '2026-11-30', '2026-11-05'],
      ['2026-12-01', '2026-12-31', '2026-12-05'],
      ['2027-01-01', '2027-01-14', '2027-01-05'],
    ]);
    expect(computeBillingPeriods(agreement.startDate, agreement.endDate, 5, d('2026-11-10'))).toHaveLength(2);
  });

  it('prorateRent charges full months fully and partial months by day', () => {
    expect(prorateRent(31000, d('2026-11-01'), d('2026-11-30'))).toBe(31000);
    expect(prorateRent(31000, d('2026-10-15'), d('2026-10-31'))).toBe(17000);
  });

  it('outstandingAmount never goes negative', () => {
    expect(outstandingAmount({ amount: 100, amountPaid: 40 })).toBe(60);
    expect(outstandingAmount({ amount: 100, amountPaid: 150 })).toBe(0);
  });

  it('resolveInvoiceStatus derives PAID / OVERDUE / PARTIALLY_PAID / UNPAID / CANCELLED', () => {
    const now = d('2026-11-10');
    expect(resolveInvoiceStatus(100, 100, d('2026-11-01'), now)).toBe('PAID');
    expect(resolveInvoiceStatus(100, 50, d('2026-11-01'), now)).toBe('OVERDUE');
    expect(resolveInvoiceStatus(100, 50, d('2026-11-20'), now)).toBe('PARTIALLY_PAID');
    expect(resolveInvoiceStatus(100, 0, d('2026-11-20'), now)).toBe('UNPAID');
    expect(resolveInvoiceStatus(100, 100, d('2026-11-01'), now, 'CANCELLED')).toBe('CANCELLED');
  });

  it('buildRentInvoiceDrafts creates prorated RENT drafts', () => {
    const drafts = buildRentInvoiceDrafts(agreement, d('2026-11-01'));
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ type: 'RENT', amount: 17000, agreementId: 'a', tenantId: 't', currency: 'ETB' });
    expect(drafts[1].amount).toBe(31000);
  });

  it('buildDepositInvoiceDraft is due at lease start, null without deposit', () => {
    expect(buildDepositInvoiceDraft(agreement)).toMatchObject({ type: 'DEPOSIT', amount: 62000, dueDate: d('2026-10-15') });
    expect(buildDepositInvoiceDraft({ ...agreement, depositAmount: 0 })).toBeNull();
  });

  it('invoiceKey matches the DB uniqueness (type + period start day)', () => {
    expect(invoiceKey({ type: 'RENT', periodStart: new Date('2026-10-15T13:00:00Z') })).toBe('RENT:2026-10-15T00:00:00.000Z');
  });
});
