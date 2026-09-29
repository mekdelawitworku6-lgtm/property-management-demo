import { StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';
import { LoggingInterceptor } from './logging.interceptor';

const ctx = {
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({ getResponse: () => ({ statusCode: 201 }), getRequest: () => ({ method: 'POST', url: '/x' }) }),
} as any;

describe('TransformInterceptor', () => {
  const reflector = new Reflector();
  const interceptor = new TransformInterceptor(reflector);

  it('wraps controller data in the success envelope with @ResponseMessage', async () => {
    jest.spyOn(reflector, 'get').mockReturnValueOnce('Created!');
    const result: any = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ id: 1 }) }));
    expect(result).toMatchObject({ statusCode: 201, success: true, message: 'Created!', data: { id: 1 } });
  });

  it('passes StreamableFile through untouched', async () => {
    const file = new StreamableFile(Buffer.from('x'));
    const result = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(file) }));
    expect(result).toBe(file);
  });
});

describe('LoggingInterceptor', () => {
  it('logs and passes the value through', async () => {
    const interceptor = new LoggingInterceptor();
    const spy = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => undefined);
    await expect(lastValueFrom(interceptor.intercept(ctx, { handle: () => of('ok') }))).resolves.toBe('ok');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('POST /x 201'));
  });
});
