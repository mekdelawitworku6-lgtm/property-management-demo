import { API, E2EContext, createActiveLease, createOwnerWithUnit, register, setupE2E } from '../e2e-helpers';

describe('Billing module: invoices, payments, payouts, expenses (e2e)', () => {
  let ctx: E2EContext;
  let ownerId: string;
  let propertyId: string;
  let agreementId: string;
  let rentInvoice: any;
  let depositInvoice: any;
  beforeAll(async () => {
    ctx = await setupE2E();
    let unitId: string;
    ({ ownerId, propertyId, unitId } = await createOwnerWithUnit(ctx));
    await register(ctx, 'tenant', 'TENANT');
    agreementId = await createActiveLease(ctx, 'owner', 'tenant', unitId);
  });
  afterAll(() => ctx.close());

  it('signing generates deposit + prorated rent invoices and a full payment schedule', async () => {
    const res = await ctx.http().get(`${API}/invoices?agreementId=${agreementId}`).set(ctx.auth('tenant')).expect(200);
    depositInvoice = res.body.data.docs.find((i: any) => i.type === 'DEPOSIT');
    rentInvoice = res.body.data.docs.filter((i: any) => i.type === 'RENT').sort((a: any, b: any) => a.periodStart.localeCompare(b.periodStart))[0];
    expect(depositInvoice).toMatchObject({ amount: 20000, status: 'UNPAID' });
    expect(rentInvoice.amount).toBeGreaterThan(0);
    const schedule = await ctx.http().get(`${API}/agreements/${agreementId}/schedule`).set(ctx.auth('owner')).expect(200);
    expect(schedule.body.data.length).toBeGreaterThanOrEqual(12);
  });

  it('Telebirr: checkout → Ethio Telecom callback confirms → invoice paid (idempotent, amount-checked)', async () => {
    const init = await ctx.http().post(`${API}/payments/telebirr`).set(ctx.auth('tenant')).send({ invoiceId: rentInvoice.id, clientRef: 'offline-1' }).expect(201);
    const payment = init.body.data.payment;
    const again = await ctx.http().post(`${API}/payments/telebirr`).set(ctx.auth('tenant')).send({ invoiceId: rentInvoice.id, clientRef: 'offline-1' }).expect(201);
    expect(again.body.data.payment.id).toBe(payment.id);
    await ctx.http().post(`${API}/payments/telebirr`).set(ctx.auth('tenant')).send({ invoiceId: rentInvoice.id }).expect(400); // covered by pending

    const mismatch = await ctx.http().post(`${API}/payments/telebirr/webhook`).send({ merch_order_id: payment.referenceNo, amount: 1 }).expect(200);
    expect(mismatch.body.data.ok).toBe(false);
    await ctx.http().get(`${API}/payments/telebirr/mock-checkout/${payment.referenceNo}`).expect(200);
    await ctx.http().get(`${API}/payments/telebirr/mock-checkout/${payment.referenceNo}`).expect(200); // replay is a no-op

    const invoice = await ctx.http().get(`${API}/invoices/${rentInvoice.id}`).set(ctx.auth('tenant')).expect(200);
    expect(invoice.body.data).toMatchObject({ status: 'PAID', outstanding: 0, amountPaid: rentInvoice.amount });
  });

  it('bank transfer: tenant submits reference, Ethio Telecom confirms; duplicates and tenant self-confirm blocked', async () => {
    const half = depositInvoice.amount / 2;
    const bank = await ctx.http().post(`${API}/payments/bank-transfer`).set(ctx.auth('tenant'))
      .send({ invoiceId: depositInvoice.id, amount: half, bankName: 'CBE', providerReference: 'FT001' }).expect(201);
    await ctx.http().post(`${API}/payments/bank-transfer`).set(ctx.auth('tenant'))
      .send({ invoiceId: depositInvoice.id, amount: 1, bankName: 'CBE', providerReference: 'FT001' }).expect(409);
    await ctx.http().patch(`${API}/payments/${bank.body.data.id}/confirm`).set(ctx.auth('tenant')).send({}).expect(403);
    const confirmed = await ctx.http().patch(`${API}/payments/${bank.body.data.id}/confirm`).set(ctx.auth('telecom')).send({}).expect(200);
    expect(confirmed.body.data.confirmationSource).toBe('ETHIO_TELECOM');
    const invoice = await ctx.http().get(`${API}/invoices/${depositInvoice.id}`).set(ctx.auth('owner')).expect(200);
    expect(invoice.body.data).toMatchObject({ status: 'PARTIALLY_PAID', outstanding: half });
  });

  it('cash logged by the owner is confirmed immediately; rejected bank transfer notifies the tenant', async () => {
    const reject = await ctx.http().post(`${API}/payments/bank-transfer`).set(ctx.auth('tenant'))
      .send({ invoiceId: depositInvoice.id, amount: 100, bankName: 'Awash', providerReference: 'FAKE1' }).expect(201);
    await ctx.http().patch(`${API}/payments/${reject.body.data.id}/reject`).set(ctx.auth('owner')).send({ reason: 'Not received' }).expect(200);
    const cash = await ctx.http().post(`${API}/payments/offline`).set(ctx.auth('owner')).send({ invoiceId: depositInvoice.id, method: 'CASH' }).expect(201);
    expect(cash.body.data).toMatchObject({ status: 'CONFIRMED', confirmationSource: 'OWNER' });
    const invoice = await ctx.http().get(`${API}/invoices/${depositInvoice.id}`).set(ctx.auth('owner')).expect(200);
    expect(invoice.body.data.status).toBe('PAID');
    const notes = await ctx.http().get(`${API}/notifications`).set(ctx.auth('tenant')).expect(200);
    expect(notes.body.data.docs.map((n: any) => n.type)).toEqual(expect.arrayContaining(['PAYMENT_REJECTED', 'PAYMENT_RECEIVED']));
  });

  it('payment history per tenant and property; balances per tenant', async () => {
    const tenant = await ctx.http().get(`${API}/payments?status=CONFIRMED`).set(ctx.auth('tenant')).expect(200);
    expect(tenant.body.data.total).toBe(3);
    const property = await ctx.http().get(`${API}/payments?propertyId=${propertyId}`).set(ctx.auth('owner')).expect(200);
    expect(property.body.data.total).toBe(4);
    const balances = await ctx.http().get(`${API}/invoices/balances`).set(ctx.auth('owner')).expect(200);
    expect(balances.body.data).toHaveProperty('totalOutstanding');
  });

  it('overdue rent is flagged and reminders are sent by SMS', async () => {
    const rent2 = await ctx.prisma.invoice.findFirst({ where: { agreementId, type: 'RENT', status: 'UNPAID' } });
    await ctx.prisma.invoice.update({ where: { id: rent2.id }, data: { dueDate: new Date('2020-01-01') } });
    const { InvoicesService } = require('../../src/modules/billing/invoices/invoices.service');
    const invoices = ctx.app.get(InvoicesService);
    await expect(invoices.markOverdue()).resolves.toBeGreaterThanOrEqual(1);
    await expect(invoices.sendOverdueReminders()).resolves.toBeGreaterThanOrEqual(1);
    const updated = await ctx.prisma.invoice.findUnique({ where: { id: rent2.id } });
    expect(updated).toMatchObject({ status: 'OVERDUE', reminderCount: 1 });
  });

  it('owner payout = Telebirr collections minus platform fee, disbursed by staff', async () => {
    const from = '2020-01-01';
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const preview = await ctx.http().get(`${API}/payouts/preview?from=${from}&to=${to}`).set(ctx.auth('owner')).expect(200);
    expect(preview.body.data.grossCollected).toBe(rentInvoice.amount);
    expect(preview.body.data.netAmount).toBeCloseTo(rentInvoice.amount * 0.98, 1);
    await ctx.http().post(`${API}/payouts`).set(ctx.auth('owner')).send({ ownerId, from, to }).expect(403);
    const payout = await ctx.http().post(`${API}/payouts`).set(ctx.auth('admin')).send({ ownerId, from, to }).expect(201);
    await ctx.http().post(`${API}/payouts`).set(ctx.auth('admin')).send({ ownerId, from, to }).expect(400); // nothing left
    const paid = await ctx.http().patch(`${API}/payouts/${payout.body.data.id}/paid`).set(ctx.auth('telecom')).send({ method: 'TELEBIRR', paidReference: 'DISB-1' }).expect(200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('expenses are recorded against the property', async () => {
    await ctx.http().post(`${API}/expenses`).set(ctx.auth('owner')).send({ propertyId, category: 'UTILITIES', amount: 800, incurredOn: new Date().toISOString().slice(0, 10) }).expect(201);
    const res = await ctx.http().get(`${API}/expenses`).set(ctx.auth('owner')).expect(200);
    expect(res.body.data.totalAmount).toBe(800);
  });
});
