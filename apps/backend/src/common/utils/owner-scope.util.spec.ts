import { ForbiddenException } from '@nestjs/common';
import { USERS, IDS } from '../../test-utils/mocks';
import { assertCanAccess, isPlatformStaff, requireOwnerId, resolveOwnerId, scopeWhere } from './owner-scope.util';

describe('owner-scope.util', () => {
  it('resolveOwnerId maps owner → self, manager → employer, others → null', () => {
    expect(resolveOwnerId(USERS.owner)).toBe(IDS.owner);
    expect(resolveOwnerId(USERS.manager)).toBe(IDS.owner);
    expect(resolveOwnerId(USERS.tenant)).toBeNull();
    expect(resolveOwnerId(null)).toBeNull();
  });

  it('isPlatformStaff is true for ADMIN and TELECOM only', () => {
    expect(isPlatformStaff(USERS.admin)).toBe(true);
    expect(isPlatformStaff(USERS.telecom)).toBe(true);
    expect(isPlatformStaff(USERS.owner)).toBe(false);
  });

  it('requireOwnerId throws for non owner-side users', () => {
    expect(requireOwnerId(USERS.manager)).toBe(IDS.owner);
    expect(() => requireOwnerId(USERS.tenant)).toThrow(ForbiddenException);
  });

  it('assertCanAccess allows staff, owning owner/manager and the tenant party', () => {
    const record = { ownerId: IDS.owner, tenantId: IDS.tenant };
    expect(() => assertCanAccess(USERS.admin, record)).not.toThrow();
    expect(() => assertCanAccess(USERS.owner, record)).not.toThrow();
    expect(() => assertCanAccess(USERS.manager, record)).not.toThrow();
    expect(() => assertCanAccess(USERS.tenant, record)).not.toThrow();
    expect(() => assertCanAccess(USERS.otherOwner, record)).toThrow(ForbiddenException);
    expect(() => assertCanAccess(USERS.tenant, { ownerId: IDS.owner, tenantId: 'x' })).toThrow(ForbiddenException);
  });

  it('scopeWhere returns role-based filters', () => {
    expect(scopeWhere(USERS.admin)).toEqual({});
    expect(scopeWhere(USERS.manager)).toEqual({ ownerId: IDS.owner });
    expect(scopeWhere(USERS.tenant)).toEqual({ tenantId: IDS.tenant });
  });
});
