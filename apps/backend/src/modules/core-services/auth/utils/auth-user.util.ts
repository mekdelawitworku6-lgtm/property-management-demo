import type { OwnerProfile, TenantProfile, User } from '@prisma/client';

type UserWithProfiles = User & { ownerProfile?: OwnerProfile | null; tenantProfile?: TenantProfile | null };

/** Strips secrets before returning a user to any client. */
export function toPublicUser(user: UserWithProfiles) {
  if (!user) return null;
  const { passwordHash: _p, refreshTokenHash: _r, sessionVersion: _s, ...rest } = user;
  if (rest.tenantProfile) {
    const { idNumberEncrypted, ...profile } = rest.tenantProfile;
    return { ...rest, tenantProfile: { ...profile, hasIdNumber: Boolean(idNumberEncrypted) } };
  }
  return rest;
}
