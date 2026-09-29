import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  const guard = new JwtAuthGuard(reflector);
  const ctx = { getHandler: () => ({}), getClass: () => ({}) } as any;

  it('canActivate short-circuits on @Public routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('handleRequest returns the user or throws', () => {
    expect(guard.handleRequest(null, { id: 'u' }, {})).toEqual({ id: 'u' });
    expect(() => guard.handleRequest(null, null, { message: 'jwt expired' })).toThrow(new UnauthorizedException('jwt expired'));
    const err = new Error('boom');
    expect(() => guard.handleRequest(err, null, {})).toThrow(err);
  });
});
