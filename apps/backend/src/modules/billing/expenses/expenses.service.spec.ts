import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, USERS, IDS } from '../../../test-utils/mocks';
import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const service = new ExpensesService(prisma, audit as any);
  const dto = { propertyId: IDS.property, category: 'UTILITIES' as const, amount: 1200, incurredOn: '2026-09-15' };

  beforeEach(() => jest.clearAllMocks());

  it('assertPropertyUnit validates ownership and unit membership', async () => {
    prisma.property.findFirst.mockResolvedValueOnce(null);
    await expect(service.assertPropertyUnit(IDS.owner, IDS.property)).rejects.toThrow(NotFoundException);
    prisma.property.findFirst.mockResolvedValue({ id: IDS.property });
    prisma.unit.findFirst.mockResolvedValueOnce(null);
    await expect(service.assertPropertyUnit(IDS.owner, IDS.property, IDS.unit)).rejects.toThrow(BadRequestException);
  });

  it('create records an expense for the owner', async () => {
    prisma.property.findFirst.mockResolvedValue({ id: IDS.property });
    prisma.expense.create.mockResolvedValue({ id: 'e' });
    await service.create(USERS.manager, dto);
    expect(prisma.expense.create.mock.calls[0][0].data).toMatchObject({ ownerId: IDS.owner, recordedById: USERS.manager.id, incurredOn: new Date('2026-09-15') });
    expect(audit.log).toHaveBeenCalledWith('EXPENSE_RECORDED', 'Expense', 'e', USERS.manager, { amount: 1200, category: 'UTILITIES' });
  });

  it('createFromWorkOrder upserts a maintenance expense', async () => {
    await service.createFromWorkOrder(prisma, { id: 'w', ownerId: 'o', propertyId: 'p', unitId: null, title: 'Fix', referenceNo: 'WO-1' }, 900, 'u');
    expect(prisma.expense.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workOrderId: 'w' }, update: { amount: 900 },
      create: expect.objectContaining({ category: 'MAINTENANCE', amount: 900, description: 'Work order WO-1: Fix' }),
    }));
  });

  it('findAll filters and totals', async () => {
    prisma.expense.findMany.mockResolvedValue([{ id: 'e' }]);
    prisma.expense.count.mockResolvedValue(1);
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 1200 } });
    await expect(service.findAll(USERS.owner, { category: 'UTILITIES', from: '2026-09-01', to: '2026-09-30' })).resolves.toMatchObject({ totalAmount: 1200 });
    expect(prisma.expense.findMany.mock.calls[0][0].where).toMatchObject({ ownerId: IDS.owner, category: 'UTILITIES', incurredOn: { gte: expect.any(Date), lte: expect.any(Date) } });
    await service.findAll(USERS.admin, {});
    expect(prisma.expense.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('findOwned throws when missing', async () => {
    prisma.expense.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOwned(USERS.owner, 'e')).rejects.toThrow(NotFoundException);
  });

  it('update edits manual expenses only', async () => {
    prisma.expense.findFirst.mockResolvedValueOnce({ id: 'e', ownerId: IDS.owner, propertyId: IDS.property, workOrderId: null });
    prisma.expense.update.mockResolvedValue({ id: 'e', amount: 1500 });
    await service.update(USERS.owner, 'e', { amount: 1500, incurredOn: '2026-09-20' });
    expect(prisma.expense.update.mock.calls[0][0].data).toMatchObject({ amount: 1500, incurredOn: new Date('2026-09-20') });
    prisma.expense.findFirst.mockResolvedValueOnce({ workOrderId: 'w' });
    await expect(service.update(USERS.owner, 'e', { amount: 1 })).rejects.toThrow(BadRequestException);
  });

  it('remove deletes manual expenses only', async () => {
    prisma.expense.findFirst.mockResolvedValueOnce({ id: 'e', workOrderId: null, amount: 10 });
    await expect(service.remove(USERS.owner, 'e')).resolves.toEqual({ deleted: true });
    prisma.expense.findFirst.mockResolvedValueOnce({ workOrderId: 'w' });
    await expect(service.remove(USERS.owner, 'e')).rejects.toThrow(BadRequestException);
  });
});
