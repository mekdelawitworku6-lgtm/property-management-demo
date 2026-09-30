import { ManagerPermission } from '@prisma/client';
import { API, E2EContext, createOwnerWithUnit, nextPhone, setupE2E } from '../e2e-helpers';

describe('Staff accounts, permission grants and the owner activity trail (e2e)', () => {
  let ctx: E2EContext;
  let ownerId: string;
  let propertyId: string;
  let staffId: string;
  let staffPhone: string;
  let readOnlyId: string;
  let readOnlyPhone: string;

  beforeAll(async () => {
    ctx = await setupE2E();
    ({ ownerId, propertyId } = await createOwnerWithUnit(ctx));

    // Two staff accounts: one with every grant, one deliberately restricted.
    const full = await ctx.http().post(`${API}/managers`).set(ctx.auth('owner')).send({
      fullName: 'HanaTesfaew Worku', phoneNumber: nextPhone(), password: 'Staff@1234',
    }).expect(201);
    staffId = full.body.data.id as string;
    staffPhone = full.body.data.phoneNumber as string;

    const readOnly = await ctx.http().post(`${API}/managers`).set(ctx.auth('owner')).send({
      fullName: 'Read Only Person', phoneNumber: nextPhone(), password: 'Staff@1234',
      permissions: [ManagerPermission.PROPERTY_VIEW, ManagerPermission.COMPLAINT_VIEW],
    }).expect(201);
    readOnlyId = readOnly.body.data.id as string;
    readOnlyPhone = readOnly.body.data.phoneNumber as string;

    ctx.tokens.staff = await ctx.login(staffPhone, 'Staff@1234');
    ctx.tokens.readOnly = await ctx.login(readOnlyPhone, 'Staff@1234');
  });
  afterAll(() => ctx.close());

  describe('adding staff', () => {
    it('creates a manager with every grant when none are specified', async () => {
      const list = await ctx.http().get(`${API}/managers`).set(ctx.auth('owner')).expect(200);
      const staff = list.body.data.find((m: any) => m.id === staffId);
      expect(staff.role).toBe('MANAGER');
      expect(staff.permissions).toHaveLength(Object.values(ManagerPermission).length);
      expect(staff.isSuspended).toBe(false);
    });

    it('stores exactly the permissions the owner ticked', async () => {
      const list = await ctx.http().get(`${API}/managers`).set(ctx.auth('owner')).expect(200);
      const readOnly = list.body.data.find((m: any) => m.id === readOnlyId);
      expect(readOnly.permissions.sort()).toEqual([ManagerPermission.COMPLAINT_VIEW, ManagerPermission.PROPERTY_VIEW]);
    });

    it('rejects a duplicate phone number and a staff account without a usable password', async () => {
      await ctx.http().post(`${API}/managers`).set(ctx.auth('owner'))
        .send({ fullName: 'Copy Cat', phoneNumber: staffPhone, password: 'Staff@1234' }).expect(409);
      await ctx.http().post(`${API}/managers`).set(ctx.auth('owner'))
        .send({ fullName: 'Weak Pass', phoneNumber: nextPhone(), password: 'short' }).expect(400);
    });

    it('lets only the owner manage staff', async () => {
      await ctx.http().get(`${API}/managers`).set(ctx.auth('staff')).expect(403);
      await ctx.http().get(`${API}/managers`).set(ctx.auth('admin')).expect(403);
    });
  });

  describe('permission grants are enforced', () => {
    it('a fully granted staff member reaches the owner routes', async () => {
      await ctx.http().get(`${API}/properties`).set(ctx.auth('staff')).expect(200);
      await ctx.http().post(`${API}/properties`).set(ctx.auth('staff')).send({
        name: 'Staff Added Tower', type: 'RESIDENTIAL', city: 'Addis Ababa', subCity: 'Bole', address: 'Bole Road',
      }).expect(201);
    });

    it('a view-only staff member may read but is blocked from every write', async () => {
      await ctx.http().get(`${API}/properties`).set(ctx.auth('readOnly')).expect(200);
      // PROPERTY_MANAGE is not granted.
      await ctx.http().post(`${API}/properties`).set(ctx.auth('readOnly')).send({
        name: 'Should Not Exist', type: 'RESIDENTIAL', city: 'Addis Ababa', subCity: 'Bole', address: 'Nowhere',
      }).expect(403);
      // UNIT_MANAGE is not granted.
      await ctx.http().post(`${API}/properties/${propertyId}/units`).set(ctx.auth('readOnly'))
        .send({ unitNumber: 'X-9', type: 'APARTMENT', bedrooms: 1, rentAmount: 1000, depositAmount: 2000 }).expect(403);
      // PAYMENT_VIEW is not granted either.
      await ctx.http().get(`${API}/invoices`).set(ctx.auth('readOnly')).expect(403);
    });

    it('the owner can narrow a grant at any time and it applies on the next request', async () => {
      const res = await ctx.http().patch(`${API}/managers/${staffId}/permissions`).set(ctx.auth('owner'))
        .send({ permissions: [ManagerPermission.PROPERTY_VIEW] }).expect(200);
      expect(res.body.data.permissions).toEqual([ManagerPermission.PROPERTY_VIEW]);
      // The session is still valid but the write is now refused.
      await ctx.http().post(`${API}/properties`).set(ctx.auth('staff')).send({
        name: 'Blocked Tower', type: 'RESIDENTIAL', city: 'Addis Ababa', subCity: 'Bole', address: 'Bole Road',
      }).expect(403);
      await ctx.http().get(`${API}/properties`).set(ctx.auth('staff')).expect(200);
    });

    it('cannot grant permissions to somebody else\'s staff', async () => {
      const other = await createOwnerWithUnit(ctx, 'owner2');
      await ctx.http().patch(`${API}/managers/${other.ownerId}/permissions`).set(ctx.auth('owner'))
        .send({ permissions: [ManagerPermission.PROPERTY_VIEW] }).expect(404);
    });
  });

  describe('deactivating staff', () => {
    it('blocks the account immediately and reactivating restores it', async () => {
      await ctx.http().patch(`${API}/managers/${readOnlyId}/deactivate`).set(ctx.auth('owner')).expect(200);
      await ctx.http().get(`${API}/properties`).set(ctx.auth('readOnly')).expect(401);
      await ctx.http().patch(`${API}/managers/${readOnlyId}/activate`).set(ctx.auth('owner')).expect(200);
      // Deactivation bumped the session version, so the old token stays dead and
      // the staff member has to sign in again.
      await ctx.http().get(`${API}/properties`).set(ctx.auth('readOnly')).expect(401);
      ctx.tokens.readOnly = await ctx.login(readOnlyPhone, 'Staff@1234');
      await ctx.http().get(`${API}/properties`).set(ctx.auth('readOnly')).expect(200);
    });
  });

  describe('owner activity trail', () => {
    it('shows the actions the owner and their staff performed', async () => {
      const res = await ctx.http().get(`${API}/owner/audit-logs`).set(ctx.auth('owner')).expect(200);
      const actions = res.body.data.docs.map((l: any) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['MANAGER_CREATED', 'MANAGER_PERMISSIONS_UPDATED', 'PROPERTY_CREATED']));
      const actorIds = res.body.data.docs.map((l: any) => l.actorId);
      expect(actorIds).toEqual(expect.arrayContaining([ownerId, staffId]));
    });

    it('records who read a record, and can hide those read entries on request', async () => {
      await ctx.http().get(`${API}/properties/${propertyId}`).set(ctx.auth('readOnly')).expect(200);
      const withViews = await ctx.http().get(`${API}/owner/audit-logs?entityType=Property`).set(ctx.auth('owner')).expect(200);
      const viewed = withViews.body.data.docs.find((l: any) => l.action === 'RECORD_VIEWED');
      expect(viewed.actorId).toBe(readOnlyId);
      expect(viewed.entityId).toBe(propertyId);

      const actionsOnly = await ctx.http().get(`${API}/owner/audit-logs?includeViews=false`).set(ctx.auth('owner')).expect(200);
      expect(actionsOnly.body.data.docs.some((l: any) => l.action === 'RECORD_VIEWED')).toBe(false);
    });

    it('can filter the trail down to one staff member', async () => {
      const res = await ctx.http().get(`${API}/owner/audit-logs?actorId=${staffId}`).set(ctx.auth('owner')).expect(200);
      expect(res.body.data.docs.length).toBeGreaterThan(0);
      expect(res.body.data.docs.every((l: any) => l.actorId === staffId)).toBe(true);
    });

    it('never leaks another owner\'s activity or the platform-wide log', async () => {
      const res = await ctx.http().get(`${API}/owner/audit-logs?limit=100`).set(ctx.auth('owner')).expect(200);
      const foreign = res.body.data.docs.filter((l: any) => l.actorId !== ownerId && l.actorId !== staffId && l.actorId !== readOnlyId);
      expect(foreign).toHaveLength(0);
      await ctx.http().get(`${API}/owner/audit-logs`).set(ctx.auth('staff')).expect(403);
      await ctx.http().get(`${API}/owner/audit-logs`).set(ctx.auth('admin')).expect(403);
      await ctx.http().get(`${API}/admin/audit-logs`).set(ctx.auth('owner')).expect(403);
    });
  });
});
