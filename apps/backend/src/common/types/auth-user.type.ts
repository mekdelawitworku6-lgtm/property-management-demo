import type { Language, UserRole } from '@prisma/client';

/** Shape attached to `request.user` by JwtStrategy. */
export interface AuthUser {
  id: string;
  role: UserRole;
  fullName: string;
  phoneNumber: string;
  language: Language;
  employerId: string | null;
  approvalStatus: string;
  ip?: string;
}
