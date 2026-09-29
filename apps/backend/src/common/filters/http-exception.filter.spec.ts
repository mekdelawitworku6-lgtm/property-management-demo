import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter, mapPrismaError } from './http-exception.filter';

function host() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    json,
    status,
    host: { switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ method: 'GET', url: '/x' }) }) } as any,
  };
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db', { code, clientVersion: '6', meta });

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('mapPrismaError maps unique, not-found, FK and unknown codes', () => {
    expect(mapPrismaError(prismaError('P2002', { target: ['phoneNumber'] }))).toEqual({
      status: 409, message: 'A record with this phoneNumber already exists',
    });
    expect(mapPrismaError(prismaError('P2025')).status).toBe(404);
    expect(mapPrismaError(prismaError('P2003')).status).toBe(400);
    expect(mapPrismaError(prismaError('P9999')).status).toBe(400);
  });

  it('formats HttpExceptions including validation arrays', () => {
    const h = host();
    filter.catch(new BadRequestException(['name must be a string', 'x']), h.host);
    expect(h.status).toHaveBeenCalledWith(400);
    expect(h.json.mock.calls[0][0]).toMatchObject({ success: false, message: 'name must be a string', errors: ['name must be a string', 'x'] });
  });

  it('formats Prisma errors and generic errors', () => {
    const h1 = host();
    filter.catch(prismaError('P2002', { target: 'email' }), h1.host);
    expect(h1.status).toHaveBeenCalledWith(409);

    const h2 = host();
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    filter.catch(new Error('kaboom'), h2.host);
    expect(h2.status).toHaveBeenCalledWith(500);

    const h3 = host();
    filter.catch(new NotFoundException('Missing'), h3.host);
    expect(h3.json.mock.calls[0][0].message).toBe('Missing');
  });
});
