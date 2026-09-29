import { AuditLogsController } from './audit-logs.controller';

describe('AuditLogsController', () => {
  const service = { findAll: jest.fn().mockResolvedValue('list'), findForEntity: jest.fn().mockResolvedValue('trail') };
  const controller = new AuditLogsController(service as any);

  it('findAll delegates the filter', async () => {
    await expect(controller.findAll({ action: 'X' })).resolves.toBe('list');
    expect(service.findAll).toHaveBeenCalledWith({ action: 'X' });
  });

  it('findForEntity delegates type + id', async () => {
    await expect(controller.findForEntity('Payment', 'p1')).resolves.toBe('trail');
    expect(service.findForEntity).toHaveBeenCalledWith('Payment', 'p1');
  });
});
