import { isValidEthiopianPhone, maskPhone, normalizeEthiopianPhone } from './phone.util';

describe('phone.util', () => {
  it.each([
    ['0911223344', '+251911223344'],
    ['911223344', '+251911223344'],
    ['+251 911 22 33 44', '+251911223344'],
    ['251711223344', '+251711223344'],
    ['0711223344', '+251711223344'],
  ])('normalizeEthiopianPhone(%s) → %s', (input, expected) => {
    expect(normalizeEthiopianPhone(input)).toBe(expected);
  });

  it('rejects invalid numbers', () => {
    expect(normalizeEthiopianPhone('0811223344')).toBeNull();
    expect(normalizeEthiopianPhone('12345')).toBeNull();
    expect(normalizeEthiopianPhone('')).toBeNull();
  });

  it('isValidEthiopianPhone mirrors normalize', () => {
    expect(isValidEthiopianPhone('0911223344')).toBe(true);
    expect(isValidEthiopianPhone('abc')).toBe(false);
  });

  it('maskPhone hides the middle digits', () => {
    expect(maskPhone('+251911223344')).toBe('+251911***344');
    expect(maskPhone('123')).toBe('123');
  });
});
