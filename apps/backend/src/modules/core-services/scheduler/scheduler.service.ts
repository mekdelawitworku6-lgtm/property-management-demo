import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvoicesService } from '../../billing/invoices/invoices.service';
import { LateFeesService } from '../../billing/late-fees/late-fees.service';
import { PayoutsService } from '../../billing/payouts/payouts.service';
import { AgreementsService } from '../../leasing/agreements/agreements.service';

/** Background automation: invoicing, overdue tracking, reminders, lease expiry, payouts. Times are Africa/Addis_Ababa. */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly invoices: InvoicesService,
    private readonly lateFees: LateFeesService,
    private readonly agreements: AgreementsService,
    private readonly payouts: PayoutsService,
  ) {}

  /** Runs a job and logs (never rethrows) failures so one job cannot stop the others. */
  async runSafely<T>(name: string, job: () => Promise<T>): Promise<T | null> {
    try {
      const result = await job();
      this.logger.log(`${name}: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`${name} failed: ${(error as Error).message}`);
      return null;
    }
  }

  @Cron('0 1 * * *', { timeZone: 'Africa/Addis_Ababa' })
  async dailyLeaseJobs() {
    const expired = await this.runSafely('expireAgreements', () => this.agreements.expireAgreements());
    const reminded = await this.runSafely('sendExpiryReminders', () => this.agreements.sendExpiryReminders());
    // 60- and 30-day renewal prompts. Reminds the owner to act; never reprices the rent.
    const renewalReminders = await this.runSafely('sendRenewalReminders', () =>
      this.agreements.sendRenewalReminders(),
    );
    return { expired, reminded, renewalReminders };
  }

  @Cron('0 6 * * *', { timeZone: 'Africa/Addis_Ababa' })
  async dailyBillingJobs() {
    const generated = await this.runSafely('generateDueInvoices', () => this.invoices.generateDueInvoices());
    const overdue = await this.runSafely('markOverdue', () => this.invoices.markOverdue());
    const upcoming = await this.runSafely('sendUpcomingReminders', () => this.invoices.sendUpcomingReminders());
    const overdueReminders = await this.runSafely('sendOverdueReminders', () => this.invoices.sendOverdueReminders());
    const prepaidExpiry = await this.runSafely('sendPrepaidExpiryNotices', () => this.invoices.sendPrepaidExpiryNotices());
    // Late fees run after markOverdue so an invoice that just tipped over is eligible today.
    const lateFees = await this.runSafely('generateLateFeePenalties', () => this.lateFees.generateLateFeePenalties());
    return { generated, overdue, upcoming, overdueReminders, prepaidExpiry, lateFees };
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT, { timeZone: 'Africa/Addis_Ababa' })
  async monthlyPayouts() {
    return this.runSafely('generateMonthlyPayouts', () => this.payouts.generateMonthly());
  }
}
