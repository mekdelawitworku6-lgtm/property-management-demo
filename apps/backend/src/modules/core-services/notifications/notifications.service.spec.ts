import { NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockRealtime, IDS } from '../../../test-utils/mocks';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma = createPrismaMock();
  const realtime = mockRealtime();
  const sms = { send: jest.fn().mockResolvedValue(true) };
  const telegram = { send: jest.fn().mockResolvedValue(true) };
  const service = new NotificationsService(prisma, realtime as any, sms as any, telegram as any);

  beforeEach(() => jest.clearAllMocks());

  it('notify localizes per user, sends SMS/Telegram and emits realtime', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', language: 'AM', phoneNumber: '+251911000001', telegramChatId: '99' },
      { id: 'u2', language: 'EN', phoneNumber: '+251911000002', telegramChatId: null },
    ]);
    prisma.notification.create.mockImplementation(async ({ data }) => ({ id: 'n', ...data }));
    const count = await service.notify(['u1', 'u2', 'u1', null], 'PAYMENT_RECEIVED', { amount: 5, reference: 'R' }, { sms: true });
    expect(count).toBe(2);
    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(telegram.send).toHaveBeenCalledTimes(1);
    const first = prisma.notification.create.mock.calls[0][0].data;
    expect(first).toMatchObject({ userId: 'u1', type: 'PAYMENT_RECEIVED', title: 'ክፍያ ተቀብለናል', channels: ['IN_APP', 'SMS', 'TELEGRAM'] });
    expect(realtime.emitToUsers).toHaveBeenCalledTimes(2);
  });

  it('notify returns 0 for no recipients and swallows errors', async () => {
    await expect(service.notify([], 'OTP')).resolves.toBe(0);
    prisma.user.findMany.mockRejectedValueOnce(new Error('db'));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.notify(['u1'], 'OTP')).resolves.toBe(0);
  });

  it('notifyOwner includes active managers', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'm1' }]);
    const spy = jest.spyOn(service, 'notify').mockResolvedValueOnce(2);
    await service.notifyOwner(IDS.owner, 'COMPLAINT_NEW', { a: 1 });
    expect(spy).toHaveBeenCalledWith([IDS.owner, 'm1'], 'COMPLAINT_NEW', { a: 1 }, {});
  });

  it('notifyStaff targets staff roles', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 's1' }]);
    const spy = jest.spyOn(service, 'notify').mockResolvedValueOnce(1);
    await service.notifyStaff('COMPLAINT_ESCALATED', {}, ['ADMIN'] as any);
    expect(prisma.user.findMany.mock.calls[0][0].where.role).toEqual({ in: ['ADMIN'] });
    expect(spy).toHaveBeenCalledWith(['s1'], 'COMPLAINT_ESCALATED', {}, {});
  });

  it('findAll paginates and filters unread', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
    prisma.notification.count.mockResolvedValue(1);
    const result = await service.findAll('u1', { unreadOnly: true });
    expect(result.docs).toEqual([{ id: 'n1' }]);
    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', readAt: null });
  });

  it('unreadCount counts unread', async () => {
    prisma.notification.count.mockResolvedValue(4);
    await expect(service.unreadCount('u1')).resolves.toEqual({ unread: 4 });
  });

  it('markRead updates only own unread notifications', async () => {
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    await expect(service.markRead('u1', 'n1')).rejects.toThrow(NotFoundException);
    prisma.notification.findFirst.mockResolvedValueOnce({ id: 'n1', readAt: new Date() });
    await service.markRead('u1', 'n1');
    expect(prisma.notification.update).not.toHaveBeenCalled();
    prisma.notification.findFirst.mockResolvedValueOnce({ id: 'n1', readAt: null });
    prisma.notification.update.mockResolvedValueOnce({ id: 'n1' });
    await service.markRead('u1', 'n1');
    expect(prisma.notification.update).toHaveBeenCalled();
  });

  it('markAllRead reports the updated count', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead('u1')).resolves.toEqual({ updated: 3 });
  });
});
