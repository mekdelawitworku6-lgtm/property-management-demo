import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { LateFeesController } from './late-fees/late-fees.controller';
import { LateFeesService } from './late-fees/late-fees.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PayoutsController } from './payouts/payouts.controller';
import { PayoutsService } from './payouts/payouts.service';
import { ExpensesController } from './expenses/expenses.controller';
import { ExpensesService } from './expenses/expenses.service';

@Module({
  controllers: [InvoicesController, PaymentsController, PayoutsController, ExpensesController, LateFeesController],
  providers: [InvoicesService, PaymentsService, PayoutsService, ExpensesService, LateFeesService],
  exports: [InvoicesService, PaymentsService, PayoutsService, ExpensesService, LateFeesService],
})
export class BillingModule {}
