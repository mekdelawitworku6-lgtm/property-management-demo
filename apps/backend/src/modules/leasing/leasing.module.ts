import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AgreementsController } from './agreements/agreements.controller';
import { AgreementsService } from './agreements/agreements.service';
import { RentalRequestsController } from './rental-requests/rental-requests.controller';
import { RentalRequestsService } from './rental-requests/rental-requests.service';
import { InspectionsModule } from './inspections/inspections.module';

@Module({
  imports: [BillingModule, InspectionsModule],
  controllers: [AgreementsController, RentalRequestsController],
  providers: [AgreementsService, RentalRequestsService],
  exports: [AgreementsService, RentalRequestsService],
})
export class LeasingModule {}
