import { API, E2EContext, createOwnerWithUnit, register, setupE2E, today } from '../e2e-helpers';

describe('Leasing module: rental requests & agreements (e2e)', () => {
  let ctx: E2EContext;
  let unitId: string;
  let agreementId: string;
  let contentHash: string;
  beforeAll(async () => {
    ctx = await setupE2E();
    ({ unitId } = await createOwnerWithUnit(ctx));
    await register(ctx, 'tenant', 'TENANT');
    await register(ctx, 'rival', 'TENANT');
  });
  afterAll(() => ctx.close());

  it('tenants request to rent; accepting one declines competing requests and generates the agreement', async () => {
    const mine = await ctx.http().post(`${API}/rental-requests`).set(ctx.auth('tenant')).send({ unitId, desiredStartDate: today(), durationMonths: 12 }).expect(201);
    const rival = await ctx.http().post(`${API}/rental-requests`).set(ctx.auth('rival')).send({ unitId, desiredStartDate: today(), durationMonths: 6 }).expect(201);
    await ctx.http().post(`${API}/rental-requests`).set(ctx.auth('tenant')).send({ unitId, desiredStartDate: today(), durationMonths: 12 }).expect(409);

    const accepted = await ctx.http().post(`${API}/rental-requests/${mine.body.data.id}/accept`).set(ctx.auth('owner')).send({ paymentDueDay: 5 }).expect(201);
    agreementId = accepted.body.data.agreement.id;
    expect(accepted.body.data.agreement.status).toBe('PENDING_SIGNATURE');
    const rivalView = await ctx.http().get(`${API}/rental-requests/${rival.body.data.id}`).set(ctx.auth('rival')).expect(200);
    expect(rivalView.body.data.status).toBe('REJECTED');
    expect((await ctx.prisma.unit.findUnique({ where: { id: unitId } })).status).toBe('RESERVED');
  });

  it('tenant signs digitally; the signed copy is identical for tenant, owner and admin and tamper-evident', async () => {
    const view = await ctx.http().get(`${API}/agreements/${agreementId}`).set(ctx.auth('tenant')).expect(200);
    contentHash = view.body.data.contentHash;
    expect(view.body.data.content).toContain('የኪራይ ውል');
    await ctx.http().post(`${API}/agreements/${agreementId}/sign`).set(ctx.auth('tenant')).send({ signatureName: 'T', contentHash: 'f'.repeat(64), acceptTerms: true }).expect(400);
    await ctx.http().post(`${API}/agreements/${agreementId}/sign`).set(ctx.auth('owner')).send({ signatureName: 'T', contentHash, acceptTerms: true }).expect(403);
    const signed = await ctx.http().post(`${API}/agreements/${agreementId}/sign`).set(ctx.auth('tenant')).send({ signatureName: 'Tenant', contentHash, acceptTerms: true }).expect(201);
    expect(signed.body.data.status).toBe('ACTIVE');

    for (const who of ['owner', 'admin']) {
      const res = await ctx.http().get(`${API}/agreements/${agreementId}`).set(ctx.auth(who)).expect(200);
      expect(res.body.data).toMatchObject({ contentHash, integrity: { contentValid: true, signatureValid: true } });
    }
    await ctx.http().get(`${API}/agreements/${agreementId}`).set(ctx.auth('rival')).expect(403);
    expect((await ctx.prisma.unit.findUnique({ where: { id: unitId } })).status).toBe('OCCUPIED');

    await ctx.prisma.agreement.update({ where: { id: agreementId }, data: { content: 'tampered' } });
    const verify = await ctx.http().get(`${API}/agreements/verify/${signed.body.data.referenceNo}`).expect(200);
    expect(verify.body.data.contentValid).toBe(false);
    await ctx.prisma.agreement.update({ where: { id: agreementId }, data: { content: view.body.data.content } });
  });

  it('renewal is offered as a new agreement and replaces the old one when signed', async () => {
    const renewal = await ctx.http().post(`${API}/agreements/${agreementId}/renew`).set(ctx.auth('owner')).send({ durationMonths: 12, rentAmount: 11000 }).expect(201);
    await ctx.http().post(`${API}/agreements/${agreementId}/renew`).set(ctx.auth('owner')).send({ durationMonths: 12 }).expect(400);
    const view = await ctx.http().get(`${API}/agreements/${renewal.body.data.id}`).set(ctx.auth('tenant')).expect(200);
    await ctx.http().post(`${API}/agreements/${renewal.body.data.id}/sign`).set(ctx.auth('tenant'))
      .send({ signatureName: 'Tenant', contentHash: view.body.data.contentHash, acceptTerms: true }).expect(201);
    const old = await ctx.http().get(`${API}/agreements/${agreementId}`).set(ctx.auth('owner')).expect(200);
    expect(old.body.data.status).toBe('RENEWED');
    agreementId = renewal.body.data.id;
  });

  it('termination vacates the unit and cancels future unpaid invoices', async () => {
    await ctx.http().post(`${API}/agreements/${agreementId}/terminate`).set(ctx.auth('owner')).send({ reason: 'Tenant relocating' }).expect(201);
    expect((await ctx.prisma.unit.findUnique({ where: { id: unitId } })).status).toBe('VACANT');
    const future = await ctx.prisma.invoice.count({ where: { agreementId, status: { not: 'CANCELLED' }, periodStart: { gt: new Date() } } });
    expect(future).toBe(0);
  });

  it('owner can create a lease directly for a registered tenant and withdraw it before signing', async () => {
    const tenant = await ctx.http().get(`${API}/auth/me`).set(ctx.auth('rival')).expect(200);
    const direct = await ctx.http().post(`${API}/agreements`).set(ctx.auth('owner'))
      .send({ unitId, tenantId: tenant.body.data.id, startDate: today(), durationMonths: 6 }).expect(201);
    expect((await ctx.prisma.unit.findUnique({ where: { id: unitId } })).status).toBe('RESERVED');
    await ctx.http().patch(`${API}/agreements/${direct.body.data.id}/cancel`).set(ctx.auth('rival')).expect(200);
    expect((await ctx.prisma.unit.findUnique({ where: { id: unitId } })).status).toBe('VACANT');
  });

  it('lease expiry job expires past-due agreements and frees the unit', async () => {
    const agreement = await ctx.prisma.agreement.findFirst({ where: { status: 'TERMINATED' } });
    await ctx.prisma.agreement.update({ where: { id: agreement.id }, data: { status: 'ACTIVE', endDate: new Date('2020-01-01') } });
    const { AgreementsService } = require('../../src/modules/leasing/agreements/agreements.service');
    await expect(ctx.app.get(AgreementsService).expireAgreements()).resolves.toBeGreaterThanOrEqual(1);
    expect((await ctx.prisma.agreement.findUnique({ where: { id: agreement.id } })).status).toBe('EXPIRED');
  });
});
