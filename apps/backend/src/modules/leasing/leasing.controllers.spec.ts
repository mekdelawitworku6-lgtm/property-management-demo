import { USERS } from '../../test-utils/mocks';
import { AgreementsController } from './agreements/agreements.controller';
import { RentalRequestsController } from './rental-requests/rental-requests.controller';

const svc = (...methods: string[]) => Object.fromEntries(methods.map((m) => [m, jest.fn().mockResolvedValue(m)]));

describe('Leasing controllers', () => {
  it('AgreementsController delegates', async () => {
    const s = svc('createDirect', 'findAll', 'verifyByReference', 'findOne', 'sign', 'renew', 'terminate', 'cancel', 'addDocument');
    const c = new AgreementsController(s as any);
    await expect(c.create(USERS.owner, {} as any)).resolves.toBe('createDirect');
    await expect(c.findAll(USERS.owner, {})).resolves.toBe('findAll');
    await expect(c.verify('R')).resolves.toBe('verifyByReference');
    await expect(c.findOne(USERS.owner, 'a')).resolves.toBe('findOne');
    await expect(c.sign(USERS.tenant, 'a', {} as any)).resolves.toBe('sign');
    await expect(c.renew(USERS.owner, 'a', {} as any)).resolves.toBe('renew');
    await expect(c.terminate(USERS.owner, 'a', {} as any)).resolves.toBe('terminate');
    await expect(c.cancel(USERS.owner, 'a')).resolves.toBe('cancel');
    await expect(c.addDocument(USERS.owner, 'a', { url: 'x' })).resolves.toBe('addDocument');
  });

  it('RentalRequestsController delegates', async () => {
    const s = svc('create', 'findAll', 'findOne', 'cancel', 'accept', 'reject');
    const c = new RentalRequestsController(s as any);
    await expect(c.create(USERS.tenant, {} as any)).resolves.toBe('create');
    await expect(c.findAll(USERS.tenant, {})).resolves.toBe('findAll');
    await expect(c.findOne(USERS.tenant, 'r')).resolves.toBe('findOne');
    await expect(c.cancel(USERS.tenant, 'r')).resolves.toBe('cancel');
    await expect(c.accept(USERS.owner, 'r', {})).resolves.toBe('accept');
    await expect(c.reject(USERS.owner, 'r', {})).resolves.toBe('reject');
  });
});
