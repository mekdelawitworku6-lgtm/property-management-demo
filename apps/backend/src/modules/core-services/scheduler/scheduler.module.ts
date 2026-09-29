import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { LeasingModule } from '../../leasing/leasing.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [BillingModule, LeasingModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
