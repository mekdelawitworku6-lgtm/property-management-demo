import { SetMetadata } from '@nestjs/common';
import type { ManagerPermission } from '@prisma/client';

export const PERMISSIONS_KEY = 'managerPermissions';

/**
 * Restricts a route to staff accounts holding every listed grant.
 *
 * Only enforced for MANAGER users: owners and platform staff always pass, and
 * tenants are governed by their own ownership checks, so a route shared with
 * tenants keeps working while still gating the owner's staff.
 */
export const RequirePermissions = (...permissions: ManagerPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
