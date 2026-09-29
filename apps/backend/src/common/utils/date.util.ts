/** Date helpers operating in UTC so billing periods are timezone-stable. */

export function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Adds months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(day, lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()),
  );
}

export function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

/** Parses "YYYY-MM" into the month's [start, end]. Returns null for invalid input. */
export function parseMonth(month: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month ?? '');
  if (!match) return null;
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return { start, end: endOfMonthUtc(start) };
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((startOfDayUtc(to).getTime() - startOfDayUtc(from).getTime()) / 86_400_000);
}

export function formatDate(date: Date): string {
  return date ? new Date(date).toISOString().slice(0, 10) : '';
}
