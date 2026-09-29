import { buildPaginatedList, resolvePagination } from './paginated-list.util';

describe('paginated-list.util', () => {
  it('resolvePagination applies defaults and bounds', () => {
    expect(resolvePagination()).toEqual({ page: 1, limit: 20, skip: 0, take: 20 });
    expect(resolvePagination(3, 10)).toEqual({ page: 3, limit: 10, skip: 20, take: 10 });
    expect(resolvePagination(-1, 1000)).toEqual({ page: 1, limit: 100, skip: 0, take: 100 });
  });

  it('buildPaginatedList computes totalPages (min 1)', () => {
    expect(buildPaginatedList([1, 2], { page: 1, limit: 2, total: 5 })).toEqual({ docs: [1, 2], page: 1, limit: 2, total: 5, totalPages: 3 });
    expect(buildPaginatedList([], { page: 1, limit: 10, total: 0 }).totalPages).toBe(1);
  });
});
