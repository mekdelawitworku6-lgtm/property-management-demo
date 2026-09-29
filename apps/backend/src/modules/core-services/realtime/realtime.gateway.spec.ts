import { mockConfig } from '../../../test-utils/mocks';
import { RealtimeGateway, STAFF_ROOM, userRoom } from './realtime.gateway';

function socket(handshake: Record<string, unknown> = {}) {
  return {
    id: 's1',
    handshake: { auth: {}, headers: {}, query: {}, ...handshake },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

describe('RealtimeGateway', () => {
  const jwt = { verifyAsync: jest.fn() };
  const gateway = new RealtimeGateway(jwt as any, mockConfig({ JWT_SECRET: 's' }));

  beforeEach(() => jest.clearAllMocks());

  it('room helpers', () => {
    expect(userRoom('u1')).toBe('user:u1');
    expect(STAFF_ROOM).toBe('staff');
  });

  it('extractToken reads auth, bearer header or query', () => {
    expect(gateway.extractToken(socket({ auth: { token: 'a' } }))).toBe('a');
    expect(gateway.extractToken(socket({ headers: { authorization: 'Bearer b' } }))).toBe('b');
    expect(gateway.extractToken(socket({ query: { token: 'c' } }))).toBe('c');
    expect(gateway.extractToken(socket())).toBeNull();
  });

  it('handleConnection joins user and staff rooms', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'ADMIN', type: 'access' });
    const client = socket({ auth: { token: 't' } });
    await gateway.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u1');
    expect(client.join).toHaveBeenCalledWith('staff');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('handleConnection disconnects unauthenticated sockets', async () => {
    const client = socket();
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'OWNER', type: 'refresh' });
    const client2 = socket({ auth: { token: 't' } });
    await gateway.handleConnection(client2);
    expect(client2.disconnect).toHaveBeenCalled();
  });

  it('handleDisconnect does not throw', () => {
    expect(() => gateway.handleDisconnect(socket())).not.toThrow();
  });

  it('emitToUsers / emitToStaff emit to rooms and are safe without a server', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = undefined;
    expect(() => gateway.emitToUsers(['u1'], 'notification', {})).not.toThrow();
    gateway.server = { to } as any;
    gateway.emitToUsers(['u1', 'u1', null, 'u2'], 'payment.updated', { id: 1 });
    expect(to).toHaveBeenCalledTimes(2);
    gateway.emitToStaff('payment.updated', { id: 1 });
    expect(to).toHaveBeenLastCalledWith('staff');
    expect(emit).toHaveBeenCalledWith('payment.updated', { id: 1 });
  });
});
