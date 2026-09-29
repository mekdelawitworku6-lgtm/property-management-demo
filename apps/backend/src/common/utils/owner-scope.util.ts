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
  if (isPlatformStaff(user)) return;
  const ownerId = resolveOwnerId(user);
  if (ownerId && record.ownerId === ownerId) return;
  if (user.role === UserRole.TENANT && record.tenantId && record.tenantId === user.id) return;
  throw new ForbiddenException('You do not have access to this resource');
}

/**
 * Prisma `where` fragment limiting results to what the user may see.
 * Owners/managers → own portfolio, tenants → own records, staff → everything.
 */
export function scopeWhere(user: AuthUser): { ownerId?: string; tenantId?: string } {
  if (isPlatformStaff(user)) return {};
  const ownerId = resolveOwnerId(user);
  if (ownerId) return { ownerId };
  return { tenantId: user.id };
}
