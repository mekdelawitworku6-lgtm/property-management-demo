import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function context(user?: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows public routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    expect(guard.canActivate(context())).toBe(true);
  });

  it('allows routes without role metadata', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false).mockReturnValueOnce(undefined);
    expect(guard.canActivate(context({ role: UserRole.TENANT }))).toBe(true);
  });

  it('allows a matching role and rejects others', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => (key === 'roles' ? [UserRole.OWNER] : false));
    expect(guard.canActivate(context({ role: UserRole.OWNER }))).toBe(true);
    expect(() => guard.canActivate(context({ role: UserRole.TENANT }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(undefined))).toThrow('Authentication required');
  });
});
