/**
 * Unified API response helpers.
 *
 * Success: { statusCode, success: true, message, data, timestamp }
 *   Paginated lists: data = { docs, page, limit, total, totalPages }
 * Error (HttpExceptionFilter): { statusCode, success: false, message, data: null, errors?, timestamp }
 *
 * Controllers return plain data (or a PaginatedList); the global TransformInterceptor wraps it.
 */

import { Prisma } from '@prisma/client';

export interface ApiSuccessResponse<T = unknown> {
  statusCode: number;
  success: true;
  message: string;
  data: T;
  timestamp: string;
}

export interface ApiErrorResponse {
  statusCode: number;
  success: false;
  message: string;
  data: null;
  errors?: string[];
  timestamp: string;
}

export const DEFAULT_SUCCESS_MESSAGE = 'Retrieved successfully';

/** Converts Prisma Decimal / BigInt values into JSON-friendly numbers and undefined into null. */
export function serializeValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
    if (Buffer.isBuffer(value)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = serializeValue(val);
    }
    return result;
  }
  return value;
}

export function buildSuccessResponse<T>(
  data: T,
  statusCode = 200,
  message = DEFAULT_SUCCESS_MESSAGE,
): ApiSuccessResponse<T> {
  return {
    statusCode,
    success: true,
    message,
    data: serializeValue(data) as T,
    timestamp: new Date().toISOString(),
  };
}

export function buildErrorResponse(
  statusCode: number,
  message: string,
  errors?: string[],
): ApiErrorResponse {
  return {
    statusCode,
    success: false,
    message,
    data: null,
    ...(errors && errors.length ? { errors } : {}),
    timestamp: new Date().toISOString(),
  };
}

/** Controllers may return `{ message, ...rest }` to override the envelope message. */
export function formatControllerResponse(
  data: unknown,
  statusCode: number,
  message = DEFAULT_SUCCESS_MESSAGE,
): ApiSuccessResponse<unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.message === 'string' && Object.keys(record).length <= 2 && 'data' in record) {
      return buildSuccessResponse(record.data, statusCode, record.message);
    }
  }
  return buildSuccessResponse(data ?? null, statusCode, message);
}

/** Extract a user-facing message and field errors from an HttpException response body. */
export function extractExceptionMessage(response: unknown, fallback = 'An error occurred'): {
  message: string;
  errors?: string[];
} {
  if (typeof response === 'string') return { message: response };
  if (response && typeof response === 'object') {
    const res = response as { message?: string | string[] };
    if (Array.isArray(res.message)) {
      return { message: res.message[0] ?? fallback, errors: res.message };
    }
    if (typeof res.message === 'string') return { message: res.message };
  }
  return { message: fallback };
}
