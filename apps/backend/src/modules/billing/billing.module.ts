import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PayoutsController } from './payouts/payouts.controller';
import { PayoutsService } from './payouts/payouts.service';
import { ExpensesController } from './expenses/expenses.controller';
import { ExpensesService } from './expenses/expenses.service';

@Module({
  controllers: [InvoicesController, PaymentsController, PayoutsController, ExpensesController],
  providers: [InvoicesService, PaymentsService, PayoutsService, ExpensesService],
  exports: [InvoicesService, PaymentsService, PayoutsService, ExpensesService],
})
export class BillingModule {}
