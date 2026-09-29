import { USERS } from '../../../test-utils/mocks';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  const service = {
    findAll: jest.fn().mockResolvedValue('list'),
    unreadCount: jest.fn().mockResolvedValue('count'),
    markAllRead: jest.fn().mockResolvedValue('all'),
    markRead: jest.fn().mockResolvedValue('one'),
  };
  const controller = new NotificationsController(service as any);

  it('delegates every endpoint with the current user id', async () => {
    await expect(controller.findAll(USERS.tenant, {})).resolves.toBe('list');
    await expect(controller.unreadCount(USERS.tenant)).resolves.toBe('count');
    await expect(controller.markAllRead(USERS.tenant)).resolves.toBe('all');
    await expect(controller.markRead(USERS.tenant, 'n1')).resolves.toBe('one');
    expect(service.markRead).toHaveBeenCalledWith(USERS.tenant.id, 'n1');
  });
});
