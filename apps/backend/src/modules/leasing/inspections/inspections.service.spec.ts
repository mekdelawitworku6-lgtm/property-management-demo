import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockNotifications, mockRealtime, IDS, USERS } from '../../../test-utils/mocks';
import { InspectionsService } from './inspections.service';

const inspection = (overrides: Record<string, unknown> = {}) => ({
  id: IDS.inspection,
  referenceNo: 'INS-20261118-ABC123',
  agreementId: IDS.agreement,
  propertyId: IDS.property,
  unitId: IDS.unit,
  ownerId: IDS.owner,
  tenantId: IDS.tenant,
  type: 'MOVE_OUT',
  status: 'SCHEDULED',
  scheduledAt: new Date('2026-11-20T10:00:00Z'),
  completedAt: null,
  conductedById: null,
  items: [],
  photos: [],
  notes: null,
  agreement: {
    id: IDS.agreement,
    referenceNo: 'AGR-1',
    status: 'ACTIVE',
    endDate: new Date('2026-12-31T00:00:00Z'),
    property: { id: IDS.property, name: 'Building A' },
    unit: { id: IDS.unit, unitNumber: 'A-101' },
  },
  tenant: { id: IDS.tenant, fullName: 'Tenant user', phoneNumber: '+251911000005' },
  conductedBy: null,
  ...overrides,
});

describe('InspectionsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const service = new InspectionsService(prisma, audit as any, notifications as any, realtime as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create resolves the agreement owner and notifies the tenant', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce({
      id: IDS.agreement,
      propertyId: IDS.property,
      unitId: IDS.unit,
      tenantId: IDS.tenant,
    });
    const created = inspection();
    prisma.inspection.create.mockResolvedValueOnce(created);

    await expect(service.create(USERS.owner, {
      agreementId: IDS.agreement,
      type: 'MOVE_OUT' as any,
      scheduledAt: '2026-11-20T10:00:00.000Z',
      photos: ['/uploads/inspections/before.jpg'],
    })).resolves.toMatchObject({ id: IDS.inspection });

    expect(prisma.inspection.create.mock.calls[0][0].data).toMatchObject({
      ownerId: IDS.owner,
      tenantId: IDS.tenant,
      propertyId: IDS.property,
      unitId: IDS.unit,
      type: 'MOVE_OUT',
      status: 'SCHEDULED',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      [IDS.tenant],
      'INSPECTION_SCHEDULED',
      expect.objectContaining({ unit: 'Building A / A-101' }),
      expect.any(Object),
    );
    expect(audit.log).toHaveBeenCalledWith('INSPECTION_CREATED', 'Inspection', IDS.inspection, USERS.owner, expect.any(Object));
  });

  it('create returns the existing row for a replayed clientRef', async () => {
    const existing = inspection();
    prisma.inspection.findUnique.mockResolvedValueOnce(existing);
    await expect(service.create(USERS.owner, {
      agreementId: IDS.agreement,
      type: 'MOVE_OUT' as any,
      clientRef: 'client-1',
    })).resolves.toBe(existing);
    expect(prisma.agreement.findFirst).not.toHaveBeenCalled();
  });

  it('create rejects agreements outside the owner portfolio', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(USERS.owner, {
      agreementId: IDS.agreement,
      type: 'MOVE_IN' as any,
    })).rejects.toThrow(NotFoundException);
  });

  it('findAll scopes managers to their employer portfolio', async () => {
    prisma.inspection.findMany.mockResolvedValueOnce([]);
    prisma.inspection.count.mockResolvedValueOnce(0);
    await service.findAll(USERS.manager, { status: 'SCHEDULED' as any });
    expect(prisma.inspection.findMany.mock.calls[0][0].where).toMatchObject({
      ownerId: IDS.owner,
      status: 'SCHEDULED',
    });
  });

  it('complete records checklist results and appends photos', async () => {
    prisma.inspection.findFirst.mockResolvedValueOnce(inspection());
    prisma.inspection.update.mockResolvedValueOnce(inspection({
      status: 'COMPLETED',
      completedAt: new Date(),
      conductedById: IDS.manager,
      items: [{ label: 'Walls', ok: false, note: 'Repaint' }],
      photos: ['/uploads/inspections/after.jpg'],
    }));

    const result = await service.complete(USERS.manager, IDS.inspection, {
      items: [{ label: 'Walls', ok: false, note: 'Repaint' }] as any,
      photos: ['/uploads/inspections/after.jpg'],
      notes: 'Minor paint damage',
    });

    expect(result.status).toBe('COMPLETED');
    expect(prisma.inspection.update.mock.calls[0][0].data).toMatchObject({
      status: 'COMPLETED',
      conductedById: IDS.manager,
      photos: { push: ['/uploads/inspections/after.jpg'] },
      notes: 'Minor paint damage',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      [IDS.tenant],
      'INSPECTION_COMPLETED',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('complete refuses a cancelled inspection', async () => {
    prisma.inspection.findFirst.mockResolvedValueOnce(inspection({ status: 'CANCELLED' }));
    await expect(service.complete(USERS.owner, IDS.inspection, {})).rejects.toThrow(BadRequestException);
  });

  it('cancel writes an audit entry and emits realtime update', async () => {
    prisma.inspection.findFirst.mockResolvedValueOnce(inspection());
    prisma.inspection.update.mockResolvedValueOnce(inspection({ status: 'CANCELLED' }));
    await expect(service.cancel(USERS.owner, IDS.inspection)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(audit.log).toHaveBeenCalledWith('INSPECTION_CANCELLED', 'Inspection', IDS.inspection, USERS.owner, expect.any(Object));
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      [IDS.owner, IDS.tenant],
      'inspection.updated',
      expect.any(Object),
    );
  });
});
