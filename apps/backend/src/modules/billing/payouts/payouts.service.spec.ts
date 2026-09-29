import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockConfig, USERS, IDS } from '../../../test-utils/mocks';
import { PayoutsService, calculatePayout, periodBounds } from './payouts.service';

describe('PayoutsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const service = new PayoutsService(prisma, audit as any, mockConfig({ PLATFORM_FEE_PERCENT: 2 }));

  beforeEach(() => jest.clearAllMocks());

  it('calculatePayout computes gross, fee and net', () => {
    expect(calculatePayout([10000, '5000'], 2)).toEqual({ grossCollected: 15000, platformFee: 300, netAmount: 14700 });
  });

  it('periodBounds spans whole days and validates order', () => {
    const { start, end } = periodBounds('2026-09-01', '2026-09-30');
    expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T23:59:59.999Z');
    expect(() => periodBounds('2026-09-30', '2026-09-01')).toThrow(BadRequestException);
  });

  it('feePercent reads config', () => expect(service.feePercent()).toBe(2));

  it('eligiblePaymentsWhere selects confirmed, un-paid-out Telebirr payments', () => {
    const where = service.eligiblePaymentsWhere('o', new Date(0), new Date(1));
    expect(where).toMatchObject({ ownerId: 'o', method: 'TELEBIRR', status: 'CONFIRMED', payoutId: null });
  });

  it('preview calculates the owner payout and direct collections', async () => {
    prisma.payment.findMany.mockResolvedValue([{ amount: 10000 }, { amount: 5000 }]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 2000 } });
    const result = await service.preview(USERS.owner, { from: '2026-09-01', to: '2026-09-30' });
    expect(result).toMatchObject({ ownerId: IDS.owner, grossCollected: 15000, platformFee: 300, netAmount: 14700, directlyCollected: 2000 });
    await expect(service.preview(USERS.admin, { from: '2026-09-01', to: '2026-09-30' })).rejects.toThrow('ownerId is required');
    await expect(service.preview(USERS.tenant, { from: '2026-09-01', to: '2026-09-30' })).rejects.toThrow(ForbiddenException);
  });

  it('generate links payments to a new payout', async () => {
    prisma.payment.findMany.mockResolvedValue([{ id: 'p1', amount: 10000 }]);
    prisma.payout.create.mockImplementation(async ({ data }) => ({ id: 'po', ...data }));
    const payout: any = await service.generate(USERS.admin, { ownerId: IDS.owner, from: '2026-09-01', to: '2026-09-30' });
    expect(payout).toMatchObject({ grossCollected: 10000, platformFee: 200, netAmount: 9800 });
    expect(payout.referenceNo).toMatch(/^PO-/);
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] }, payoutId: null }, data: { payoutId: 'po' } });
    prisma.payment.findMany.mockResolvedValue([]);
    await expect(service.generate(USERS.admin, { ownerId: IDS.owner, from: '2026-09-01', to: '2026-09-30' })).rejects.toThrow('No Telebirr collections');
  });

  it('generateMonthly creates one payout per owner for last month', async () => {
    prisma.payment.groupBy.mockResolvedValue([{ ownerId: 'o1' }, { ownerId: 'o2' }]);
    const spy = jest.spyOn(service, 'generate').mockResolvedValue({} as any);
    await expect(service.generateMonthly(new Date('2026-10-01T00:00:00Z'))).resolves.toBe(2);
    expect(spy.mock.calls[0][1]).toMatchObject({ ownerId: 'o1', from: '2026-09-01T00:00:00.000Z' });
    spy.mockRestore();
  });

  it('markPaid records the disbursement once', async () => {
    prisma.payout.findUnique.mockResolvedValueOnce({ id: 'po', status: 'PENDING' });
    prisma.payout.update.mockResolvedValue({ status: 'PAID' });
    await service.markPaid(USERS.admin, 'po', { method: 'TELEBIRR', paidReference: 'X' });
    expect(prisma.payout.update.mock.calls[0][0].data).toMatchObject({ status: 'PAID', paidReference: 'X' });
    prisma.payout.findUnique.mockResolvedValueOnce({ status: 'PAID' });
    await expect(service.markPaid(USERS.admin, 'po', { method: 'TELEBIRR', paidReference: 'X' })).rejects.toThrow(BadRequestException);
    prisma.payout.findUnique.mockResolvedValueOnce(null);
    await expect(service.markPaid(USERS.admin, 'po', { method: 'TELEBIRR', paidReference: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('findAll scopes owners to their payouts', async () => {
    prisma.payout.findMany.mockResolvedValue([]);
    prisma.payout.count.mockResolvedValue(0);
    await service.findAll(USERS.manager, { status: 'PENDING' });
    expect(prisma.payout.findMany.mock.calls[0][0].where).toEqual({ ownerId: IDS.owner, status: 'PENDING' });
    await service.findAll(USERS.admin, { ownerId: 'o' });
    expect(prisma.payout.findMany.mock.calls[1][0].where).toEqual({ ownerId: 'o' });
  });

  it('findOne enforces access', async () => {
    prisma.payout.findUnique.mockResolvedValueOnce({ id: 'po', ownerId: IDS.owner });
    await expect(service.findOne(USERS.owner, 'po')).resolves.toMatchObject({ id: 'po' });
    prisma.payout.findUnique.mockResolvedValueOnce({ id: 'po', ownerId: IDS.owner });
    await expect(service.findOne(USERS.otherOwner, 'po')).rejects.toThrow(ForbiddenException);
    prisma.payout.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne(USERS.admin, 'po')).rejects.toThrow(NotFoundException);
  });
});
