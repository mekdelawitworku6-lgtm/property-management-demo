/** Accepts number | string | Prisma.Decimal and returns a JS number. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  const maybe = value as { toNumber?: () => number };
  if (typeof maybe.toNumber === 'function') return maybe.toNumber();
  return Number(value) || 0;
}

/** Rounds to 2 decimal places (banker-safe enough for ETB cents). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sumMoney(values: unknown[]): number {
  return roundMoney(values.reduce<number>((acc, v) => acc + toNumber(v), 0));
}

export function percentOf(amount: number, percent: number): number {
  return roundMoney((toNumber(amount) * toNumber(percent)) / 100);
}

/** Safe percentage (0 when denominator is 0), rounded to 1 decimal. */
export function ratioPercent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
