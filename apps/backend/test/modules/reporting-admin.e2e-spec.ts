import { API, E2EContext, createActiveLease, createOwnerWithUnit, register, setupE2E } from '../e2e-helpers';

describe('Reporting, admin oversight, audit, realtime sync (e2e)', () => {
  let ctx: E2EContext;
  let ownerId: string;
  let tenantId: string;
  let agreementId: string;
  beforeAll(async () => {
    ctx = await setupE2E();
    let unitId: string;
    ({ ownerId, unitId } = await createOwnerWithUnit(ctx));
    tenantId = await register(ctx, 'tenant', 'TENANT');
    agreementId = await createActiveLease(ctx, 'owner', 'tenant', unitId);
    const deposit = await ctx.prisma.invoice.findFirst({ where: { agreementId, type: 'DEPOSIT' } });
    await ctx.http().post(`${API}/payments/offline`).set(ctx.auth('owner')).send({ invoiceId: deposit.id, method: 'CASH' }).expect(201);
  });
  afterAll(() => ctx.close());

  it('owner dashboard: occupancy, rent collected vs expected, active tenants, maintenance', async () => {
    const res = await ctx.http().get(`${API}/dashboard/owner`).set(ctx.auth('owner')).expect(200);
    expect(res.body.data.totals).toMatchObject({ properties: 1, occupancyRate: 100, activeTenants: 1, activeAgreements: 1 });
    expect(res.body.data.totals.collectedByMethod.CASH).toBe(20000);
    expect(res.body.data.properties[0]).toHaveProperty('rentExpected');
  });

  it('tenant dashboard shows the lease and outstanding balance', async () => {
    const res = await ctx.http().get(`${API}/dashboard/tenant`).set(ctx.auth('tenant')).expect(200);
    expect(res.body.data.agreements).toHaveLength(1);
    expect(res.body.data.outstandingBalance).toBeGreaterThan(0);
  });

  it('monthly owner statement and Excel / PDF exports in Amharic and English', async () => {
    const statement = await ctx.http().get(`${API}/reports/owner-statement`).set(ctx.auth('owner')).expect(200);
    expect(statement.body.data.totals.income).toBe(20000);
    const xlsx = await ctx.http().get(`${API}/reports/owner-statement?format=xlsx&lang=AM`).set(ctx.auth('owner')).buffer(true).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await ctx.http().get(`${API}/reports/payments?format=pdf&lang=EN`).set(ctx.auth('owner')).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const roll = await ctx.http().get(`${API}/reports/rent-roll`).set(ctx.auth('owner')).expect(200);
    expect(roll.body.data.rows).toHaveLength(1);
    await ctx.http().get(`${API}/reports/owner-statement`).set(ctx.auth('admin')).expect(400);
    await ctx.http().get(`${API}/reports/owner-statement?ownerId=${ownerId}`).set(ctx.auth('admin')).expect(200);
  });

  it('admin observes all owners, tenants and agreements platform-wide', async () => {
    const users = await ctx.http().get(`${API}/admin/users?role=TENANT`).set(ctx.auth('telecom')).expect(200);
    expect(users.body.data.docs.map((u: any) => u.id)).toContain(tenantId);
    const agreements = await ctx.http().get(`${API}/agreements?ownerId=${ownerId}`).set(ctx.auth('admin')).expect(200);
    expect(agreements.body.data.total).toBe(1);
    const dash = await ctx.http().get(`${API}/dashboard/admin`).set(ctx.auth('admin')).expect(200);
    expect(dash.body.data.agreements.ACTIVE).toBe(1);
  });

  it('every transaction, agreement and complaint action is in the audit log', async () => {
    const trail = await ctx.http().get(`${API}/admin/audit-logs/Agreement/${agreementId}`).set(ctx.auth('admin')).expect(200);
    expect(trail.body.data.map((l: any) => l.action)).toEqual(expect.arrayContaining(['AGREEMENT_CREATED', 'AGREEMENT_SIGNED']));
    expect(trail.body.data.every((l: any) => l.createdAt && l.actorRole)).toBe(true);
    const payments = await ctx.http().get(`${API}/admin/audit-logs?action=PAYMENT_RECORDED`).set(ctx.auth('admin')).expect(200);
    expect(payments.body.data.total).toBe(1);
    await ctx.http().get(`${API}/admin/audit-logs`).set(ctx.auth('owner')).expect(403);
  });

  it('offline delta sync returns only records changed since the cursor', async () => {
    const first = await ctx.http().get(`${API}/sync`).set(ctx.auth('owner')).expect(200);
    expect(first.body.data.agreements).toHaveLength(1);
    const next = await ctx.http().get(`${API}/sync?since=${first.body.data.serverTime}`).set(ctx.auth('owner')).expect(200);
    expect(next.body.data.agreements).toHaveLength(0);
  });

  it('suspending an account revokes access immediately; unsuspending restores it', async () => {
    await ctx.http().patch(`${API}/admin/users/${tenantId}/suspend`).set(ctx.auth('admin')).send({ reason: 'Fraud investigation' }).expect(200);
    await ctx.http().get(`${API}/auth/me`).set(ctx.auth('tenant')).expect(401);
    await ctx.http().patch(`${API}/admin/users/${tenantId}/unsuspend`).set(ctx.auth('admin')).expect(200);
    const users = await ctx.http().get(`${API}/admin/users/${tenantId}`).set(ctx.auth('admin')).expect(200);
    expect(users.body.data.isSuspended).toBe(false);
  });
});
