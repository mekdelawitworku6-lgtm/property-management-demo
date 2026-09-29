import { USERS } from '../../../../test-utils/mocks';
import { ProfileController } from './profile.controller';
import { TeamController } from './team.controller';

describe('ProfileController', () => {
  const service = {
    getProfile: jest.fn().mockResolvedValue('p'),
    updateMe: jest.fn().mockResolvedValue('m'),
    updateOwnerProfile: jest.fn().mockResolvedValue('o'),
    updateTenantProfile: jest.fn().mockResolvedValue('t'),
  };
  const controller = new ProfileController(service as any);

  it('delegates to ProfileService', async () => {
    await expect(controller.getProfile(USERS.tenant)).resolves.toBe('p');
    await expect(controller.updateMe(USERS.tenant, {})).resolves.toBe('m');
    await expect(controller.updateOwnerProfile(USERS.owner, {})).resolves.toBe('o');
    await expect(controller.updateTenantProfile(USERS.tenant, {})).resolves.toBe('t');
  });
});

describe('TeamController', () => {
  const service = {
    createManager: jest.fn().mockResolvedValue('cm'),
    listManagers: jest.fn().mockResolvedValue('lm'),
    setManagerActive: jest.fn().mockResolvedValue('sa'),
    createTenant: jest.fn().mockResolvedValue('ct'),
    findTenantByPhone: jest.fn().mockResolvedValue('ft'),
    listPortfolioTenants: jest.fn().mockResolvedValue('lt'),
    getPortfolioTenant: jest.fn().mockResolvedValue('gt'),
  };
  const controller = new TeamController(service as any);

  it('delegates to TeamService', async () => {
    await expect(controller.createManager(USERS.owner, {} as any)).resolves.toBe('cm');
    await expect(controller.listManagers(USERS.owner)).resolves.toBe('lm');
    await controller.deactivateManager(USERS.owner, 'm');
    expect(service.setManagerActive).toHaveBeenLastCalledWith(USERS.owner, 'm', false);
    await controller.activateManager(USERS.owner, 'm');
    expect(service.setManagerActive).toHaveBeenLastCalledWith(USERS.owner, 'm', true);
    await expect(controller.createTenant(USERS.owner, {} as any)).resolves.toBe('ct');
    await expect(controller.lookupTenant('0911')).resolves.toBe('ft');
    await expect(controller.listTenants(USERS.owner, 's')).resolves.toBe('lt');
    await expect(controller.getTenant(USERS.owner, 't')).resolves.toBe('gt');
  });
});
