import { API, E2EContext, createActiveLease, createOwnerWithUnit, register, setupE2E } from '../e2e-helpers';

describe('Maintenance module: complaints, escalation, vendors, work orders (e2e)', () => {
  let ctx: E2EContext;
  let propertyId: string;
  let unitId: string;
  let complaintId: string;
  beforeAll(async () => {
    ctx = await setupE2E();
    ({ propertyId, unitId } = await createOwnerWithUnit(ctx));
    await register(ctx, 'tenant', 'TENANT');
    await register(ctx, 'stranger', 'TENANT');
    await createActiveLease(ctx, 'owner', 'tenant', unitId);
  });
  afterAll(() => ctx.close());

  it('only tenants with an active lease can file complaints; they reach the owner inbox', async () => {
    await ctx.http().post(`${API}/complaints`).set(ctx.auth('stranger')).send({ category: 'NOISE', title: 'Noise', description: 'Loud' }).expect(400);
    const res = await ctx.http().post(`${API}/complaints`).set(ctx.auth('tenant'))
      .send({ category: 'MAINTENANCE', priority: 'URGENT', title: 'Burst pipe', description: 'Flooding', photos: ['/uploads/complaints/a.jpg'], clientRef: 'c-1' }).expect(201);
    complaintId = res.body.data.id;
    const dup = await ctx.http().post(`${API}/complaints`).set(ctx.auth('tenant')).send({ category: 'MAINTENANCE', title: 'Burst pipe', description: 'Flooding', clientRef: 'c-1' }).expect(201);
    expect(dup.body.data.id).toBe(complaintId);
    const inbox = await ctx.http().get(`${API}/complaints`).set(ctx.auth('owner')).expect(200);
    expect(inbox.body.data.docs.map((c: any) => c.id)).toContain(complaintId);
    const notes = await ctx.http().get(`${API}/notifications`).set(ctx.auth('owner')).expect(200);
    expect(notes.body.data.docs.map((n: any) => n.type)).toContain('COMPLAINT_NEW');
  });

  it('owner assigns a vendor work order; completion logs cost and resolves the complaint', async () => {
    const vendor = await ctx.http().post(`${API}/vendors`).set(ctx.auth('owner')).send({ name: 'Kality Plumbing', serviceType: 'PLUMBING', phoneNumber: '0911556677' }).expect(201);
    const wo = await ctx.http().post(`${API}/work-orders`).set(ctx.auth('owner')).send({ complaintId, vendorId: vendor.body.data.id, title: 'Replace pipe', estimatedCost: 1200 }).expect(201);
    expect(wo.body.data).toMatchObject({ status: 'ASSIGNED', propertyId, unitId });
    let tenantView = await ctx.http().get(`${API}/complaints/${complaintId}`).set(ctx.auth('tenant')).expect(200);
    expect(tenantView.body.data.status).toBe('IN_PROGRESS');

    await ctx.http().post(`${API}/work-orders/${wo.body.data.id}/complete`).set(ctx.auth('owner')).send({ actualCost: 1350 }).expect(201);
    tenantView = await ctx.http().get(`${API}/complaints/${complaintId}`).set(ctx.auth('tenant')).expect(200);
    expect(tenantView.body.data.status).toBe('RESOLVED');
    const expenses = await ctx.http().get(`${API}/expenses`).set(ctx.auth('owner')).expect(200);
    expect(expenses.body.data).toMatchObject({ total: 1, totalAmount: 1350 });
    const vendorView = await ctx.http().get(`${API}/vendors/${vendor.body.data.id}`).set(ctx.auth('owner')).expect(200);
    expect(vendorView.body.data).toMatchObject({ totalSpend: 1350, completedJobs: 1 });
  });

  it('tenant can reopen; complaint becomes visible to admin only after escalation; admin resolves the dispute', async () => {
    await ctx.http().patch(`${API}/complaints/${complaintId}/status`).set(ctx.auth('tenant')).send({ status: 'OPEN', note: 'Still leaking' }).expect(200);
    let admin = await ctx.http().get(`${API}/complaints`).set(ctx.auth('admin')).expect(200);
    expect(admin.body.data.docs.map((c: any) => c.id)).not.toContain(complaintId);

    await ctx.http().post(`${API}/complaints/${complaintId}/escalate`).set(ctx.auth('tenant')).send({ reason: 'Owner ignoring the leak' }).expect(201);
    await ctx.http().post(`${API}/complaints/${complaintId}/escalate`).set(ctx.auth('owner')).send({ reason: 'again' }).expect(400);
    admin = await ctx.http().get(`${API}/complaints?escalationStatus=ESCALATED`).set(ctx.auth('admin')).expect(200);
    expect(admin.body.data.docs.map((c: any) => c.id)).toContain(complaintId);

    await ctx.http().post(`${API}/complaints/${complaintId}/admin-resolve`).set(ctx.auth('owner')).send({ resolution: 'x' }).expect(403);
    const resolved = await ctx.http().post(`${API}/complaints/${complaintId}/admin-resolve`).set(ctx.auth('admin'))
      .send({ resolution: 'Owner to replace the whole line within 3 days' }).expect(201);
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', escalationStatus: 'ADMIN_RESOLVED' });
    const thread = await ctx.http().get(`${API}/complaints/${complaintId}`).set(ctx.auth('owner')).expect(200);
    expect(thread.body.data.responses.map((r: any) => r.message).join(' ')).toContain('[Admin resolution]');
  });

  it('unresolved complaints past the SLA become visible to admin without escalation', async () => {
    const res = await ctx.http().post(`${API}/complaints`).set(ctx.auth('tenant')).send({ category: 'SAFETY', title: 'Broken lock', description: 'Door lock broken' }).expect(201);
    await ctx.prisma.complaint.update({ where: { id: res.body.data.id }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    const stale = await ctx.http().get(`${API}/complaints?staleOnly=true`).set(ctx.auth('admin')).expect(200);
    expect(stale.body.data.docs.map((c: any) => c.id)).toContain(res.body.data.id);
  });
});
