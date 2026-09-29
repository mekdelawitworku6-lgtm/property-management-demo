import { BadRequestException } from '@nestjs/common';
import { createPrismaMock, USERS, IDS } from '../../../test-utils/mocks';
import { SyncService, parseSince } from './sync.service';
import { SyncController } from './sync.controller';

describe('SyncService', () => {
  const prisma = createPrismaMock();
  const service = new SyncService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of ['property', 'unit', 'agreement', 'invoice', 'payment', 'complaint', 'workOrder', 'notification']) {
      prisma[model].findMany.mockResolvedValue([]);
    }
  });

  it('parseSince defaults to epoch and validates ISO dates', () => {
    expect(parseSince().getTime()).toBe(0);
    expect(parseSince('2026-09-29T08:00:00Z').toISOString()).toBe('2026-09-29T08:00:00.000Z');
    expect(() => parseSince('yesterday')).toThrow(BadRequestException);
  });

  it('owner sync includes portfolio entities changed since the cursor', async () => {
    prisma.unit.findMany.mockResolvedValue([{ id: 'u' }]);
    const result = await service.changes(USERS.manager, '2026-09-29T00:00:00Z');
    expect(result.units).toEqual([{ id: 'u' }]);
    expect(result.hasMore).toBe(false);
    expect(prisma.property.findMany.mock.calls[0][0].where).toMatchObject({ ownerId: IDS.owner, updatedAt: { gt: new Date('2026-09-29T00:00:00Z') } });
    expect(prisma.invoice.findMany.mock.calls[0][0].where).toMatchObject({ ownerId: IDS.owner });
  });

  it('tenant sync is scoped to the tenant and skips owner-only entities', async () => {
    const result = await service.changes(USERS.tenant);
    expect(prisma.property.findMany).not.toHaveBeenCalled();
    expect(prisma.workOrder.findMany).not.toHaveBeenCalled();
    expect(prisma.agreement.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: IDS.tenant });
    expect(result.serverTime).toBeInstanceOf(Date);
  });

  it('flags hasMore when a page is full and rejects staff', async () => {
    prisma.payment.findMany.mockResolvedValue(new Array(500).fill({}));
    await expect(service.changes(USERS.tenant)).resolves.toMatchObject({ hasMore: true });
    await expect(service.changes(USERS.admin)).rejects.toThrow(BadRequestException);
  });

  it('SyncController delegates', async () => {
    const s = { changes: jest.fn().mockResolvedValue('delta') };
    await expect(new SyncController(s as any).changes(USERS.tenant, 'x')).resolves.toBe('delta');
    expect(s.changes).toHaveBeenCalledWith(USERS.tenant, 'x');
  });
});
