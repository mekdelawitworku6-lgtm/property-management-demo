import { Prisma } from '@prisma/client';
import { percentOf, ratioPercent, roundMoney, sumMoney, toNumber } from './money.util';

describe('money.util', () => {
  it('toNumber handles numbers, strings, Decimals and empties', () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber('7.5')).toBe(7.5);
    expect(toNumber(new Prisma.Decimal('3.25'))).toBe(3.25);
    expect(toNumber(null)).toBe(0);
    expect(toNumber('')).toBe(0);
    expect(toNumber('abc')).toBe(0);
  });

  it('roundMoney rounds to cents', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.344)).toBe(2.34);
  });

  it('sumMoney adds mixed values', () => {
    expect(sumMoney([1.1, '2.2', new Prisma.Decimal('3.3'), null])).toBe(6.6);
  });

  it('percentOf computes percentage amounts', () => {
    expect(percentOf(15000, 2)).toBe(300);
  });

  it('ratioPercent is safe for zero denominators', () => {
    expect(ratioPercent(1, 3)).toBe(33.3);
    expect(ratioPercent(5, 0)).toBe(0);
  });
});
