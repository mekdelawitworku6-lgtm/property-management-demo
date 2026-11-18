import { mockDeep } from 'jest-mock-extended';
import { Language, ManagerPermission, UserRole } from '@prisma/client';
import { ALL_MANAGER_PERMISSIONS } from '../common/constants/manager-permissions.constants';
import type { AuthUser } from '../common/types/auth-user.type';

/** Loosely typed on purpose: DeepMockProxy<PrismaClient> overwhelms the TS checker. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrismaMock = any;

/** Deep Prisma mock whose $transaction runs callbacks against the same mock. */
export function createPrismaMock(): PrismaMock {
  const prisma: PrismaMock = mockDeep<Record<string, any>>({ funcPropSupport: true } as any);
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: PrismaMock) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
  return prisma;
}

export const IDS = {
  owner: '11111111-1111-1111-1111-111111111111',
  manager: '22222222-2222-2222-2222-222222222222',
  tenant: '33333333-3333-3333-3333-333333333333',
  admin: '44444444-4444-4444-4444-444444444444',
  telecom: '55555555-5555-5555-5555-555555555555',
  otherOwner: '66666666-6666-6666-6666-666666666666',
  property: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  unit: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  agreement: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  invoice: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  payment: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  complaint: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  request: '77777777-7777-7777-7777-777777777777',
  inspection: '99999999-9999-9999-9999-999999999999',
  depositRefund: '12121212-1212-1212-1212-121212121212',
};

function authUser(id: string, role: UserRole, extra: Partial<AuthUser> = {}): AuthUser {
  return {
    id,
    role,
    fullName: `${role} user`,
    phoneNumber: '+251911000000',
    language: Language.EN,
    employerId: null,
    approvalStatus: 'APPROVED',
    permissions: [],
    ip: '127.0.0.1',
    ...extra,
  };
}

export const USERS = {
  owner: authUser(IDS.owner, UserRole.OWNER),
  // The shared manager fixture holds every grant, matching the seeded demo account.
  manager: authUser(IDS.manager, UserRole.MANAGER, { employerId: IDS.owner, permissions: [...ALL_MANAGER_PERMISSIONS] }),
  /** Same manager, stripped down to a read-only staff account. */
  managerViewOnly: authUser(IDS.manager, UserRole.MANAGER, {
    employerId: IDS.owner,
    permissions: [ManagerPermission.PROPERTY_VIEW],
  }),
  /**
   * Staff the platform appointed directly: a manager with no employer, so it
   * belongs to Possible Technology and reads across every owner.
   */
  platformManager: authUser('77777777-7777-7777-7777-777777777777', UserRole.MANAGER, {
    permissions: [...ALL_MANAGER_PERMISSIONS],
  }),
  tenant: authUser(IDS.tenant, UserRole.TENANT),
  admin: authUser(IDS.admin, UserRole.ADMIN),
  telecom: authUser(IDS.telecom, UserRole.TELECOM),
  otherOwner: authUser(IDS.otherOwner, UserRole.OWNER),
};

export function mockAudit() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn(),
    findForEntity: jest.fn(),
    findForOwner: jest.fn(),
  };
}

export function mockNotifications() {
  return {
    notify: jest.fn().mockResolvedValue(1),
    notifyOwner: jest.fn().mockResolvedValue(1),
    notifyStaff: jest.fn().mockResolvedValue(1),
  };
}

export function mockRealtime() {
  return { emitToUsers: jest.fn(), emitToStaff: jest.fn() };
}

/** ConfigService stand-in backed by a plain object. */
export function mockConfig(values: Record<string, unknown> = {}) {
  return { get: jest.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)) } as any;
}
