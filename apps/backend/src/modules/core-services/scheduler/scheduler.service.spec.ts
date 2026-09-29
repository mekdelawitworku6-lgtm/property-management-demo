import { SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
  const invoices = {
    generateDueInvoices: jest.fn().mockResolvedValue(2),
    markOverdue: jest.fn().mockResolvedValue(1),
    sendUpcomingReminders: jest.fn().mockResolvedValue(3),
    sendOverdueReminders: jest.fn().mockResolvedValue(4),
  };
  const agreements = { expireAgreements: jest.fn().mockResolvedValue(1), sendExpiryReminders: jest.fn().mockResolvedValue(5) };
  const payouts = { generateMonthly: jest.fn().mockResolvedValue(6) };
  const service = new SchedulerService(invoices as any, agreements as any, payouts as any);

  beforeEach(() => {
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  });

  it('runSafely returns results and swallows failures', async () => {
    await expect(service.runSafely('ok', async () => 1)).resolves.toBe(1);
    await expect(service.runSafely('bad', async () => { throw new Error('x'); })).resolves.toBeNull();
  });

  it('dailyLeaseJobs expires agreements and sends expiry reminders', async () => {
    await expect(service.dailyLeaseJobs()).resolves.toEqual({ expired: 1, reminded: 5 });
  });

  it('dailyBillingJobs runs invoicing and reminders even if one fails', async () => {
    invoices.markOverdue.mockRejectedValueOnce(new Error('db'));
    await expect(service.dailyBillingJobs()).resolves.toEqual({ generated: 2, overdue: null, upcoming: 3, overdueReminders: 4 });
  });

  it('monthlyPayouts generates payouts', async () => {
    await expect(service.monthlyPayouts()).resolves.toBe(6);
  });
});
