import { API, E2EContext, createActiveLease, createOwnerWithUnit, register, setupE2E } from '../e2e-helpers';

/**
 * Configurable late fees and 60/30-day renewal reminders, proved against the real app.
 * The owner decides the terms; the platform never reprices a lease on its own.
 */
describe('Late fees and renewal reminders (e2e)', () => {
  let ctx: E2EContext;
  let ownerId: string;
  let agreementId: string;
  let tenantId: string;
  let rentInvoice: any;
  let renewalId: string;

  const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  /**
   * A rent invoice that has never been penalised and is not itself a penalty, so each
   * test can drive its own invoice without depending on what earlier tests billed.
   * Signing only invoices the first month, so the rest are added here.
   */
  async function freshRentInvoice() {
    const all = await ctx.prisma.invoice.findMany({ where: { agreementId, type: 'RENT' }, orderBy: { dueDate: 'asc' } });
    const penalised = new Set(
      (await ctx.prisma.invoice.findMany({ where: { agreementId, penaltyForInvoiceId: { not: null } }, select: { penaltyForInvoiceId: true } }))
        .map((row) => row.penaltyForInvoiceId as string),
    );
    const spare = all.find((invoice) => !penalised.has(invoice.id) && invoice.id !== rentInvoice.id);
    if (spare) return spare;

    // No spare month left, so add one on the lease and hand it back unpaid.
    const lease = await ctx.prisma.agreement.findUnique({ where: { id: agreementId } });
    const last = all[all.length - 1];
    const periodStart = new Date(new Date(last.periodStart).getTime() + 30 * 86_400_000);
    const created = await ctx.prisma.invoice.create({
      data: {
        invoiceNo: `INV-EXTRA-${periodStart.getTime()}`,
        agreementId,
        tenantId: lease.tenantId,
        ownerId: lease.ownerId,
        propertyId: lease.propertyId,
        unitId: lease.unitId,
        type: 'RENT',
        periodStart,
        periodEnd: new Date(periodStart.getTime() + 29 * 86_400_000),
        dueDate: new Date(periodStart.getTime() + 29 * 86_400_000),
        amount: lease.rentAmount,
        amountPaid: 0,
        currency: lease.currency,
        status: 'UNPAID',
      },
    });
    return created;
  }

  /** Make an invoice overdue by `days` so the job considers it. */
  async function makeOverdue(invoice: { id: string }, days: number) {
    await ctx.prisma.invoice.update({
      where: { id: invoice.id },
      data: { dueDate: new Date(Date.now() - days * 86_400_000), status: 'OVERDUE' },
    });
  }

  const lateFees = () => {
    const { LateFeesService } = require('../../src/modules/billing/late-fees/late-fees.service');
    return ctx.app.get(LateFeesService);
  };
  const agreements = () => {
    const { AgreementsService } = require('../../src/modules/leasing/agreements/agreements.service');
    return ctx.app.get(AgreementsService);
  };

  beforeAll(async () => {
    ctx = await setupE2E();
    let unitId: string;
    ({ ownerId, unitId } = await createOwnerWithUnit(ctx));
    tenantId = await register(ctx, 'tenant', 'TENANT');
    agreementId = await createActiveLease(ctx, 'owner', 'tenant', unitId);
    const list = await ctx.http().get(`${API}/invoices?agreementId=${agreementId}`).set(ctx.auth('owner')).expect(200);
    rentInvoice = list.body.data.docs
      .filter((i: any) => i.type === 'RENT' && i.status === 'UNPAID')
      .sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate))[0];
  });
  afterAll(() => ctx.close());

  it('with no rule configured, an overdue invoice is never penalised', async () => {
    await ctx.prisma.invoice.update({ where: { id: rentInvoice.id }, data: { dueDate: new Date('2020-01-01'), status: 'OVERDUE' } });
    await expect(lateFees().generateLateFeePenalties()).resolves.toBe(0);
    expect(await ctx.prisma.invoice.count({ where: { penaltyForInvoiceId: rentInvoice.id } })).toBe(0);
  });

  it('the owner creates a portfolio default and an agreement override', async () => {
    const def = await ctx.http().post(`${API}/late-fee-rules`).set(ctx.auth('owner'))
      .send({ label: 'Standard late rent', value: 5, gracePeriodDays: 5, frequency: 'PER_MONTH', maxPercentOfBalance: 50 })
      .expect(201);
    expect(def.body.data).toMatchObject({ type: 'PERCENT', gracePeriodDays: 5, frequency: 'PER_MONTH', agreementId: null, isActive: true });

    const override = await ctx.http().post(`${API}/late-fee-rules`).set(ctx.auth('owner'))
      .send({ label: 'This lease only', agreementId, value: 500, type: 'FLAT', gracePeriodDays: 2, frequency: 'ONCE' })
      .expect(201);

    const listed = await ctx.http().get(`${API}/late-fee-rules`).set(ctx.auth('owner')).expect(200);
    expect(listed.body.data).toHaveLength(2);

    await ctx.http().patch(`${API}/late-fee-rules/${override.body.data.id}`).set(ctx.auth('owner'))
      .send({ gracePeriodDays: 3 }).expect(200);
    await ctx.http().post(`${API}/late-fee-rules`).set(ctx.auth('owner')).send({ label: 'Bad', value: 0 }).expect(400);
    await ctx.http().post(`${API}/late-fee-rules`).set(ctx.auth('owner')).send({ label: 'Bad', value: 500, type: 'PERCENT' }).expect(400);
  });

  it('another owner cannot see or touch these rules', async () => {
    await createOwnerWithUnit(ctx, 'owner2');
    const theirs = await ctx.http().get(`${API}/late-fee-rules`).set(ctx.auth('owner2')).expect(200);
    expect(theirs.body.data).toEqual([]);
    const mine = await ctx.prisma.lateFeeRule.findFirst({ where: { ownerId } });
    await ctx.http().patch(`${API}/late-fee-rules/${mine.id}`).set(ctx.auth('owner2')).send({ value: 1 }).expect(403);
    await ctx.http().post(`${API}/late-fee-rules`).set(ctx.auth('owner2'))
      .send({ label: 'Steal', agreementId, value: 1 }).expect(404);
  });

  it('the grace period is respected: nothing charged on day 3 with a 5-day grace', async () => {
    // dueDate = now - 3 days, grace 5 days -> 2 days before any fee applies.
    const dueDate = new Date(Date.now() - 3 * 86_400_000);
    await ctx.prisma.invoice.update({ where: { id: rentInvoice.id }, data: { dueDate, status: 'OVERDUE' } });
    const preview = await ctx.http().get(`${API}/late-fee-rules/preview`).set(ctx.auth('owner')).expect(200);
    expect(preview.body.data.rows).toEqual([]);
    await expect(lateFees().generateLateFeePenalties()).resolves.toBe(0);
  });

  it('once past the grace period the agreement override wins over the portfolio default', async () => {
    const dueDate = new Date(Date.now() - 10 * 86_400_000);
    await ctx.prisma.invoice.update({ where: { id: rentInvoice.id }, data: { dueDate, status: 'OVERDUE' } });

    // The override is a 500 ETB one-off, so the 5% default must not apply.
    const preview = await ctx.http().get(`${API}/late-fee-rules/preview`).set(ctx.auth('owner')).expect(200);
    const row = preview.body.data.rows.find((r: any) => r.invoiceNo === rentInvoice.invoiceNo);
    expect(row).toMatchObject({ rule: 'This lease only', amount: 500 });

    await expect(lateFees().generateLateFeePenalties()).resolves.toBe(1);
    const penalty = await ctx.prisma.invoice.findFirst({ where: { penaltyForInvoiceId: rentInvoice.id } });
    expect(penalty).toMatchObject({ type: 'PENALTY', penaltyCycle: 1, status: 'UNPAID' });
    expect(Number(penalty.amount)).toBe(500);
    expect(penalty.description).toContain('This lease only');
    expect(penalty.penaltyRuleId).toBeTruthy();
  });

  it('re-running the job does not double-charge the same cycle', async () => {
    await expect(lateFees().generateLateFeePenalties()).resolves.toBe(0);
    await expect(lateFees().generateLateFeePenalties()).resolves.toBe(0);
    expect(await ctx.prisma.invoice.count({ where: { penaltyForInvoiceId: rentInvoice.id } })).toBe(1);
  });

  it('a one-off fee is still only one fee however much later the payment arrives', async () => {
    await ctx.prisma.invoice.update({ where: { id: rentInvoice.id }, data: { dueDate: new Date(Date.now() - 400 * 86_400_000) } });
    await expect(lateFees().generateLateFeePenalties()).resolves.toBe(0);
    expect(await ctx.prisma.invoice.count({ where: { penaltyForInvoiceId: rentInvoice.id } })).toBe(1);
  });

  it('deactivating a rule stops future charges without touching history', async () => {
    const override = await ctx.prisma.lateFeeRule.findFirst({ where: { ownerId, agreementId } });
    await ctx.http().delete(`${API}/late-fee-rules/${override.id}`).set(ctx.auth('owner')).expect(200);
    expect((await ctx.prisma.lateFeeRule.findUnique({ where: { id: override.id } })).isActive).toBe(false);

    // The portfolio default now applies, so a genuinely overdue invoice is charged 5%.
    const other = await freshRentInvoice();
    await makeOverdue(other, 20);
    expect(await lateFees().generateLateFeePenalties()).toBe(1);
    const penalty = await ctx.prisma.invoice.findFirst({ where: { penaltyForInvoiceId: other.id } });
    expect(Number(penalty.amount)).toBeCloseTo((Number(other.amount) - Number(other.amountPaid)) * 0.05, 2);
  });

  it('a repeating rule bills every cycle that is already due, then stops at the cap', async () => {
    const other = await freshRentInvoice();
    const outstanding = Number(other.amount) - Number(other.amountPaid);
    const cap = Math.round(outstanding * 0.5 * 100) / 100;

    // 40 days late with a 5-day grace on a monthly rule = 2 cycles of 5% due at once.
    await makeOverdue(other, 40);
    await lateFees().generateLateFeePenalties();
    const firstRun = await ctx.prisma.invoice.findMany({ where: { penaltyForInvoiceId: other.id } });
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0].penaltyCycle).toBe(2);
    expect(Number(firstRun[0].amount)).toBeCloseTo(outstanding * 0.05 * 2, 2);

    // A year later the remaining cycles are billed, but the total is clipped to 50%.
    await makeOverdue(other, 400);
    await lateFees().generateLateFeePenalties();
    const all = await ctx.prisma.invoice.findMany({ where: { penaltyForInvoiceId: other.id }, orderBy: { penaltyCycle: 'asc' } });
    const total = all.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(all.length).toBeGreaterThan(1);
    expect(total).toBeLessThanOrEqual(cap + 0.01);
    // Each cycle is billed exactly once, however often the job runs.
    expect(all.map((row) => row.penaltyCycle)).toEqual([...new Set(all.map((row) => row.penaltyCycle))].sort((a, b) => a - b));
    await expect(lateFees().generateLateFeePenalties()).resolves.toBe(0);
  });

  it('the tenant is notified when a late fee is applied', async () => {
    const notes = await ctx.http().get(`${API}/notifications`).set(ctx.auth('tenant')).expect(200);
    expect(notes.body.data.docs.map((n: any) => n.type)).toContain('RENT_LATE_FEE');
  });

  it('a settled invoice is left alone', async () => {
    // Reuse the invoice that already carries a penalty, and settle it. The job must not
    // add another charge to an invoice with nothing left owing.
    const paid = await ctx.prisma.invoice.findFirst({
      where: { agreementId, type: 'RENT', penaltyForInvoiceId: { not: null } },
      orderBy: { dueDate: 'asc' },
    });
    const before = await ctx.prisma.invoice.count({ where: { penaltyForInvoiceId: paid.id } });
    await ctx.prisma.invoice.update({ where: { id: paid.id }, data: { amountPaid: paid.amount, status: 'PAID', dueDate: new Date('2020-01-01') } });
    await lateFees().generateLateFeePenalties();
    expect(await ctx.prisma.invoice.count({ where: { penaltyForInvoiceId: paid.id } })).toBe(before);
  });

  describe('renewal reminders', () => {
    it('nudges the owner and tenant at 60 days, and only once', async () => {
      await ctx.prisma.agreement.update({ where: { id: agreementId }, data: { endDate: new Date(`${daysFromNow(60)}T00:00:00.000Z`) } });
      await expect(agreements().sendRenewalReminders()).resolves.toBe(1);
      const stamped = await ctx.prisma.agreement.findUnique({ where: { id: agreementId } });
      expect(stamped.renewalReminder60SentAt).not.toBeNull();
      expect(stamped.renewalReminder30SentAt).toBeNull();

      await expect(agreements().sendRenewalReminders()).resolves.toBe(0);

      const notes = await ctx.http().get(`${API}/notifications`).set(ctx.auth('tenant')).expect(200);
      const reminder = notes.body.data.docs.find((n: any) => n.type === 'AGREEMENT_RENEWAL_DUE');
      expect(reminder.body).toContain('60');
    });

    it('does not fire early: 61 days out gets nothing', async () => {
      await ctx.prisma.agreement.update({ where: { id: agreementId }, data: { endDate: new Date(`${daysFromNow(61)}T00:00:00.000Z`) } });
      await expect(agreements().sendRenewalReminders()).resolves.toBe(0);
    });

    it('fires a second time at 30 days, independently of the 60-day mark', async () => {
      await ctx.prisma.agreement.update({ where: { id: agreementId }, data: { endDate: new Date(`${daysFromNow(30)}T00:00:00.000Z`) } });
      await expect(agreements().sendRenewalReminders()).resolves.toBe(1);
      const stamped = await ctx.prisma.agreement.findUnique({ where: { id: agreementId } });
      expect(stamped.renewalReminder30SentAt).not.toBeNull();
      await expect(agreements().sendRenewalReminders()).resolves.toBe(0);
    });

    it('leaves expired and non-active agreements alone', async () => {
      await ctx.prisma.agreement.update({
        where: { id: agreementId },
        data: { status: 'EXPIRED', endDate: new Date(`${daysFromNow(30)}T00:00:00.000Z`), renewalReminder30SentAt: null },
      });
      await expect(agreements().sendRenewalReminders()).resolves.toBe(0);
    });

    it('never changes the rent itself', async () => {
      const before = await ctx.prisma.agreement.findUnique({ where: { id: agreementId } });
      await ctx.prisma.agreement.update({ where: { id: agreementId }, data: { status: 'ACTIVE', endDate: new Date(`${daysFromNow(60)}T00:00:00.000Z`), renewalReminder60SentAt: null } });
      await agreements().sendRenewalReminders();
      const after = await ctx.prisma.agreement.findUnique({ where: { id: agreementId } });
      // Reminders are a nudge only: the agreed rent is untouched.
      expect(Number(after.rentAmount)).toBe(Number(before.rentAmount));
      expect(Number(after.rentAmount)).toBe(10_000);
    });

    it('surfaces upcoming renewals to the owner, nearest first', async () => {
      await ctx.prisma.agreement.update({ where: { id: agreementId }, data: { endDate: new Date(`${daysFromNow(45)}T00:00:00.000Z`) } });
      const res = await ctx.http().get(`${API}/agreements/upcoming-renewals`).set(ctx.auth('owner')).expect(200);
      expect(res.body.data[0]).toMatchObject({ id: agreementId });
      expect(Number(res.body.data[0].rentAmount)).toBe(10_000);
      expect(res.body.data[0].unit.unitNumber).toBe('B-1');
      const other = await ctx.http().get(`${API}/agreements/upcoming-renewals`).set(ctx.auth('owner2')).expect(200);
      expect(other.body.data).toEqual([]);
    });

    it('renewal is a manual action and carries the rent the owner chose', async () => {
      const renewed = await ctx.http().post(`${API}/agreements/${agreementId}/renew`).set(ctx.auth('owner'))
        .send({ durationMonths: 12, rentAmount: 12_500 }).expect(201);
      renewalId = renewed.body.data.id as string;
      const next = await ctx.prisma.agreement.findUnique({ where: { id: renewalId } });
      // The owner's chosen amount, not an automatic escalation of the previous rent.
      expect(Number(next.rentAmount)).toBe(12_500);
      // No percentage crept in behind the scenes.
      expect(Number(next.rentAmount)).not.toBe(11_000);
      // The new lease starts its own 60/30-day reminder cycle.
      expect(next.renewalReminder60SentAt).toBeNull();
      expect(next.renewalReminder30SentAt).toBeNull();
    });

    it('renewing without an amount keeps the current rent rather than raising it', async () => {
      const kept = await ctx.http().post(`${API}/agreements/${renewalId}/renew`).set(ctx.auth('owner'))
        .send({ durationMonths: 12 }).expect(201);
      const next = await ctx.prisma.agreement.findUnique({ where: { id: kept.body.data.id } });
      expect(Number(next.rentAmount)).toBe(12_500);
    });
  });
});
