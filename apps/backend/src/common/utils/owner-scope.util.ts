import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../types/auth-user.type';

/** Returns the owner whose portfolio this user manages (owner → self, manager → employer). */
export function resolveOwnerId(user: AuthUser): string | null {
  if (!user) return null;
  if (user.role === UserRole.OWNER) return user.id;
  if (user.role === UserRole.MANAGER) return user.employerId ?? null;
  return null;
}

export function isPlatformStaff(user: AuthUser): boolean {
  return user?.role === UserRole.ADMIN || user?.role === UserRole.TELECOM;
}

/**
 * Who may *read* across every owner's portfolio.
 *
 * The platform team (admin, Ethio Telecom) can, and so can staff the platform
 * appointed directly: a MANAGER with no employerId. Those accounts belong to
 * Possible Technology rather than to one owner, so without this they would fall
 * through to the tenant branch of `scopeWhere` and see an empty application.
 *
 * This is a deliberate widening of access, so it is kept separate from
 * `isPlatformStaff` (which also answers "may administer the platform") and it
 * only affects reading. Anything that has to *belong* to an owner - creating a
 * property, logging an expense - still goes through `requireOwnerId` and is
 * refused for a portfolio-less account, because there is no owner to attribute
 * the record to.
 */
export function isPlatformWide(user: AuthUser): boolean {
  if (isPlatformStaff(user)) return true;
  return user?.role === UserRole.MANAGER && !user.employerId;
}

/** Owner/manager scope, throwing when the caller is not an owner-side user. */
export function requireOwnerId(user: AuthUser): string {
  const ownerId = resolveOwnerId(user);
  if (!ownerId) throw new ForbiddenException('Only owners or managers can perform this action');
  return ownerId;
}

/**
 * Throws unless the user may access a record owned by `ownerId` / rented by `tenantId`.
 * Platform staff can access everything.
 */
export function assertCanAccess(
  user: AuthUser,
  record: { ownerId?: string | null; tenantId?: string | null },
): void {
  if (isPlatformWide(user)) return;
  const ownerId = resolveOwnerId(user);
  if (ownerId && record.ownerId === ownerId) return;
  if (user.role === UserRole.TENANT && record.tenantId && record.tenantId === user.id) return;
  throw new ForbiddenException('You do not have access to this resource');
}

/**
 * Prisma `where` fragment limiting results to what the user may see.
 * Platform-wide users and owner-less staff → everything, owners/managers → own
 * portfolio, tenants → own records.
 */
export function scopeWhere(user: AuthUser): { ownerId?: string; tenantId?: string } {
  if (isPlatformWide(user)) return {};
  const ownerId = resolveOwnerId(user);
  if (ownerId) return { ownerId };
  return { tenantId: user.id };
}
