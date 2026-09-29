import type { PaginatedList } from '../types/paginated-list.type';

export function resolvePagination(page?: number, limit?: number): {
  page: number;
  limit: number;
  skip: number;
  take: number;
} {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit, take: safeLimit };
}

export function buildPaginatedList<T>(
  docs: T[],
  meta: { page: number; limit: number; total: number },
): PaginatedList<T> {
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));
  return { docs, page: meta.page, limit: meta.limit, total: meta.total, totalPages };
}
