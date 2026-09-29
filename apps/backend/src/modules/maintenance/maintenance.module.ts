import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ComplaintsController } from './complaints/complaints.controller';
import { ComplaintsService } from './complaints/complaints.service';
import { VendorsController } from './vendors/vendors.controller';
import { VendorsService } from './vendors/vendors.service';
import { WorkOrdersController } from './work-orders/work-orders.controller';
import { WorkOrdersService } from './work-orders/work-orders.service';

@Module({
  imports: [BillingModule],
  controllers: [ComplaintsController, VendorsController, WorkOrdersController],
  providers: [ComplaintsService, VendorsService, WorkOrdersService],
  exports: [ComplaintsService],
})
export class MaintenanceModule {}
