import { Prisma } from '@prisma/client';
import {
  buildErrorResponse, buildSuccessResponse, extractExceptionMessage, formatControllerResponse, serializeValue,
} from './api-response.util';

describe('api-response.util', () => {
  describe('serializeValue', () => {
    it('converts Prisma Decimal to number, undefined to null and keeps dates', () => {
      const date = new Date('2026-09-29T00:00:00Z');
      const result = serializeValue({ a: new Prisma.Decimal('12.50'), b: undefined, c: date, d: [new Prisma.Decimal(1)], e: 5n });
      expect(result).toEqual({ a: 12.5, b: null, c: date, d: [1], e: 5 });
    });

    it('returns primitives unchanged', () => {
      expect(serializeValue('x')).toBe('x');
      expect(serializeValue(null)).toBeNull();
    });
  });

  it('buildSuccessResponse wraps data in the envelope', () => {
    const res = buildSuccessResponse({ id: 1 }, 201, 'Created');
    expect(res).toMatchObject({ statusCode: 201, success: true, message: 'Created', data: { id: 1 } });
    expect(typeof res.timestamp).toBe('string');
  });

  it('buildErrorResponse includes errors only when present', () => {
    expect(buildErrorResponse(400, 'Bad')).not.toHaveProperty('errors');
    expect(buildErrorResponse(400, 'Bad', ['a'])).toMatchObject({ success: false, data: null, errors: ['a'] });
  });

  describe('formatControllerResponse', () => {
    it('uses an explicit { message, data } override', () => {
      expect(formatControllerResponse({ message: 'Done', data: { x: 1 } }, 200)).toMatchObject({ message: 'Done', data: { x: 1 } });
    });

    it('wraps plain data with the default message', () => {
      expect(formatControllerResponse([1, 2], 200, 'OK')).toMatchObject({ message: 'OK', data: [1, 2] });
      expect(formatControllerResponse(undefined, 200).data).toBeNull();
    });
  });

  describe('extractExceptionMessage', () => {
    it('handles string, array and object bodies', () => {
      expect(extractExceptionMessage('Nope')).toEqual({ message: 'Nope' });
      expect(extractExceptionMessage({ message: ['first', 'second'] })).toEqual({ message: 'first', errors: ['first', 'second'] });
      expect(extractExceptionMessage({ message: 'Single' })).toEqual({ message: 'Single' });
      expect(extractExceptionMessage(42, 'fallback')).toEqual({ message: 'fallback' });
    });
  });
});
