import type { Language, ManagerPermission, UserRole } from '@prisma/client';

/** Shape attached to `request.user` by JwtStrategy. */
export interface AuthUser {
  id: string;
  role: UserRole;
  fullName: string;
  phoneNumber: string;
  language: Language;
  employerId: string | null;
  approvalStatus: string;
  /** Capability grants; only meaningful for MANAGER accounts. */
  permissions: ManagerPermission[];
  ip?: string;
}
