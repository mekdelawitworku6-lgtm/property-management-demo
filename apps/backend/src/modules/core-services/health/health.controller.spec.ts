import { ServiceUnavailableException } from '@nestjs/common';
import { createPrismaMock } from '../../../test-utils/mocks';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const prisma = createPrismaMock();
  const controller = new HealthController(prisma);

  it('returns ok when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([1]);
    await expect(controller.check()).resolves.toMatchObject({ status: 'ok', database: 'up' });
  });

  it('throws 503 when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('down'));
    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });
});
