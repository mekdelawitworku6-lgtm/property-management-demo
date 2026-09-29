import { USERS } from '../../../../test-utils/mocks';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const service = {
    register: jest.fn().mockResolvedValue('registered'),
    login: jest.fn().mockResolvedValue('logged-in'),
    refresh: jest.fn().mockResolvedValue('refreshed'),
    logout: jest.fn().mockResolvedValue('out'),
    me: jest.fn().mockResolvedValue('me'),
    sendOtp: jest.fn().mockResolvedValue('sent'),
    verifyPhone: jest.fn().mockResolvedValue('verified'),
    resetPassword: jest.fn().mockResolvedValue('reset'),
    changePassword: jest.fn().mockResolvedValue('changed'),
  };
  const controller = new AuthController(service as any);

  it('delegates each endpoint to AuthService', async () => {
    await expect(controller.register({} as any)).resolves.toBe('registered');
    await expect(controller.login({ identifier: 'x', password: 'y' }, '1.1.1.1')).resolves.toBe('logged-in');
    expect(service.login).toHaveBeenCalledWith({ identifier: 'x', password: 'y' }, '1.1.1.1');
    await expect(controller.refresh({ refreshToken: 'r' })).resolves.toBe('refreshed');
    await expect(controller.logout(USERS.owner)).resolves.toBe('out');
    await expect(controller.me(USERS.owner)).resolves.toBe('me');
    await expect(controller.sendOtp({ phoneNumber: 'p', purpose: 'VERIFY_PHONE' })).resolves.toBe('sent');
    await expect(controller.verifyPhone({ phoneNumber: 'p', code: '123456' })).resolves.toBe('verified');
    await expect(controller.forgotPassword({ phoneNumber: 'p' })).resolves.toBe('sent');
    expect(service.sendOtp).toHaveBeenLastCalledWith('p', 'RESET_PASSWORD');
    await expect(controller.resetPassword({} as any)).resolves.toBe('reset');
    await expect(controller.changePassword(USERS.owner, {} as any)).resolves.toBe('changed');
  });
});
