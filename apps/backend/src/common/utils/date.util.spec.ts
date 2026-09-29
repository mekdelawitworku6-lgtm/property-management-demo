import {
  addDays, addMonths, daysBetween, endOfMonthUtc, formatDate, parseMonth, startOfDayUtc, startOfMonthUtc,
} from './date.util';

const d = (s: string) => new Date(s);

describe('date.util', () => {
  it('startOfDayUtc truncates the time', () => {
    expect(startOfDayUtc(d('2026-09-29T15:30:00Z')).toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });

  it('addDays handles month boundaries and negatives', () => {
    expect(addDays(d('2026-09-30T00:00:00Z'), 1).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(addDays(d('2026-10-01T00:00:00Z'), -1).toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('addMonths clamps to the last day of shorter months', () => {
    expect(addMonths(d('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths(d('2026-10-01T00:00:00Z'), 12).toISOString()).toBe('2027-10-01T00:00:00.000Z');
  });

  it('startOfMonthUtc / endOfMonthUtc', () => {
    expect(startOfMonthUtc(d('2026-09-15T00:00:00Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(endOfMonthUtc(d('2026-02-10T00:00:00Z')).toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('parseMonth validates YYYY-MM', () => {
    expect(parseMonth('2026-09')).toEqual({ start: d('2026-09-01T00:00:00Z'), end: d('2026-09-30T23:59:59.999Z') });
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });

  it('daysBetween counts whole days', () => {
    expect(daysBetween(d('2026-09-01T23:00:00Z'), d('2026-09-03T01:00:00Z'))).toBe(2);
  });

  it('formatDate returns YYYY-MM-DD or empty', () => {
    expect(formatDate(d('2026-09-29T12:00:00Z'))).toBe('2026-09-29');
    expect(formatDate(null)).toBe('');
  });
});
