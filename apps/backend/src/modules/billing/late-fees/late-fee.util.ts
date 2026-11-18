/**
 * Late-fee arithmetic, kept free of Prisma so it can be unit tested directly.
 *
 * The rules this implements:
 *  - nothing is charged during the grace period after the due date
 *  - ONCE charges a single fee no matter how late the payment is
 *  - PER_WEEK / PER_MONTH charge once per started week / month of lateness
 *  - the fee is a percentage of the still-unpaid balance, or a flat amount
 *  - the total can never exceed `maxPercentOfBalance` of that balance
 *  - already-charged cycles are never charged again, so the total is a running figure
 */
import type { LateFeeFrequency, LateFeeType } from '@prisma/client';
import { roundMoney, toNumber } from '../../../common/utils/money.util';
import { daysBetween, addDays, startOfDayUtc } from '../../../common/utils/date.util';

export interface LateFeeRuleInput {
  type: LateFeeType;
  value: unknown;
  gracePeriodDays: number;
  frequency: LateFeeFrequency;
  maxPercentOfBalance: unknown;
}

export interface LateFeeTarget {
  /** Still unpaid on the invoice right now. */
  outstanding: number;
  /** Midnight of the due date. */
  dueDate: Date;
  /** Defaults to the wall clock; pass it explicitly so runs are reproducible. */
  now?: Date;
}

export interface LateFeeResult {
  /** Cycles that are due and not yet charged. */
  cycles: number;
  /** What a single cycle costs. */
  feePerCycle: number;
  /** Cycles charged right now (0 when nothing new is due). */
  newCycles: number;
  /** Total to bill across the new cycles, after the cap. */
  amount: number;
  /** The cap that was applied, or null when uncapped. */
  capApplied: number | null;
  daysLate: number;
  daysPastGrace: number;
}

/**
 * How many charges are owed for a given lateness.
 *  - ONCE     -> 1
 *  - PER_WEEK -> one per started week past the grace period
 *  - PER_MONTH-> one per started month past the grace period
 */
export function cyclesForLateness(daysPastGrace: number, frequency: LateFeeFrequency): number {
  if (daysPastGrace <= 0) return 0;
  switch (frequency) {
    case 'ONCE':
      return 1;
    case 'PER_WEEK':
      return Math.floor(daysPastGrace / 7);
    case 'PER_MONTH':
      // A started month: 1 cycle on day 1 past grace, the next on day 31, and so on.
      return Math.floor((daysPastGrace - 1) / 30) + 1;
    default:
      return 0;
  }
}

/** A single cycle's fee: a share of the balance, or a flat amount. */
export function feeForCycle(rule: LateFeeRuleInput, outstanding: number): number {
  const value = toNumber(rule.value);
  if (outstanding <= 0 || value <= 0) return 0;
  if (rule.type === 'FLAT') return roundMoney(value);
  return roundMoney((outstanding * value) / 100);
}

/**
 * The ceiling: a percentage of the outstanding balance, applied to the *total* owed so
 * far. Without it a PER_WEEK rule would eventually charge far more than the rent.
 */
export function capForBalance(rule: LateFeeRuleInput, outstanding: number): number | null {
  const maxPercent = rule.maxPercentOfBalance === null || rule.maxPercentOfBalance === undefined
    ? null
    : toNumber(rule.maxPercentOfBalance);
  if (maxPercent === null || maxPercent <= 0) return null;
  return roundMoney((outstanding * maxPercent) / 100);
}

export function computeLateFee(
  rule: LateFeeRuleInput,
  target: LateFeeTarget,
  alreadyChargedCycles = 0,
): LateFeeResult {
  const daysLate = daysBetween(target.dueDate, target.now ?? new Date());
  const daysPastGrace = daysLate - Math.max(0, rule.gracePeriodDays);
  const cycles = cyclesForLateness(daysPastGrace, rule.frequency);
  const newCycles = Math.max(0, cycles - alreadyChargedCycles);
  const feePerCycle = feeForCycle(rule, target.outstanding);
  const cap = capForBalance(rule, target.outstanding);

  let amount = roundMoney(feePerCycle * newCycles);
  let capApplied: number | null = null;
  if (cap !== null && amount > cap) {
    amount = cap;
    capApplied = cap;
  }

  return {
    cycles,
    feePerCycle,
    newCycles,
    amount: newCycles > 0 ? amount : 0,
    capApplied,
    daysLate,
    daysPastGrace,
  };
}

/** The day cycle `cycle` became chargeable, used to date the generated penalty invoice. */
export function cycleDueDate(rule: LateFeeRuleInput, dueDate: Date, cycle: number): Date {
  const grace = Math.max(0, rule.gracePeriodDays);
  const offset =
    rule.frequency === 'PER_WEEK'
      ? grace + (cycle - 1) * 7 + 1
      : rule.frequency === 'PER_MONTH'
        ? grace + (cycle - 1) * 30 + 1
        : grace + 1;
  return addDays(startOfDayUtc(dueDate), offset);
}

/** Human-readable summary used in the generated invoice description and in the UI. */
export function describeLateFee(
  rule: LateFeeRuleInput,
  result: LateFeeResult,
  label: string,
): string {
  const per = rule.type === 'FLAT'
    ? `${toNumber(rule.value)} ETB`
    : `${toNumber(rule.value)}% of the unpaid balance`;
  const cadence = rule.frequency === 'ONCE'
    ? 'a single charge'
    : rule.frequency === 'PER_WEEK'
      ? 'charged every week late'
      : 'charged every month late';
  return `${label}: ${per}, ${cadence}. ${result.daysLate} day(s) past due, ${result.daysPastGrace} past the ${rule.gracePeriodDays}-day grace period.`;
}
