import { API, E2EContext, createActiveLease, createOwnerWithUnit, register, setupE2E, today } from '../e2e-helpers';

describe('Inspections & deposit refunds module (e2e)', () => {
  let ctx: E2EContext;
  let unitId: string;
  let agreementId: string;
  let moveOutId: string;

  beforeAll(async () => {
    ctx = await setupE2E();
    ({ unitId } = await createOwnerWithUnit(ctx));
    await register(ctx, 'tenant', 'TENANT');
    agreementId = await createActiveLease(ctx, 'owner', 'tenant', unitId);
  });
  afterAll(() => ctx.close());

  it('schedules and completes a photo-backed move-in inspection', async () => {
    const created = await ctx.http().post(`${API}/inspections`).set(ctx.auth('owner')).send({
      agreementId,
      type: 'MOVE_IN',
      scheduledAt: `${today()}T10:00:00.000Z`,
      items: [{ label: 'Walls and ceiling', ok: true }],
      photos: ['/uploads/inspections/before.jpg'],
    }).expect(201);
    expect(created.body.data).toMatchObject({
      type: 'MOVE_IN',
      status: 'SCHEDULED',
      agreementId,
      photos: ['/uploads/inspections/before.jpg'],
    });

    const done = await ctx.http().post(`${API}/inspections/${created.body.data.id}/complete`).set(ctx.auth('owner')).send({
      items: [{ label: 'Walls and ceiling', ok: true, note: 'Clean' }],
      photos: ['/uploads/inspections/after.jpg'],
      notes: 'Handed over in good condition',
    }).expect(201);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.photos).toEqual(['/uploads/inspections/before.jpg', '/uploads/inspections/after.jpg']);
    expect(done.body.data.completedAt).toBeTruthy();
  });

  it('requires a completed move-out inspection for deposit deductions', async () => {
    await ctx.http().post(`${API}/deposit-refunds`).set(ctx.auth('owner')).send({
      agreementId,
      deductions: 1500,
    }).expect(400);

    const moveOut = await ctx.http().post(`${API}/inspections`).set(ctx.auth('owner')).send({
      agreementId,
      type: 'MOVE_OUT',
      scheduledAt: `${today()}T12:00:00.000Z`,
    }).expect(201);
    moveOutId = moveOut.body.data.id;

    await ctx.http().post(`${API}/inspections/${moveOutId}/complete`).set(ctx.auth('owner')).send({
      items: [{ label: 'Appliances and fixtures', ok: false, note: 'Broken kettle' }],
    }).expect(201);

    const refund = await ctx.http().post(`${API}/deposit-refunds`).set(ctx.auth('owner')).send({
      agreementId,
      inspectionId: moveOutId,
      deductions: 1500,
      notes: 'Damaged kettle',
    }).expect(201);
    expect(refund.body.data).toMatchObject({
      depositAmount: 20000,
      deductions: 1500,
      refundAmount: 18500,
      status: 'PENDING',
      inspectionId: moveOutId,
    });
  });

  it('approves and pays the refund, then blocks duplicates', async () => {
    const list = await ctx.http().get(`${API}/deposit-refunds`).set(ctx.auth('owner')).expect(200);
    const refundId = list.body.data.docs[0].id as string;

    const approved = await ctx.http().post(`${API}/deposit-refunds/${refundId}/approve`).set(ctx.auth('owner')).send({}).expect(201);
    expect(approved.body.data.status).toBe('APPROVED');

    const paid = await ctx.http().post(`${API}/deposit-refunds/${refundId}/pay`).set(ctx.auth('owner')).send({
      providerReference: 'TELEBIRR-REFUND-1',
    }).expect(201);
    expect(paid.body.data).toMatchObject({ status: 'PAID', providerReference: 'TELEBIRR-REFUND-1' });
    expect(paid.body.data.paidAt).toBeTruthy();

    await ctx.http().post(`${API}/deposit-refunds`).set(ctx.auth('owner')).send({ agreementId }).expect(400);
  });

  it('keeps another owner out of this portfolio', async () => {
    await createOwnerWithUnit(ctx, 'rivalOwner');
    await ctx.http().get(`${API}/inspections/${moveOutId}`).set(ctx.auth('rivalOwner')).expect(404);
  });
});
