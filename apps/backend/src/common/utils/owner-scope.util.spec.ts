import { ForbiddenException } from '@nestjs/common';
import { USERS, IDS } from '../../test-utils/mocks';
import {
  assertCanAccess,
  isPlatformStaff,
  isPlatformWide,
  requireOwnerId,
  resolveOwnerId,
  scopeWhere,
} from './owner-scope.util';

describe('owner-scope.util', () => {
  it('resolveOwnerId maps owner → self, manager → employer, others → null', () => {
    expect(resolveOwnerId(USERS.owner)).toBe(IDS.owner);
    expect(resolveOwnerId(USERS.manager)).toBe(IDS.owner);
    expect(resolveOwnerId(USERS.tenant)).toBeNull();
    expect(resolveOwnerId(USERS.platformManager)).toBeNull();
    expect(resolveOwnerId(null)).toBeNull();
  });

  it('isPlatformStaff is true for ADMIN and TELECOM only', () => {
    expect(isPlatformStaff(USERS.admin)).toBe(true);
    expect(isPlatformStaff(USERS.telecom)).toBe(true);
    expect(isPlatformStaff(USERS.owner)).toBe(false);
    // Portfolio-less staff read across owners but are not platform staff: they
    // cannot administer accounts, they are the accounts being administered.
    expect(isPlatformStaff(USERS.platformManager)).toBe(false);
  });

  it('isPlatformWide also covers staff appointed by the platform', () => {
    expect(isPlatformWide(USERS.admin)).toBe(true);
    expect(isPlatformWide(USERS.telecom)).toBe(true);
    expect(isPlatformWide(USERS.platformManager)).toBe(true);
    expect(isPlatformWide(USERS.owner)).toBe(false);
    expect(isPlatformWide(USERS.manager)).toBe(false);
    expect(isPlatformWide(USERS.tenant)).toBe(false);
  });

  it('requireOwnerId throws for non owner-side users', () => {
    expect(requireOwnerId(USERS.manager)).toBe(IDS.owner);
    expect(() => requireOwnerId(USERS.tenant)).toThrow(ForbiddenException);
    // There is no owner to attribute a record to, so writes stay refused.
    expect(() => requireOwnerId(USERS.platformManager)).toThrow(ForbiddenException);
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

  it('assertCanAccess lets platform-appointed staff reach another owner record', () => {
    expect(() => assertCanAccess(USERS.platformManager, { ownerId: IDS.otherOwner })).not.toThrow();
  });

  it('scopeWhere returns role-based filters', () => {
    expect(scopeWhere(USERS.admin)).toEqual({});
    expect(scopeWhere(USERS.manager)).toEqual({ ownerId: IDS.owner });
    expect(scopeWhere(USERS.tenant)).toEqual({ tenantId: IDS.tenant });
  });

  it('scopeWhere gives platform-appointed staff every owner, not the tenant scope', () => {
    // The regression this guards: with no employerId an owner-less manager used
    // to fall through to the tenant branch and see an empty application.
    expect(scopeWhere(USERS.platformManager)).toEqual({});
  });
});
