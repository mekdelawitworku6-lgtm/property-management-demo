/**
 * Standard paginated list returned from services.
 * TransformInterceptor maps this to the global API envelope.
 */
export interface PaginatedList<T> {
  docs: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
