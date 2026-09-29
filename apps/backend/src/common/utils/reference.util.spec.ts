import { generateReference } from './reference.util';

describe('generateReference', () => {
  it('formats PREFIX-YYYYMMDD-XXXXXX and is unique', () => {
    const ref = generateReference('AGR', new Date('2026-09-29T10:00:00Z'));
    expect(ref).toMatch(/^AGR-20260929-[0-9A-F]{6}$/);
    expect(generateReference('AGR')).not.toBe(generateReference('AGR'));
  });
});
