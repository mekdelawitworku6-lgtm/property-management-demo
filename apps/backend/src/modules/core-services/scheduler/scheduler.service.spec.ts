import { SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
  const invoices = {
    generateDueInvoices: jest.fn().mockResolvedValue(2),
    markOverdue: jest.fn().mockResolvedValue(1),
    sendUpcomingReminders: jest.fn().mockResolvedValue(3),
    sendOverdueReminders: jest.fn().mockResolvedValue(4),
    sendPrepaidExpiryNotices: jest.fn().mockResolvedValue(7),
  };
  const lateFees = { generateLateFeePenalties: jest.fn().mockResolvedValue(2) };
  const agreements = {
    expireAgreements: jest.fn().mockResolvedValue(1),
    sendExpiryReminders: jest.fn().mockResolvedValue(5),
    sendRenewalReminders: jest.fn().mockResolvedValue(6),
  };
  const payouts = { generateMonthly: jest.fn().mockResolvedValue(6) };
  const service = new SchedulerService(invoices as any, lateFees as any, agreements as any, payouts as any);

  beforeEach(() => {
    jest.clearAllMocks();
    invoices.sendPrepaidExpiryNotices.mockResolvedValue(7);
    lateFees.generateLateFeePenalties.mockResolvedValue(2);
    agreements.sendRenewalReminders.mockResolvedValue(6);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  });

  it('runSafely returns results and swallows failures', async () => {
    await expect(service.runSafely('ok', async () => 1)).resolves.toBe(1);
    await expect(service.runSafely('bad', async () => { throw new Error('x'); })).resolves.toBeNull();
  });

  it('dailyLeaseJobs expires agreements and sends expiry and renewal reminders', async () => {
    await expect(service.dailyLeaseJobs()).resolves.toEqual({ expired: 1, reminded: 5, renewalReminders: 6 });
  });

  it('dailyBillingJobs runs invoicing and reminders even if one fails', async () => {
    invoices.markOverdue.mockRejectedValueOnce(new Error('db'));
    await expect(service.dailyBillingJobs()).resolves.toEqual({
      generated: 2,
      overdue: null,
      upcoming: 3,
      overdueReminders: 4,
      prepaidExpiry: 7,
      lateFees: 2,
    });
  });

  it('late fees are skipped but do not stop the rest of the billing job', async () => {
    lateFees.generateLateFeePenalties.mockRejectedValueOnce(new Error('rule'));
    await expect(service.dailyBillingJobs()).resolves.toMatchObject({ generated: 2, lateFees: null });
  });

  it('monthlyPayouts generates payouts', async () => {
    await expect(service.monthlyPayouts()).resolves.toBe(6);
  });
});
