import { API, E2EContext, nextPhone, register, setupE2E } from '../e2e-helpers';

describe('Auth & accounts module (e2e)', () => {
  let ctx: E2EContext;
  beforeAll(async () => (ctx = await setupE2E()));
  afterAll(() => ctx.close());

  it('health check reports the database up', async () => {
    const res = await ctx.http().get('/health').expect(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('owners register pending approval; tenants are auto-approved; secrets never returned', async () => {
    const owner = await ctx.http().post(`${API}/auth/register`).send({
      role: 'OWNER', fullName: 'Kebede', phoneNumber: '0922000001', password: 'Owner1234', language: 'AM',
    }).expect(201);
    expect(owner.body.data.user).toMatchObject({ approvalStatus: 'PENDING', phoneNumber: '+251922000001', language: 'AM' });
    expect(owner.body.data.user).not.toHaveProperty('passwordHash');
    await register(ctx, 'tenant', 'TENANT');
    const me = await ctx.http().get(`${API}/auth/me`).set(ctx.auth('tenant')).expect(200);
    expect(me.body.data.approvalStatus).toBe('APPROVED');
  });

  it('rejects duplicates, weak passwords and invalid input with the error envelope', async () => {
    await ctx.http().post(`${API}/auth/register`).send({ role: 'TENANT', fullName: 'Dup', phoneNumber: '0922000001', password: 'Secret1234' }).expect(409);
    await ctx.http().post(`${API}/auth/register`).send({ role: 'TENANT', fullName: 'Weak', phoneNumber: nextPhone(), password: 'weakweak' }).expect(400);
    const bad = await ctx.http().post(`${API}/auth/register`).send({ role: 'ADMIN' }).expect(400);
    expect(bad.body).toMatchObject({ success: false, data: null });
  });

  it('login by phone or email, token refresh rotates, logout revokes', async () => {
    const token = await ctx.login('0922000001', 'Owner1234');
    expect(token).toBeTruthy();
    const login = await ctx.http().post(`${API}/auth/login`).send({ identifier: 'admin@possibletech.et', password: 'Demo@12345' }).expect(200);
    const { refreshToken, accessToken } = login.body.data.tokens;
    const refreshed = await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken }).expect(200);
    await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken }).expect(401); // rotated
    await ctx.http().post(`${API}/auth/logout`).set({ Authorization: `Bearer ${refreshed.body.data.accessToken}` }).expect(200);
    await ctx.http().get(`${API}/auth/me`).set({ Authorization: `Bearer ${accessToken}` }).expect(401);
    await ctx.http().post(`${API}/auth/login`).send({ identifier: '0922000001', password: 'Wrong1234' }).expect(401);
  });

  it('OTP phone verification and password reset via SMS code', async () => {
    const phone = '+251922000001';
    await ctx.http().post(`${API}/auth/otp/send`).send({ phoneNumber: phone, purpose: 'VERIFY_PHONE' }).expect(429); // sent at registration, cooldown
    // Read the code by overriding the stored hash is not possible — issue a fresh one after the cooldown window.
    await ctx.prisma.otpCode.updateMany({ where: { phoneNumber: phone }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const smsSpy = jest.spyOn(ctx.app.get(require('../../src/modules/integrations/sms/sms.service').SmsService), 'send');
    await ctx.http().post(`${API}/auth/forgot-password`).send({ phoneNumber: phone }).expect(200);
    const code = String(smsSpy.mock.calls.at(-1)[1]).match(/\d{6}/)[0];
    await ctx.http().post(`${API}/auth/reset-password`).send({ phoneNumber: phone, code: '000000', newPassword: 'NewOwner123' }).expect(400);
    await ctx.http().post(`${API}/auth/reset-password`).send({ phoneNumber: phone, code, newPassword: 'NewOwner123' }).expect(200);
    await ctx.login('0922000001', 'NewOwner123');
  });

  it('profile: language preference, tenant ID encrypted at rest and masked, managers', async () => {
    await ctx.http().patch(`${API}/users/me`).set(ctx.auth('tenant')).send({ language: 'AM' }).expect(200);
    const profile = await ctx.http().patch(`${API}/users/me/tenant-profile`).set(ctx.auth('tenant'))
      .send({ idType: 'KEBELE_ID', idNumber: 'AA12345678', emergencyContactName: 'Mom', emergencyContactPhone: '0911000099' }).expect(200);
    expect(profile.body.data).toMatchObject({ idNumberMasked: '******5678', kycStatus: 'PENDING', emergencyContactPhone: '+251911000099' });
    const stored = await ctx.prisma.tenantProfile.findFirst({ where: { idType: 'KEBELE_ID' } });
    expect(stored.idNumberEncrypted).not.toContain('AA12345678');

    const ownerToken = await ctx.login('0922000001', 'NewOwner123');
    const manager = await ctx.http().post(`${API}/managers`).set({ Authorization: `Bearer ${ownerToken}` })
      .send({ fullName: 'Sara', phoneNumber: nextPhone(), password: 'Manager123' }).expect(201);
    expect(manager.body.data).toMatchObject({ role: 'MANAGER', approvalStatus: 'APPROVED' });
  });

  it('RBAC: tenants cannot reach owner or admin endpoints', async () => {
    await ctx.http().post(`${API}/properties`).set(ctx.auth('tenant')).send({}).expect(403);
    await ctx.http().get(`${API}/admin/users`).set(ctx.auth('tenant')).expect(403);
    await ctx.http().get(`${API}/dashboard/owner`).expect(401);
  });
});
