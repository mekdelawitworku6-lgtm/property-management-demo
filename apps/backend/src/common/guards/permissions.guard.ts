import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ManagerPermission, UserRole } from '@prisma/client';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { isPlatformStaff } from '../utils/owner-scope.util';
import type { AuthUser } from '../types/auth-user.type';

/**
 * Enforces `@RequirePermissions(...)` for MANAGER accounts.
 *
 * Owners and platform staff hold every capability implicitly, and tenants are
 * intentionally not gated here (their access is decided by record ownership),
 * so a route that lists a tenant in `@Roles(...)` is unaffected.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<ManagerPermission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.role) throw new ForbiddenException('Authentication required');
    if (user.role !== UserRole.MANAGER) return true;

    const granted = user.permissions ?? [];
    const missing = required.filter((permission) => !granted.includes(permission));
    if (missing.length) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
