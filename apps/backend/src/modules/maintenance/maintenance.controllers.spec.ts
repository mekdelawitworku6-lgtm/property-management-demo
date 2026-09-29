import { USERS } from '../../test-utils/mocks';
import { ComplaintsController } from './complaints/complaints.controller';
import { VendorsController } from './vendors/vendors.controller';
import { WorkOrdersController } from './work-orders/work-orders.controller';

const svc = (...methods: string[]) => Object.fromEntries(methods.map((m) => [m, jest.fn().mockResolvedValue(m)]));

describe('Maintenance controllers', () => {
  it('ComplaintsController delegates', async () => {
    const s = svc('create', 'findAll', 'findOne', 'updateStatus', 'respond', 'escalate', 'adminResolve');
    const c = new ComplaintsController(s as any);
    await expect(c.create(USERS.tenant, {} as any)).resolves.toBe('create');
    await expect(c.findAll(USERS.tenant, {})).resolves.toBe('findAll');
    await expect(c.findOne(USERS.tenant, 'c')).resolves.toBe('findOne');
    await expect(c.updateStatus(USERS.owner, 'c', {} as any)).resolves.toBe('updateStatus');
    await expect(c.respond(USERS.owner, 'c', {} as any)).resolves.toBe('respond');
    await expect(c.escalate(USERS.owner, 'c', {} as any)).resolves.toBe('escalate');
    await expect(c.adminResolve(USERS.admin, 'c', {} as any)).resolves.toBe('adminResolve');
  });

  it('VendorsController delegates', async () => {
    const s = svc('create', 'findAll', 'findOne', 'update');
    const c = new VendorsController(s as any);
    await expect(c.create(USERS.owner, {} as any)).resolves.toBe('create');
    await expect(c.findAll(USERS.owner, {})).resolves.toBe('findAll');
    await expect(c.findOne(USERS.owner, 'v')).resolves.toBe('findOne');
    await expect(c.update(USERS.owner, 'v', {})).resolves.toBe('update');
  });

  it('WorkOrdersController delegates', async () => {
    const s = svc('create', 'findAll', 'findOne', 'update', 'complete', 'cancel');
    const c = new WorkOrdersController(s as any);
    await expect(c.create(USERS.owner, {} as any)).resolves.toBe('create');
    await expect(c.findAll(USERS.owner, {})).resolves.toBe('findAll');
    await expect(c.findOne(USERS.owner, 'w')).resolves.toBe('findOne');
    await expect(c.update(USERS.owner, 'w', {})).resolves.toBe('update');
    await expect(c.complete(USERS.owner, 'w', {} as any)).resolves.toBe('complete');
    await expect(c.cancel(USERS.owner, 'w')).resolves.toBe('cancel');
  });
});
