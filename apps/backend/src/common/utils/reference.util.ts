import { randomBytes } from 'crypto';

/** Human-readable unique reference, e.g. AGR-20260929-7F3K9Q. */
export function generateReference(prefix: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `${prefix}-${y}${m}${d}-${suffix}`;
}
