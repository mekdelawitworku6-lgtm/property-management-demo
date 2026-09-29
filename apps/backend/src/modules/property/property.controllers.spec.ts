import { USERS } from '../../test-utils/mocks';
import { PropertiesController } from './properties/properties.controller';
import { UnitsController } from './units/units.controller';
import { ListingsController } from './listings/listings.controller';

const svc = (...methods: string[]) => Object.fromEntries(methods.map((m) => [m, jest.fn().mockResolvedValue(m)]));

describe('Property controllers', () => {
  it('PropertiesController delegates', async () => {
    const s = svc('create', 'findAll', 'findOne', 'update', 'deactivate');
    const c = new PropertiesController(s as any);
    await expect(c.create(USERS.owner, {} as any)).resolves.toBe('create');
    await expect(c.findAll(USERS.owner, {})).resolves.toBe('findAll');
    await expect(c.findOne(USERS.owner, 'p')).resolves.toBe('findOne');
    await expect(c.update(USERS.owner, 'p', {})).resolves.toBe('update');
    await expect(c.deactivate(USERS.owner, 'p')).resolves.toBe('deactivate');
  });

  it('UnitsController delegates', async () => {
    const s = svc('create', 'findByProperty', 'findOne', 'update', 'remove');
    const c = new UnitsController(s as any);
    await expect(c.create(USERS.owner, 'p', {} as any)).resolves.toBe('create');
    await expect(c.findByProperty(USERS.owner, 'p')).resolves.toBe('findByProperty');
    await expect(c.findOne(USERS.owner, 'u')).resolves.toBe('findOne');
    await expect(c.update(USERS.owner, 'u', {})).resolves.toBe('update');
    await expect(c.remove(USERS.owner, 'u')).resolves.toBe('remove');
  });

  it('ListingsController delegates', async () => {
    const s = svc('search', 'locations', 'findOne');
    const c = new ListingsController(s as any);
    await expect(c.search({})).resolves.toBe('search');
    await expect(c.locations()).resolves.toBe('locations');
    await expect(c.findOne('u')).resolves.toBe('findOne');
  });
});
