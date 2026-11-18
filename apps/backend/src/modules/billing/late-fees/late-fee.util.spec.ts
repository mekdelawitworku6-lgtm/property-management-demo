import { InvoiceStatus, InvoiceType, LateFeeFrequency, LateFeeType } from '@prisma/client';
import { daysBetween } from '../../../common/utils/date.util';
import {
  capForBalance,
  computeLateFee,
  cyclesForLateness,
  cycleDueDate,
  feeForCycle,
} from './late-fee.util';

/**
 * A fixed "today" at midnight so the lateness arithmetic is deterministic. `daysAgo`
 * returns midnights too, because lateness is measured in whole days and a time of day
 * would otherwise shift the boundary.
 */
const TODAY = new Date('2026-06-30T00:00:00.000Z');

function daysAgo(n: number): Date {
  return new Date(TODAY.getTime() - n * 86_400_000);
}

const percentRule = {
  type: LateFeeType.PERCENT,
  value: 5,
  gracePeriodDays: 5,
  frequency: LateFeeFrequency.PER_MONTH,
  maxPercentOfBalance: 50,
};

const flatRule = {
  type: LateFeeType.FLAT,
  value: 500,
  gracePeriodDays: 3,
  frequency: LateFeeFrequency.ONCE,
  maxPercentOfBalance: null,
};

const target = (outstanding: number, daysLate: number) => ({
  outstanding,
  dueDate: daysAgo(daysLate),
  now: TODAY,
});

describe('daysBetween', () => {
  it('counts whole days regardless of time of day', () => {
    expect(daysBetween(new Date('2026-06-01T23:59:00Z'), new Date('2026-06-02T00:01:00Z'))).toBe(1);
  });

  it('is zero for the same day', () => {
    expect(daysBetween(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T23:00:00Z'))).toBe(0);
  });
});

describe('cyclesForLateness', () => {
  it('charges nothing inside the grace period', () => {
    expect(cyclesForLateness(0, LateFeeFrequency.PER_WEEK)).toBe(0);
    expect(cyclesForLateness(-3, LateFeeFrequency.ONCE)).toBe(0);
  });

  it('charges a single cycle for ONCE however late the payment is', () => {
    expect(cyclesForLateness(1, LateFeeFrequency.ONCE)).toBe(1);
    expect(cyclesForLateness(400, LateFeeFrequency.ONCE)).toBe(1);
  });

  it('charges once per started week', () => {
    expect(cyclesForLateness(6, LateFeeFrequency.PER_WEEK)).toBe(0);
    expect(cyclesForLateness(7, LateFeeFrequency.PER_WEEK)).toBe(1);
    expect(cyclesForLateness(13, LateFeeFrequency.PER_WEEK)).toBe(1);
    expect(cyclesForLateness(14, LateFeeFrequency.PER_WEEK)).toBe(2);
  });

  it('charges once per started month', () => {
    expect(cyclesForLateness(30, LateFeeFrequency.PER_MONTH)).toBe(1);
    expect(cyclesForLateness(31, LateFeeFrequency.PER_MONTH)).toBe(2);
    expect(cyclesForLateness(60, LateFeeFrequency.PER_MONTH)).toBe(2);
    expect(cyclesForLateness(61, LateFeeFrequency.PER_MONTH)).toBe(3);
  });
});

describe('feeForCycle', () => {
  it('takes a percentage of the unpaid balance', () => {
    expect(feeForCycle(percentRule, 10_000)).toBe(500);
  });

  it('charges a flat amount regardless of the balance', () => {
    expect(feeForCycle(flatRule, 10_000)).toBe(500);
    expect(feeForCycle(flatRule, 40_000)).toBe(500);
  });

  it('charges nothing on a settled or zero-value balance', () => {
    expect(feeForCycle(percentRule, 0)).toBe(0);
  });
});

describe('capForBalance', () => {
  it('is a share of the unpaid balance', () => {
    expect(capForBalance(percentRule, 10_000)).toBe(5_000);
  });

  it('is uncapped when not set', () => {
    expect(capForBalance(flatRule, 10_000)).toBeNull();
  });
});

describe('computeLateFee', () => {
  it('charges nothing before the grace period ends', () => {
    const result = computeLateFee(percentRule, target(10_000, 3));
    expect(result.amount).toBe(0);
    expect(result.newCycles).toBe(0);
    expect(result.daysLate).toBe(3);
  });

  it('charges on the first day past the grace period', () => {
    // 6 days late with a 5-day grace = 1 day past grace.
    const result = computeLateFee(percentRule, target(10_000, 6));
    expect(result.daysPastGrace).toBe(1);
    expect(result.newCycles).toBe(1);
    expect(result.amount).toBe(500);
  });

  it('only bills the cycles that are newly due', () => {
    // 66 days late on a monthly rule with a 5-day grace = 61 days past grace = 3 cycles;
    // 2 already billed, so only the third is due now.
    const result = computeLateFee(percentRule, target(10_000, 66), 2);
    expect(result.cycles).toBe(3);
    expect(result.newCycles).toBe(1);
    expect(result.amount).toBe(500);
  });

  it('charges nothing extra when every cycle is already billed', () => {
    const result = computeLateFee(percentRule, target(10_000, 66), 3);
    expect(result.newCycles).toBe(0);
    expect(result.amount).toBe(0);
  });

  it('never exceeds the cap as a share of the balance', () => {
    // 5% of 10,000 = 500/cycle, capped at 50% = 5,000, so 10 cycles hits the ceiling.
    const result = computeLateFee(percentRule, target(10_000, 500), 0);
    expect(result.amount).toBe(5_000);
    expect(result.capApplied).toBe(5_000);
  });

  it('honours a zero-day grace period', () => {
    const result = computeLateFee({ ...percentRule, gracePeriodDays: 0 }, target(10_000, 0));
    expect(result.amount).toBe(0);
    const tomorrow = computeLateFee({ ...percentRule, gracePeriodDays: 0 }, target(10_000, 1));
    expect(tomorrow.amount).toBe(500);
  });

  it('treats a fully paid invoice as nothing to charge', () => {
    expect(computeLateFee(percentRule, target(0, 40)).amount).toBe(0);
  });
});

describe('cycleDueDate', () => {
  it('dates the first monthly cycle one day past the grace period', () => {
    const due = new Date('2026-06-01T00:00:00.000Z');
    expect(cycleDueDate(percentRule, due, 1).toISOString().slice(0, 10)).toBe('2026-06-07');
  });

  it('spaces weekly cycles seven days apart', () => {
    const weekly = { ...percentRule, frequency: LateFeeFrequency.PER_WEEK };
    const due = new Date('2026-06-01T00:00:00.000Z');
    expect(cycleDueDate(weekly, due, 1).toISOString().slice(0, 10)).toBe('2026-06-07');
    expect(cycleDueDate(weekly, due, 2).toISOString().slice(0, 10)).toBe('2026-06-14');
  });

  it('dates a one-off charge one day past the grace period', () => {
    const once = { ...flatRule, gracePeriodDays: 3 };
    const due = new Date('2026-06-01T00:00:00.000Z');
    expect(cycleDueDate(once, due, 1).toISOString().slice(0, 10)).toBe('2026-06-05');
  });
});

describe('integration shape', () => {
  it('produces rows the invoice model can store', () => {
    const result = computeLateFee(percentRule, target(20_000, 40));
    expect(result).toMatchObject({ cycles: 2, feePerCycle: 1_000, newCycles: 2, amount: 2_000 });
    expect(InvoiceType.PENALTY).toBe('PENALTY');
    expect(InvoiceStatus.OVERDUE).toBe('OVERDUE');
  });
});
